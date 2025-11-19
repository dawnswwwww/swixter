import { VALIDATION_RULES, VALIDATION } from "../constants/index.js";
import { getPresetById } from "../providers/presets.js";

/**
 * Profile name validator
 */
export function validateProfileName(value: string): string | undefined {
  if (!value) {
    return VALIDATION.nameRequired;
  }

  if (value.length < VALIDATION_RULES.minProfileNameLength) {
    return VALIDATION.nameTooShort(VALIDATION_RULES.minProfileNameLength);
  }

  if (!VALIDATION_RULES.profileNamePattern.test(value)) {
    return VALIDATION.nameInvalidChars;
  }

  return undefined;
}

/**
 * API Key validator
 */
export function validateApiKey(value: string, providerId: string): string | undefined {
  const preset = getPresetById(providerId);

  // Ollama doesn't require API key
  if (providerId === "ollama") {
    return undefined;
  }

  if (!value && preset) {
    return VALIDATION.apiKeyRequired;
  }

  return undefined;
}

/**
 * URL validator
 */
export function validateUrl(value: string): string | undefined {
  if (!value) {
    return undefined; // URL is optional
  }

  try {
    new URL(value);
    return undefined;
  } catch {
    return VALIDATION.invalidUrl;
  }
}

/**
 * All validators collection
 */
export const ProfileValidators = {
  name: validateProfileName,
  apiKey: validateApiKey,
  url: validateUrl,
} as const;
