import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { CoderAdapter } from "./base.js";
import type { ClaudeCodeProfile } from "../types.js";
import { getPresetByIdAsync } from "../providers/presets.js";
import { getOpenAIModel } from "../utils/model-helper.js";
import { getEnvExportCommands as getEnvExports } from "../utils/env-key-helper.js";
import { getEnvKey } from "../utils/env-key-helper.js";

/**
 * Codex configuration adapter
 *
 * Handles reading/writing ~/.codex/config.toml and standalone profile files
 * (~/.codex/swixter-<name>.config.toml, per Codex 0.134.0+).
 *
 * Key features:
 * - TOML format support for config.toml
 * - Provider table management [model_providers.<name>] with env_key auth
 * - Standalone profile files selected via `codex --profile swixter-<name>`
 * - Smart merge: preserves MCP servers, approval policies, etc.
 *
 * Authentication model: providers use `env_key` to reference an environment
 * variable (e.g. OPENAI_API_KEY). The user must export that variable, or run
 * `swixter codex run` which injects it automatically. swixter does NOT write
 * API keys to auth.json — `requires_openai_auth` is reserved for providers
 * backed by OpenAI-managed auth and is mutually exclusive with env_key.
 *
 * Note: the swixter proxy (with openai_responses ↔ openai_chat transformer)
 * exists as separate infrastructure (`swixter proxy start --profile X`).
 * The adapter does not auto-wire codex through the proxy — users opt in
 * explicitly by configuring their codex base_url / env_key manually, or via
 * a future dedicated command. See src/utils/codex-bridge.ts for the available
 * helpers (resolveProviderEndpoints / ensureProxyRunning / setProxyAuthEnvForGUI).
 */
export class CodexAdapter implements CoderAdapter {
  name = "codex";
  configPath: string;

  constructor() {
    const codexHome = join(homedir(), ".codex");
    this.configPath = join(codexHome, "config.toml");
  }

  /**
   * Path to the standalone profile file for a given swixter profile name.
   *
   * Codex 0.134.0+ loads `<CODEX_HOME>/<name>.config.toml` when selected with
   * `codex --profile <name>`. swixter writes one file per profile. Derived from
   * `configPath`'s directory so test overrides of configPath Just Work.
   */
  private getProfileFilePath(profileName: string): string {
    return join(dirname(this.configPath), `swixter-${profileName}.config.toml`);
  }

  /**
   * Apply a Swixter profile to Codex configuration
   *
   * Strategy:
   * 1. Read existing config.toml (or create empty object)
   * 2. Create/update provider table [model_providers.swixter-<profileName>]
   * 3. Set top-level model_provider = "swixter-<profileName>"
   * 4. Write standalone profile file ~/.codex/swixter-<name>.config.toml
   * 5. Smart merge to preserve user's other configurations
   */
  async apply(profile: ClaudeCodeProfile): Promise<void> {
    try {
      // Ensure config directory exists
      const configDir = dirname(this.configPath);
      if (!existsSync(configDir)) {
        await mkdir(configDir, { recursive: true });
      }

      // Read existing config or start with empty object
      let config: any = {};
      if (existsSync(this.configPath)) {
        const content = await readFile(this.configPath, "utf-8");
        try {
          config = parseToml(content);
        } catch (error) {
          // If TOML is corrupted, create backup and start fresh
          const backupPath = `${this.configPath}.backup.${Date.now()}`;
          await writeFile(backupPath, content, "utf-8");
          console.warn(`Warning: Corrupted config.toml backed up to ${backupPath}`);
          config = {};
        }
      }

      // Get provider preset
      const preset = await getPresetByIdAsync(profile.providerId);
      if (!preset) {
        throw new Error(`Unknown provider: ${profile.providerId}`);
      }

      // Create provider ID with swixter prefix to avoid conflicts
      const providerName = `swixter-${profile.name}`;
      const profileName = `swixter-${profile.name}`;

      // Initialize model_providers table if not exists
      if (!config.model_providers) {
        config.model_providers = {};
      }

      // Create/update provider table
      config.model_providers[providerName] = await this.createProviderTable(profile, preset);

      // swixter does NOT use the deprecated [profiles.xxx] table or the top-level
      // `profile =` selector (removed in Codex 0.134.0+). Profile settings live in
      // a standalone file selected via `codex --profile swixter-<name>`. We do set
      // the root `model_provider` so running plain `codex` still uses the provider.
      config.model_provider = providerName;
      // Clean up any legacy swixter-written keys from older versions.
      delete config.profile;
      if (config.profiles) {
        delete config.profiles[profileName];
        if (Object.keys(config.profiles).length === 0) {
          delete config.profiles;
        }
      }

      // Write config back
      const tomlContent = stringifyToml(config);
      await writeFile(this.configPath, tomlContent, "utf-8");

      // Write the standalone profile file (~/.codex/swixter-<name>.config.toml)
      await this.writeProfileFile(profile, providerName);

    } catch (error) {
      throw new Error(`Failed to apply Codex configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Verify that the profile has been correctly applied
   */
  async verify(profile: ClaudeCodeProfile): Promise<boolean> {
    try {
      if (!existsSync(this.configPath)) {
        return false;
      }

      const content = await readFile(this.configPath, "utf-8");
      const config = parseToml(content);

      const providerName = `swixter-${profile.name}`;

      // config.toml must point model_provider at our provider table
      if (config.model_provider !== providerName) {
        return false;
      }
      if (!config.model_providers || !config.model_providers[providerName]) {
        return false;
      }

      // Standalone profile file must exist and reference the provider
      const profileFilePath = this.getProfileFilePath(profile.name);
      if (!existsSync(profileFilePath)) {
        return false;
      }
      try {
        const profileFile = parseToml(await readFile(profileFilePath, "utf-8"));
        if (profileFile.model_provider !== providerName) {
          return false;
        }
      } catch {
        return false;
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create provider table configuration
   *
   * Uses env_key to reference an environment variable (per official Codex spec).
   * The API key itself is NOT stored — the user exports the env var, or runs
   * `swixter codex run` which injects it. We deliberately do NOT set
   * requires_openai_auth: that flag is for OpenAI-managed auth and is mutually
   * exclusive with env_key.
   */
  private async createProviderTable(profile: ClaudeCodeProfile, preset: any): Promise<any> {
    // Use baseURLChat if available (for chat-compatible Codex/Qwen), otherwise fall back to baseURL
    const baseUrl = preset.baseURLChat || preset.baseURL;
    const providerTable: any = {
      name: preset.displayName,
      base_url: profile.baseURL || baseUrl,
      wire_api: "responses",
    };

    // Use centralized env_key logic
    providerTable.env_key = await getEnvKey(profile);

    // Add headers if present
    if (preset.headers) {
      providerTable.http_headers = preset.headers;
    }

    return providerTable;
  }

  /**
   * Write the standalone profile file (~/.codex/swixter-<name>.config.toml).
   *
   * Per Codex 0.134.0+, a profile is a separate file with top-level config keys
   * (NOT nested under [profiles.<name>]), selected via `codex --profile <name>`.
   */
  private async writeProfileFile(profile: ClaudeCodeProfile, providerName: string): Promise<void> {
    const profileContent: any = {
      model_provider: providerName,
    };

    // Use model from profile if specified (with backward compatibility)
    const modelValue = getOpenAIModel(profile);
    if (modelValue) {
      profileContent.model = modelValue;
    } else {
      // Fallback to first default model from preset
      const preset = await getPresetByIdAsync(profile.providerId);
      if (preset && preset.defaultModels && preset.defaultModels.length > 0) {
        profileContent.model = preset.defaultModels[0];
      }
    }

    const profileFilePath = this.getProfileFilePath(profile.name);
    await writeFile(profileFilePath, stringifyToml(profileContent), "utf-8");
  }

  /**
   * Get environment variable export commands for the user
   */
  async getEnvExportCommands(profile: ClaudeCodeProfile): Promise<string[]> {
    const commands = await getEnvExports(profile);

    // Add model environment variable export (with backward compatibility)
    const modelValue = getOpenAIModel(profile);
    if (modelValue) {
      commands.push(`export OPENAI_MODEL="${modelValue}"`);
    }

    return commands;
  }

  /**
   * Remove profile from Codex configuration
   * Removes the provider entry and the standalone profile file.
   */
  async remove(profileName: string): Promise<void> {
    // Always remove the standalone profile file if it exists
    const profileFilePath = this.getProfileFilePath(profileName);
    if (existsSync(profileFilePath)) {
      try { await unlink(profileFilePath); } catch { /* ignore */ }
    }

    if (!existsSync(this.configPath)) {
      return;
    }

    try {
      const content = await readFile(this.configPath, "utf-8");
      const config = parseToml(content);

      const providerKey = `swixter-${profileName}`;

      let modified = false;

      if (config.model_providers && config.model_providers[providerKey]) {
        delete config.model_providers[providerKey];
        modified = true;
      }

      // Clean up legacy [profiles.xxx] table / profile= selector from older swixter
      if (config.profiles && config.profiles[providerKey]) {
        delete config.profiles[providerKey];
        if (Object.keys(config.profiles).length === 0) {
          delete config.profiles;
        }
        modified = true;
      }
      if (config.profile === providerKey) {
        delete config.profile;
        modified = true;
      }
      // Clear root model_provider if it pointed at the removed provider
      if (config.model_provider === providerKey) {
        delete config.model_provider;
        modified = true;
      }

      // Only write if something was actually removed
      if (modified) {
        const tomlContent = stringifyToml(config);
        await writeFile(this.configPath, tomlContent, "utf-8");
      }
    } catch (error) {
      // Silently fail - config might be corrupted or in unexpected format
      console.warn(`Failed to remove profile from Codex config: ${error}`);
    }
  }
}
