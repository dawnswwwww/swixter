import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { ExportConfig, ClaudeCodeProfile } from "../types.js";
import { ExportConfigSchema } from "../types.js";
import { loadConfig, saveConfig } from "./manager.js";
import { API_KEY_FORMAT, SERIALIZATION, EXPORT_VERSION } from "../constants/index.js";

/**
 * Sanitize API Key
 */
function sanitizeApiKey(apiKey: string): string {
  if (apiKey.length <= API_KEY_FORMAT.sanitizeLength) {
    return "***";
  }
  const start = apiKey.slice(0, API_KEY_FORMAT.prefixLength);
  const end = apiKey.slice(-API_KEY_FORMAT.suffixLength);
  return `${start}***${end}`;
}

/**
 * Export configuration
 */
export async function exportConfig(
  filePath: string,
  options: {
    sanitizeKeys?: boolean;
    profileNames?: string[];
  } = {}
): Promise<void> {
  const { sanitizeKeys = false, profileNames } = options;

  const config = await loadConfig();
  let profilesToExport: ClaudeCodeProfile[];

  // Select profiles to export
  if (profileNames && profileNames.length > 0) {
    profilesToExport = profileNames
      .map(name => config.profiles[name])
      .filter(Boolean);

    if (profilesToExport.length === 0) {
      throw new Error("No profiles found to export");
    }
  } else {
    profilesToExport = Object.values(config.profiles);
  }

  if (profilesToExport.length === 0) {
    throw new Error("No profiles available to export");
  }

  // Sanitization processing
  if (sanitizeKeys) {
    profilesToExport = profilesToExport.map(profile => ({
      ...profile,
      apiKey: sanitizeApiKey(profile.apiKey),
    }));
  }

  const exportData: ExportConfig = {
    profiles: profilesToExport,
    exportedAt: new Date().toISOString(),
    version: EXPORT_VERSION,
    sanitized: sanitizeKeys,
  };

  // Validate export data
  ExportConfigSchema.parse(exportData);

  // Write to file
  const content = JSON.stringify(exportData, null, SERIALIZATION.jsonIndent);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Import configuration
 */
export async function importConfig(
  filePath: string,
  options: {
    overwrite?: boolean;
    skipSanitized?: boolean;
  } = {}
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const { overwrite = false, skipSanitized = true } = options;

  if (!existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  // Read file
  const content = await readFile(filePath, "utf-8");
  const data = JSON.parse(content);

  // Validate import data
  let importData: ExportConfig;
  try {
    importData = ExportConfigSchema.parse(data);
  } catch (error) {
    throw new Error(`Invalid import file format: ${error}`);
  }

  // If config is sanitized and set to skip, throw error
  if (importData.sanitized && skipSanitized) {
    throw new Error(
      "Import file contains sanitized API Keys and cannot be imported. Please use the complete configuration file or set skipSanitized=false"
    );
  }

  const config = await loadConfig();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of importData.profiles) {
    try {
      const exists = profile.name in config.profiles;

      // Check if should skip
      if (exists && !overwrite) {
        skipped++;
        continue;
      }

      // Update timestamps
      const now = new Date().toISOString();
      config.profiles[profile.name] = {
        ...profile,
        createdAt: exists ? config.profiles[profile.name].createdAt : now,
        updatedAt: now,
      };

      imported++;
    } catch (error) {
      errors.push(`Failed to import "${profile.name}": ${error}`);
    }
  }

  // If at least one profile was imported, save config
  if (imported > 0) {
    await saveConfig(config);
  }

  return { imported, skipped, errors };
}

/**
 * Validate export file
 */
export async function validateExportFile(filePath: string): Promise<{
  valid: boolean;
  error?: string;
  profileCount?: number;
  sanitized?: boolean;
}> {
  try {
    if (!existsSync(filePath)) {
      return { valid: false, error: "File does not exist" };
    }

    const content = await readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    const importData = ExportConfigSchema.parse(data);

    return {
      valid: true,
      profileCount: importData.profiles.length,
      sanitized: importData.sanitized,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
