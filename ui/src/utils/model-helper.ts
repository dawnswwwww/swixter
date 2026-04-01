import type { ModelFamily } from "../api/types";

export interface ProviderWithModelFamilies {
  id: string;
  name: string;
  baseURL: string;
  defaultModels: string[];
  modelFamilies?: ModelFamily[];
}

/**
 * Check if a provider has model families defined
 */
export function hasModelFamilies(provider: ProviderWithModelFamilies): boolean {
  return Array.isArray(provider.modelFamilies) && provider.modelFamilies.length > 0;
}

/**
 * Get all models from a provider (flattened from families or from defaultModels)
 */
export function getAllModels(provider: ProviderWithModelFamilies): string[] {
  if (hasModelFamilies(provider)) {
    return provider.modelFamilies!.flatMap((f) => f.models);
  }
  return provider.defaultModels;
}

/**
 * Get the family that contains a specific model
 */
export function getFamilyForModel(
  provider: ProviderWithModelFamilies,
  modelId: string
): ModelFamily | undefined {
  if (!hasModelFamilies(provider)) {
    return undefined;
  }
  return provider.modelFamilies!.find((f) => f.models.includes(modelId));
}

/**
 * Get the family ID for a given model
 */
export function getFamilyIdForModel(
  provider: ProviderWithModelFamilies,
  modelId: string
): string | undefined {
  const family = getFamilyForModel(provider, modelId);
  return family?.id;
}

/**
 * Get models filtered by family ID
 */
export function getModelsByFamily(
  provider: ProviderWithModelFamilies,
  familyId: string
): string[] {
  if (!hasModelFamilies(provider)) {
    return provider.defaultModels;
  }
  const family = provider.modelFamilies!.find((f) => f.id === familyId);
  return family?.models ?? [];
}
