import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { CoderAdapter } from "./base.js";
import type { ClaudeCodeProfile } from "../types.js";
import { getPresetByIdAsync } from "../providers/presets.js";
import { getOpenAIModel } from "../utils/model-helper.js";
import { getEnvKey, getEnvExportCommands as getEnvExports } from "../utils/env-key-helper.js";

/**
 * Codex configuration adapter
 *
 * Handles reading/writing ~/.codex/config.toml and ~/.codex/auth.json
 *
 * Key features:
 * - TOML format support for config.toml
 * - auth.json support for API key storage (Codex reads keys via requires_openai_auth)
 * - Provider table management [model_providers.<name>]
 * - Profile table management [profiles.<name>]
 * - Smart merge: preserves MCP servers, approval policies, etc.
 */
export class CodexAdapter implements CoderAdapter {
  name = "codex";
  configPath: string;
  authPath: string;

  constructor() {
    this.configPath = join(homedir(), ".codex", "config.toml");
    this.authPath = join(homedir(), ".codex", "auth.json");
  }

  /**
   * Apply a Swixter profile to Codex configuration
   *
   * Strategy:
   * 1. Read existing config.toml (or create empty object)
   * 2. Create/update provider table [model_providers.swixter-<profileName>]
   * 3. Create/update profile table [profiles.swixter-<profileName>]
   * 4. Set top-level profile = "swixter-<profileName>"
   * 5. Smart merge to preserve user's other configurations
   * 6. Write back to config.toml
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

      // Initialize profiles table if not exists
      if (!config.profiles) {
        config.profiles = {};
      }

      // Create/update profile table
      config.profiles[profileName] = await this.createProfileTable(profile, providerName);

      // Set active profile at root level
      config.profile = profileName;

      // Also set model_provider for backward compatibility
      config.model_provider = providerName;

      // Write config back
      const tomlContent = stringifyToml(config);
      await writeFile(this.configPath, tomlContent, "utf-8");

      // Write auth.json so codex can read API key directly
      await this.writeAuthJson(profile);

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

      const profileName = `swixter-${profile.name}`;

      // Check if profile is active
      if (config.profile !== profileName) {
        return false;
      }

      // Check if profile exists in profiles table
      if (!config.profiles || !config.profiles[profileName]) {
        return false;
      }

      // Check if provider exists
      const providerName = config.profiles[profileName].model_provider;
      if (!config.model_providers || !config.model_providers[providerName]) {
        return false;
      }

      // If profile has API key, check auth.json
      if (profile.apiKey) {
        const envKey = await getEnvKey(profile);
        if (existsSync(this.authPath)) {
          try {
            const authContent = await readFile(this.authPath, "utf-8");
            const auth = JSON.parse(authContent);
            if (auth[envKey] !== profile.apiKey) {
              return false;
            }
          } catch {
            return false;
          }
        } else {
          return false;
        }
      }

      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Create provider table configuration
   *
   * Always uses env_key to reference environment variables (per official Codex spec)
   * API keys should be set as environment variables before running Codex
   */
  private async createProviderTable(profile: ClaudeCodeProfile, preset: any): Promise<any> {
    // Use baseURLChat if available (for chat-compatible Codex/Qwen), otherwise fall back to baseURL
    const baseUrl = preset.baseURLChat || preset.baseURL;
    const providerTable: any = {
      name: preset.displayName,
      base_url: profile.baseURL || baseUrl,
      wire_api: "responses",
      requires_openai_auth: true,
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
   * Create profile table configuration
   */
  private async createProfileTable(profile: ClaudeCodeProfile, providerName: string): Promise<any> {
    const profileTable: any = {
      model_provider: providerName,
    };

    // Use model from profile if specified (with backward compatibility)
    const modelValue = getOpenAIModel(profile);
    if (modelValue) {
      profileTable.model = modelValue;
    } else {
      // Fallback to first default model from preset
      const preset = await getPresetByIdAsync(profile.providerId);
      if (preset && preset.defaultModels && preset.defaultModels.length > 0) {
        profileTable.model = preset.defaultModels[0];
      }
    }

    return profileTable;
  }

  /**
   * Write auth.json with the API key so codex can read it directly
   * without requiring environment variables.
   */
  private async writeAuthJson(profile: ClaudeCodeProfile): Promise<void> {
    const envKey = await getEnvKey(profile);

    // Read existing auth.json or start fresh
    let auth: Record<string, string> = {};
    if (existsSync(this.authPath)) {
      try {
        const content = await readFile(this.authPath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          auth = parsed;
        }
      } catch {
        // If auth.json is corrupted, start fresh
        auth = {};
      }
    }

    // Set or remove the API key
    if (profile.apiKey) {
      auth[envKey] = profile.apiKey;
    } else {
      delete auth[envKey];
    }

    // Write back if there are keys; remove file if empty
    if (Object.keys(auth).length > 0) {
      await writeFile(this.authPath, JSON.stringify(auth, null, 2), "utf-8");
    } else if (existsSync(this.authPath)) {
      await unlink(this.authPath);
    }
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
   * Removes the provider and profile entries with swixter- prefix
   * and cleans up the corresponding API key from auth.json
   */
  async remove(profileName: string): Promise<void> {
    if (!existsSync(this.configPath)) {
      return;
    }

    try {
      const content = await readFile(this.configPath, "utf-8");
      const config = parseToml(content);

      const providerKey = `swixter-${profileName}`;
      const profileKey = `swixter-${profileName}`;

      let modified = false;
      let envKeyToRemove: string | undefined;

      // Read env_key from provider table before deleting it
      if (config.model_providers && config.model_providers[providerKey]) {
        envKeyToRemove = config.model_providers[providerKey].env_key;
        delete config.model_providers[providerKey];
        modified = true;
      }

      // Remove from profiles
      if (config.profiles && config.profiles[profileKey]) {
        delete config.profiles[profileKey];
        modified = true;
      }

      // If the active profile is the one being deleted, clear it
      if (config.profile === profileKey) {
        delete config.profile;
        delete config.model_provider;
        modified = true;
      }

      // Only write if something was actually removed
      if (modified) {
        const tomlContent = stringifyToml(config);
        await writeFile(this.configPath, tomlContent, "utf-8");
      }

      // Clean up auth.json
      if (envKeyToRemove && existsSync(this.authPath)) {
        try {
          const authContent = await readFile(this.authPath, "utf-8");
          const auth = JSON.parse(authContent) as Record<string, string>;
          delete auth[envKeyToRemove];
          await writeFile(this.authPath, JSON.stringify(auth, null, 2), "utf-8");
        } catch {
          // Silently ignore auth.json cleanup errors
        }
      }
    } catch (error) {
      // Silently fail - config might be corrupted or in unexpected format
      console.warn(`Failed to remove profile from Codex config: ${error}`);
    }
  }
}
