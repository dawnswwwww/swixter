import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { CoderAdapter } from "./base.js";
import type { ClaudeCodeProfile } from "../types.js";
import { getPresetById } from "../providers/presets.js";
import { getConfigPath } from "../constants/paths.js";
import { CODER_REGISTRY, SERIALIZATION } from "../constants/index.js";

/**
 * Claude Code configuration adapter
 * Maps Swixter profile to ~/.claude/settings.json
 */
export class ClaudeCodeAdapter implements CoderAdapter {
  name = "claude";
  configPath = getConfigPath("claude");
  private coderConfig = CODER_REGISTRY.claude;

  /**
   * Apply configuration to Claude Code
   * Smart merge: only update env.ANTHROPIC_* fields, preserve other configs
   */
  async apply(profile: ClaudeCodeProfile): Promise<void> {
    const preset = getPresetById(profile.providerId);
    const baseURL = profile.baseURL || preset?.baseURL || "";

    // Read existing configuration (if exists)
    let existingConfig: any = {};
    if (existsSync(this.configPath)) {
      try {
        const content = await readFile(this.configPath, "utf-8");
        existingConfig = JSON.parse(content);
      } catch (error) {
        // If reading fails, use empty configuration
        console.warn(`Warning: Unable to read existing Claude Code config, will create new config`);
      }
    }

    // Use configured environment variable names
    const envVars = this.coderConfig.envVarMapping;

    // Build fresh env object (full replacement strategy)
    // This ensures undefined fields are removed when switching profiles
    const newEnv: Record<string, string> = {
      [envVars.baseURL]: baseURL,
    };

    // Add optional fields only if present
    if (profile.apiKey) {
      newEnv[envVars.apiKey] = profile.apiKey;
    }

    if (profile.authToken && envVars.authToken) {
      newEnv[envVars.authToken] = profile.authToken;
    }

    // Smart merge: preserve existing config, only replace env section
    const newConfig = {
      ...existingConfig,
      env: newEnv,
    };

    // Ensure config directory exists
    await mkdir(dirname(this.configPath), { recursive: true });

    // Write configuration
    const content = JSON.stringify(newConfig, null, SERIALIZATION.jsonIndent);
    await writeFile(this.configPath, content, "utf-8");
  }

  /**
   * Verify if configuration has been correctly applied
   */
  async verify(profile: ClaudeCodeProfile): Promise<boolean> {
    if (!existsSync(this.configPath)) {
      return false;
    }

    try {
      const content = await readFile(this.configPath, "utf-8");
      const config = JSON.parse(content);

      const preset = getPresetById(profile.providerId);
      const expectedBaseURL = profile.baseURL || preset?.baseURL || "";

      // Use configured environment variable names
      const envVars = this.coderConfig.envVarMapping;

      // Verify at least one key/token matches
      const hasApiKey = profile.apiKey && config.env?.[envVars.apiKey] === profile.apiKey;
      const hasAuthToken = profile.authToken && envVars.authToken &&
                          config.env?.[envVars.authToken] === profile.authToken;

      return (
        (hasApiKey || hasAuthToken) &&
        config.env?.[envVars.baseURL] === expectedBaseURL
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Remove profile from Claude Code configuration
   * Note: Claude Code doesn't have profile-specific entries like Codex does.
   * This is a no-op for Claude, but we implement it for interface consistency.
   */
  async remove(profileName: string): Promise<void> {
    // Claude Code settings.json doesn't have profile-specific entries
    // All configuration is global (env variables)
    // When a profile is deleted from swixter, the user needs to manually
    // apply another profile or the settings will remain as-is

    // This is intentionally a no-op for Claude Code adapter
    return Promise.resolve();
  }
}
