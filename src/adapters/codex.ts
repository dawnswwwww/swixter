import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type { CoderAdapter } from "./base.js";
import type { ClaudeCodeProfile } from "../types.js";
import { getPresetById } from "../providers/presets.js";

/**
 * Codex configuration adapter
 *
 * Handles reading/writing ~/.codex/config.toml
 *
 * Key features:
 * - TOML format support
 * - Provider table management [model_providers.<name>]
 * - Profile table management [profiles.<name>]
 * - Smart merge: preserves MCP servers, approval policies, etc.
 * - Mixed environment variable mode: prefer env vars, fallback to direct storage
 */
export class CodexAdapter implements CoderAdapter {
  name = "codex";
  configPath: string;

  constructor() {
    this.configPath = join(homedir(), ".codex", "config.toml");
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
      const preset = getPresetById(profile.providerId);
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
      config.model_providers[providerName] = this.createProviderTable(profile, preset);

      // Initialize profiles table if not exists
      if (!config.profiles) {
        config.profiles = {};
      }

      // Create/update profile table
      config.profiles[profileName] = this.createProfileTable(profile, providerName);

      // Set active profile at root level
      config.profile = profileName;

      // Also set model_provider for backward compatibility
      config.model_provider = providerName;

      // Write config back
      const tomlContent = stringifyToml(config);
      await writeFile(this.configPath, tomlContent, "utf-8");

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
  private createProviderTable(profile: ClaudeCodeProfile, preset: any): any {
    const providerTable: any = {
      name: preset.displayName,
      base_url: profile.baseURL || preset.baseURL,
      wire_api: preset.wire_api || "chat",
    };

    // Use profile's custom env_key if provided, otherwise fall back to preset
    // Priority: profile.envKey > preset.env_key > "OPENAI_API_KEY" (default)
    const envKey = profile.envKey || preset.env_key || "OPENAI_API_KEY";
    providerTable.env_key = envKey;

    // Add headers if present
    if (preset.headers) {
      providerTable.http_headers = preset.headers;
    }

    return providerTable;
  }

  /**
   * Create profile table configuration
   */
  private createProfileTable(profile: ClaudeCodeProfile, providerName: string): any {
    const profileTable: any = {
      model_provider: providerName,
    };

    // Use model from profile if specified
    if (profile.model) {
      profileTable.model = profile.model;
    } else {
      // Fallback to first default model from preset
      const preset = getPresetById(profile.providerId);
      if (preset && preset.defaultModels && preset.defaultModels.length > 0) {
        profileTable.model = preset.defaultModels[0];
      }
    }

    return profileTable;
  }

  /**
   * Get environment variable export commands for the user
   */
  getEnvExportCommands(profile: ClaudeCodeProfile): string[] {
    const preset = getPresetById(profile.providerId);
    // Use profile's custom env_key if provided, otherwise use preset default
    // Priority: profile.envKey > preset.env_key > "OPENAI_API_KEY"
    const envKey = profile.envKey || preset?.env_key || "OPENAI_API_KEY";
    const commands: string[] = [];

    if (profile.apiKey) {
      commands.push(`export ${envKey}="${profile.apiKey}"`);
    }

    return commands;
  }

  /**
   * Remove profile from Codex configuration
   * Removes the provider and profile entries with swixter- prefix
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

      // Remove from model_providers
      if (config.model_providers && config.model_providers[providerKey]) {
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
    } catch (error) {
      // Silently fail - config might be corrupted or in unexpected format
      console.warn(`Failed to remove profile from Codex config: ${error}`);
    }
  }
}
