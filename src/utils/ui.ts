import * as p from "@clack/prompts";
import pc from "picocolors";
import { MARKERS, EXIT_CODES, DISPLAY_PADDING } from "../constants/formatting.js";
import type { ClaudeCodeProfile } from "../types.js";
import { MISC_DEFAULTS } from "../constants/index.js";
import { getBuiltInPresetById } from "../providers/presets.js";

/**
 * Async operation wrapper with spinner
 */
export async function withSpinner<T>(
  startMsg: string,
  successMsg: string,
  operation: () => Promise<T>,
  errorPrefix = "Operation failed"
): Promise<T> {
  const spinner = p.spinner();
  spinner.start(startMsg);
  try {
    const result = await operation();
    spinner.stop(successMsg);
    return result;
  } catch (error) {
    spinner.stop(pc.red(`${errorPrefix}: ${error}`));
    throw error;
  }
}

/**
 * Standardized error display and exit
 */
export function showError(message: string, usage?: string, exitCode = EXIT_CODES.generalError): never {
  console.log();
  console.log(pc.red(message));
  if (usage) {
    console.log(pc.dim(usage));
  }
  console.log();
  process.exit(exitCode);
}

/**
 * Standardized success message display
 */
export function showSuccess(message: string, details?: Record<string, string>): void {
  console.log();
  console.log(pc.green(MARKERS.success) + " " + message);
  if (details) {
    console.log();
    for (const [key, value] of Object.entries(details)) {
      console.log(`  ${key}: ${pc.cyan(value)}`);
    }
  }
  console.log();
}

/**
 * Format profile list display
 */
export function formatProfileListItem(
  profile: ClaudeCodeProfile,
  isCurrent: boolean
): string {
  const preset = getBuiltInPresetById(profile.providerId);
  const marker = isCurrent ? pc.green(MARKERS.active) : pc.dim(MARKERS.inactive);
  const baseUrl = profile.baseURL || preset?.baseURL || MISC_DEFAULTS.baseUrlFallback;

  return `${marker} ${pc.cyan(profile.name.padEnd(DISPLAY_PADDING.name))} ${pc.dim("|")} ${(preset?.displayName || profile.providerId).padEnd(DISPLAY_PADDING.provider)} ${pc.dim("|")} ${pc.yellow(baseUrl)}`;
}

/**
 * Display profile details
 */
export function showProfileDetails(profile: ClaudeCodeProfile, prefix = ""): void {
  const preset = getBuiltInPresetById(profile.providerId);
  const baseUrl = profile.baseURL || preset?.baseURL || MISC_DEFAULTS.baseUrlFallback;

  console.log(`${prefix}Profile name: ${pc.cyan(profile.name)}`);
  console.log(`${prefix}Provider: ${pc.yellow(preset?.displayName || profile.providerId)}`);
  console.log(`${prefix}Base URL: ${pc.yellow(baseUrl)}`);

  if (profile.apiKey) {
    console.log(`${prefix}API Key: ${pc.dim(profile.apiKey.slice(0, 10) + "...")}`);
  }

  if (profile.authToken) {
    console.log(`${prefix}Auth Token: ${pc.dim(profile.authToken.slice(0, 10) + "...")}`);
  }
}
