/**
 * Environment variable key helper utilities
 * Centralizes env_key priority logic for Codex adapter
 */

import type { ClaudeCodeProfile } from "../types.js";
import { getPresetById } from "../providers/presets.js";

/**
 * Get the environment variable key for API key storage
 * Priority: profile.envKey > preset.env_key > "OPENAI_API_KEY"
 *
 * @param profile The profile to get env key for
 * @returns The environment variable key name
 */
export function getEnvKey(profile: ClaudeCodeProfile): string {
  const preset = getPresetById(profile.providerId);

  // Priority: profile.envKey > preset.env_key > "OPENAI_API_KEY" (default)
  return profile.envKey || preset?.env_key || "OPENAI_API_KEY";
}

/**
 * Get all environment variable export commands for a profile
 *
 * @param profile The profile to generate exports for
 * @returns Array of export command strings
 */
export function getEnvExportCommands(profile: ClaudeCodeProfile): string[] {
  const commands: string[] = [];
  const envKey = getEnvKey(profile);

  // API key export
  if (profile.apiKey) {
    commands.push(`export ${envKey}="${profile.apiKey}"`);
  }

  return commands;
}

/**
 * Check if a profile has a custom environment variable key
 *
 * @param profile The profile to check
 * @returns True if the profile has a custom env key
 */
export function hasCustomEnvKey(profile: ClaudeCodeProfile): boolean {
  const preset = getPresetById(profile.providerId);
  const presetEnvKey = preset?.env_key || "OPENAI_API_KEY";

  return profile.envKey !== undefined && profile.envKey !== presetEnvKey;
}

/**
 * Get the default environment variable key for a provider
 *
 * @param providerId The provider ID
 * @returns The default environment variable key
 */
export function getDefaultEnvKey(providerId: string): string {
  const preset = getPresetById(providerId);
  return preset?.env_key || "OPENAI_API_KEY";
}