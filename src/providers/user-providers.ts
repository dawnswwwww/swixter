import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import type { ProviderPreset } from "../types.js";
import { ProviderPresetSchema } from "../types.js";
import { getConfigPath } from "../config/manager.js";

/**
 * User providers configuration file schema
 */
interface UserProvidersConfig {
  version: string;
  providers: ProviderPreset[];
}

/**
 * Get path to user providers configuration file
 */
export function getUserProvidersPath(): string {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);
  return join(configDir, "providers.json");
}

/**
 * Load user-defined providers from file
 */
export async function loadUserProviders(): Promise<ProviderPreset[]> {
  const providersPath = getUserProvidersPath();

  if (!existsSync(providersPath)) {
    return [];
  }

  try {
    const content = await readFile(providersPath, "utf-8");
    const data = JSON.parse(content) as UserProvidersConfig;

    // Validate each provider
    return data.providers.map(p => ProviderPresetSchema.parse(p));
  } catch (error) {
    console.error(`Failed to load user providers: ${error}`);
    return [];
  }
}

/**
 * Save user-defined providers to file
 */
export async function saveUserProviders(providers: ProviderPreset[]): Promise<void> {
  const providersPath = getUserProvidersPath();
  const providersDir = dirname(providersPath);

  // Ensure directory exists
  if (!existsSync(providersDir)) {
    await mkdir(providersDir, { recursive: true });
  }

  const config: UserProvidersConfig = {
    version: "1.0.0",
    providers: providers,
  };

  await writeFile(providersPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Add or update a user provider
 */
export async function upsertUserProvider(provider: ProviderPreset): Promise<void> {
  // Validate provider
  ProviderPresetSchema.parse(provider);

  const providers = await loadUserProviders();
  const existingIndex = providers.findIndex(p => p.id === provider.id);

  if (existingIndex >= 0) {
    // Update existing
    providers[existingIndex] = provider;
  } else {
    // Add new
    providers.push(provider);
  }

  await saveUserProviders(providers);
}

/**
 * Delete a user provider by ID
 */
export async function deleteUserProvider(providerId: string): Promise<boolean> {
  const providers = await loadUserProviders();
  const filteredProviders = providers.filter(p => p.id !== providerId);

  if (filteredProviders.length === providers.length) {
    return false; // Provider not found
  }

  await saveUserProviders(filteredProviders);
  return true;
}

/**
 * Get a user provider by ID
 */
export async function getUserProvider(providerId: string): Promise<ProviderPreset | undefined> {
  const providers = await loadUserProviders();
  return providers.find(p => p.id === providerId);
}

/**
 * Check if a provider ID exists in user providers
 */
export async function userProviderExists(providerId: string): Promise<boolean> {
  const provider = await getUserProvider(providerId);
  return provider !== undefined;
}
