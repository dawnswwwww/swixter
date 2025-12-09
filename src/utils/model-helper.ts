/**
 * Model field helper utilities
 * Provides consistent model field handling across adapters
 */

import type { ClaudeCodeProfile } from "../types.js";

/**
 * Get the model value from a profile with backward compatibility
 * Priority: model > openaiModel > undefined
 *
 * @param profile The profile to extract model from
 * @returns The model value or undefined if not set
 */
export function getModel(profile: ClaudeCodeProfile): string | undefined {
  // For Claude Code profiles, models are stored in the models object
  if (profile.models && profile.models.anthropicModel) {
    return profile.models.anthropicModel;
  }

  // For OpenAI-compatible providers, use model field with fallback to openaiModel
  return profile.model || profile.openaiModel;
}

/**
 * Get the OpenAI model value from a profile
 * This is specifically for OpenAI API format models
 *
 * @param profile The profile to extract model from
 * @returns The OpenAI model value or undefined if not set
 */
export function getOpenAIModel(profile: ClaudeCodeProfile): string | undefined {
  // Skip Claude Code profiles that use the models object
  if (profile.models) {
    return undefined;
  }

  // For OpenAI-compatible providers, use model field with fallback to openaiModel
  return profile.model || profile.openaiModel;
}

/**
 * Check if a profile has Claude-specific model configuration
 *
 * @param profile The profile to check
 * @returns True if the profile has Claude model configuration
 */
export function hasClaudeModels(profile: ClaudeCodeProfile): boolean {
  return !!(profile.models && Object.keys(profile.models).length > 0);
}

/**
 * Check if a profile has OpenAI-compatible model configuration
 *
 * @param profile The profile to check
 * @returns True if the profile has OpenAI model configuration
 */
export function hasOpenAIModel(profile: ClaudeCodeProfile): boolean {
  return !!(profile.model || profile.openaiModel);
}

/**
 * Get all model values from a Claude Code profile
 *
 * @param profile The profile to extract models from
 * @returns Object containing all model values or undefined if no models
 */
export function getClaudeModels(profile: ClaudeCodeProfile): {
  anthropicModel?: string;
  defaultHaikuModel?: string;
  defaultOpusModel?: string;
  defaultSonnetModel?: string;
} | undefined {
  if (!profile.models) {
    return undefined;
  }

  return {
    anthropicModel: profile.models.anthropicModel,
    defaultHaikuModel: profile.models.defaultHaikuModel,
    defaultOpusModel: profile.models.defaultOpusModel,
    defaultSonnetModel: profile.models.defaultSonnetModel,
  };
}