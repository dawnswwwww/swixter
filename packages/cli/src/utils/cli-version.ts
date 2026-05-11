/**
 * CLI version detection and comparison utilities
 *
 * Provides functions to detect installed CLI versions
 * and compare version strings using semver.
 */

import { execSync } from "node:child_process";
import { parse as semverParse, valid as semverValid } from "semver";

/**
 * Get the version of an installed CLI executable
 *
 * @param executable - The executable name (e.g., "claude", "codex", "qwen")
 * @returns The version string (e.g., "1.0.0"), or null if not found or version cannot be determined
 */
export async function getCliVersion(executable: string): Promise<string | null> {
  try {
    const output = execSync(`${executable} --version`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    // Try to extract version using semver parsing
    // Common patterns for version output:
    const patterns = [
      /v?(\d+\.\d+\.\d+[^ \n\r]*)/,           // v1.0.0 or 1.0.0 with suffix (e.g., 1.0.0-alpha)
      /v?(\d+\.\d+\.\d+)/,                    // v1.0.0 or 1.0.0
      /version[:\s]+(\d+\.\d+\.\d+[^ \n\r]*)/i, // "version: 1.0.0" or "Version 1.0.0-beta"
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        const versionStr = match[1];
        // Validate with semver
        const version = semverParse(versionStr, { loose: true });
        if (version) {
          return version.version; // Returns cleaned version string
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Compare two version strings using semver
 *
 * @param v1 - First version string (e.g., "1.0.0")
 * @param v2 - Second version string (e.g., "1.0.1")
 * @returns Negative number if v1 < v2, positive if v1 > v2, 0 if equal
 */
export function compareVersions(v1: string, v2: string): number {
  const semver1 = semverParse(v1, { loose: true });
  const semver2 = semverParse(v2, { loose: true });

  if (!semver1 || !semver2) {
    throw new Error(`Invalid semver: v1=${v1}, v2=${v2}`);
  }

  return semver1.compare(semver2);
}

/**
 * Check if a version string is valid according to semver spec
 *
 * @param version - Version string to validate
 * @returns true if valid semver, false otherwise
 */
export function isValidVersion(version: string): boolean {
  return semverValid(version) !== null;
}
