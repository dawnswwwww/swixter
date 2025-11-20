import type { ProviderPreset } from "../types.js";
import { loadUserProviders } from "./user-providers.js";

/**
 * Anthropic official API preset (for Claude)
 */
export const anthropicPreset: ProviderPreset = {
  id: "anthropic",
  name: "Anthropic",
  displayName: "Anthropic (Official)",
  baseURL: "https://api.anthropic.com",
  defaultModels: [
    "claude-sonnet-4-20250514",
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
  ],
  authType: "api-key",
  headers: {
    "anthropic-version": "2023-06-01",
  },
  docs: "https://docs.anthropic.com/",
  wire_api: "responses",
  env_key: "ANTHROPIC_API_KEY",
};

/**
 * Ollama local model preset (for Qwen and other local models)
 */
export const ollamaPreset: ProviderPreset = {
  id: "ollama",
  name: "Ollama",
  displayName: "Ollama (Local models)",
  baseURL: "http://localhost:11434",
  defaultModels: [
    "qwen2.5-coder:7b",
    "qwen2.5-coder:14b",
    "qwen2.5-coder:32b",
    "qwen2.5:7b",
    "qwen2.5:14b",
  ],
  authType: "custom", // Ollama does not require authentication
  docs: "https://ollama.com/library",
  wire_api: "chat",
  env_key: "OLLAMA_API_KEY",
};

/**
 * Custom endpoint preset (template for third-party providers)
 */
export const customPreset: ProviderPreset = {
  id: "custom",
  name: "Custom",
  displayName: "Custom endpoint",
  baseURL: "",
  defaultModels: [],
  authType: "bearer",
  docs: "",
  wire_api: "chat",
  env_key: "OPENAI_API_KEY",
};

/**
 * Built-in preset providers list
 */
export const builtInPresets: ProviderPreset[] = [
  anthropicPreset,
  ollamaPreset,
  customPreset,
];

/**
 * Backward compatibility - synchronous access to built-in presets
 */
export const allPresets = builtInPresets;

/**
 * Get all providers (built-in + user-defined)
 * User-defined providers can override built-in ones with the same ID
 */
export async function getAllPresets(): Promise<ProviderPreset[]> {
  const userProviders = await loadUserProviders();
  const userProviderIds = new Set(userProviders.map(p => p.id));

  // Filter out built-in providers that are overridden by user providers
  const activeBuiltIns = builtInPresets.filter(p => !userProviderIds.has(p.id));

  // Merge: user providers take precedence
  return [...activeBuiltIns, ...userProviders];
}

/**
 * Get preset by ID (async version - checks both built-in and user-defined)
 */
export async function getPresetByIdAsync(id: string): Promise<ProviderPreset | undefined> {
  // Check user providers first (they can override built-in)
  const userProviders = await loadUserProviders();
  const userProvider = userProviders.find(p => p.id === id);

  if (userProvider) {
    return userProvider;
  }

  // Fall back to built-in
  return builtInPresets.find(preset => preset.id === id);
}

/**
 * Get preset by ID (synchronous version - only checks built-in presets)
 * Use this for backward compatibility and synchronous contexts
 */
export function getPresetById(id: string): ProviderPreset | undefined {
  return builtInPresets.find(preset => preset.id === id);
}

/**
 * Get all presets (excluding custom)
 */
export async function getStandardPresets(): Promise<ProviderPreset[]> {
  const allPresets = await getAllPresets();
  return allPresets.filter(preset => preset.id !== "custom");
}

/**
 * Alias for synchronous built-in access
 */
export function getBuiltInPresets(): ProviderPreset[] {
  return builtInPresets;
}

/**
 * Alias for synchronous built-in preset by ID
 */
export function getBuiltInPresetById(id: string): ProviderPreset | undefined {
  return getPresetById(id);
}
