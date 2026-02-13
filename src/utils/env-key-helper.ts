/**
 * Environment variable key helper utilities
 * Centralizes env_key priority logic for Codex adapter
 */

import type { ClaudeCodeProfile } from "../types.js";
import { getPresetByIdAsync } from "../providers/presets.js";

/**
 * Get the environment variable key for API key storage
 * Priority: profile.envKey > preset.env_key > "OPENAI_API_KEY"
 *
 * @param profile The profile to get env key for
 * @returns The environment variable key name
 */
export async function getEnvKey(profile: ClaudeCodeProfile): Promise<string> {
  const preset = await getPresetByIdAsync(profile.providerId);

  // Priority: profile.envKey > preset.env_key > "OPENAI_API_KEY" (default)
  return profile.envKey || preset?.env_key || "OPENAI_API_KEY";
}

/**
 * Get all environment variable export commands for a profile
 *
 * @param profile The profile to generate exports for
 * @returns Array of export command strings
 */
export async function getEnvExportCommands(profile: ClaudeCodeProfile): Promise<string[]> {
  const commands: string[] = [];
  const envKey = await getEnvKey(profile);

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
export async function hasCustomEnvKey(profile: ClaudeCodeProfile): Promise<boolean> {
  const preset = await getPresetByIdAsync(profile.providerId);
  const presetEnvKey = preset?.env_key || "OPENAI_API_KEY";

  return profile.envKey !== undefined && profile.envKey !== presetEnvKey;
}

/**
 * Get the default environment variable key for a provider
 *
 * @param providerId The provider ID
 * @returns The default environment variable key
 */
export async function getDefaultEnvKey(providerId: string): Promise<string> {
  const preset = await getPresetByIdAsync(providerId);
  return preset?.env_key || "OPENAI_API_KEY";
}
