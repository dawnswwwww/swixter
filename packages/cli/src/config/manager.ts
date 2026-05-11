import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ConfigFile, ClaudeCodeProfile } from "../types.js";
import { ConfigFileSchema } from "../types.js";
import { CONFIG_VERSION, SERIALIZATION, CODER_REGISTRY } from "../constants/index.js";
import { getConfigPath as getSwixterConfigPath } from "../constants/paths.js";
import { getAdapter } from "../adapters/index.js";

/**
 * Get configuration file path
 */
export function getConfigPath(): string {
  return process.env.SWIXTER_CONFIG_PATH || getSwixterConfigPath("swixter");
}

/**
 * Ensure config directory exists
 */
async function ensureConfigDir(): Promise<void> {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
}

/**
 * Create default configuration
 */
function createDefaultConfig(): ConfigFile {
  return {
    profiles: {},
    coders: {},
    groups: {},
    version: CONFIG_VERSION,
  };
}

/**
 * Load configuration file
 */
export async function loadConfig(): Promise<ConfigFile> {
  const configPath = getConfigPath();

  try {
    if (!existsSync(configPath)) {
      const defaultConfig = createDefaultConfig();
      await saveConfig(defaultConfig);
      return defaultConfig;
    }

    const content = await readFile(configPath, "utf-8");
    const data = JSON.parse(content);

    // Migrate old version config (1.0.0 -> 2.0.0)
    if (data.version === "1.0.0" && data.activeProfile) {
      console.log("Detected old version configuration, automatically upgrading to 2.0.0...");
      data.coders = {
        claude: { activeProfile: data.activeProfile },
      };
      delete data.activeProfile;
      data.version = "2.0.0";
    }

    // Ensure groups field exists (for configs created before groups were added)
    if (!data.groups) {
      data.groups = {};
    }

    // Validate configuration structure
    const validated = ConfigFileSchema.parse(data);
    return validated;
  } catch (error) {
    console.error("Failed to load configuration, using default config:", error);
    return createDefaultConfig();
  }
}

/**
 * Save configuration file
 */
export async function saveConfig(config: ConfigFile): Promise<void> {
  await ensureConfigDir();
  const configPath = getConfigPath();

  try {
    // Validate configuration
    ConfigFileSchema.parse(config);

    // Format and write atomically via temp file + rename
    const content = JSON.stringify(config, null, SERIALIZATION.jsonIndent);
    const tmpPath = join(dirname(configPath), `.config.tmp-${Date.now()}`);
    await writeFile(tmpPath, content, "utf-8");
    await rename(tmpPath, configPath);
  } catch (error) {
    throw new Error(`Failed to save configuration: ${error}`);
  }
}

/**
 * Mark config as having local changes that need syncing.
 */
export function markDirty(config: ConfigFile): void {
  if (config.syncMeta) {
    config.syncMeta.dirty = true;
  }
}

/**
 * Get currently active Profile
 * @deprecated Use getActiveProfileForCoder instead
 */
export async function getActiveProfile(): Promise<ClaudeCodeProfile | null> {
  return getActiveProfileForCoder("claude");
}

/**
 * Get active Profile for specified coder
 */
export async function getActiveProfileForCoder(coder: string): Promise<ClaudeCodeProfile | null> {
  const config = await loadConfig();

  const coderConfig = config.coders[coder];
  if (!coderConfig || !coderConfig.activeProfile || !config.profiles[coderConfig.activeProfile]) {
    return null;
  }

  return config.profiles[coderConfig.activeProfile];
}

/**
 * Set active Profile
 * @deprecated Use setActiveProfileForCoder instead
 */
export async function setActiveProfile(profileName: string): Promise<void> {
  return setActiveProfileForCoder("claude", profileName);
}

/**
 * Set active Profile for specified coder
 */
export async function setActiveProfileForCoder(coder: string, profileName: string): Promise<void> {
  const config = await loadConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" does not exist`);
  }

  // Ensure coders field exists
  if (!config.coders[coder]) {
    config.coders[coder] = { activeProfile: "" };
  }

  config.coders[coder].activeProfile = profileName;
  markDirty(config);
  await saveConfig(config);
}

/**
 * Add or update Profile
 */
export async function upsertProfile(profile: ClaudeCodeProfile, coder?: string): Promise<void> {
  const config = await loadConfig();

  const now = new Date().toISOString();
  const existingProfile = config.profiles[profile.name];

  config.profiles[profile.name] = {
    ...profile,
    createdAt: existingProfile?.createdAt || now,
    updatedAt: now,
  };

  // If coder is specified, set as active config for that coder
  if (coder) {
    if (!config.coders[coder]) {
      config.coders[coder] = { activeProfile: "" };
    }

    // If it's the first profile, automatically set as active
    if (Object.keys(config.profiles).length === 1 || !config.coders[coder].activeProfile) {
      config.coders[coder].activeProfile = profile.name;
    }
  }

  markDirty(config);
  await saveConfig(config);
}

/**
 * Delete Profile
 */
export async function deleteProfile(profileName: string): Promise<void> {
  const config = await loadConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" does not exist`);
  }

  // Check if profile is referenced in any group
  const referencingGroups = Object.values(config.groups || {})
    .filter(group => group.profiles.includes(profileName))
    .map(group => group.name);

  if (referencingGroups.length > 0) {
    throw new Error(
      `Profile "${profileName}" is used in group(s): ${referencingGroups.join(", ")}. Remove it from the group(s) first.`
    );
  }

  // Clean up adapter configurations for ALL coders
  // A profile may have been applied to a coder in the past even if it's not currently active
  // We need to clean up adapter configs BEFORE deleting from swixter config
  const allCoders = Object.keys(CODER_REGISTRY);

  for (const coder of allCoders) {
    try {
      const adapter = getAdapter(coder);
      await adapter.remove(profileName);
    } catch (error) {
      // Don't fail the entire deletion if adapter cleanup fails
      console.warn(`Warning: Failed to cleanup ${coder} adapter configuration: ${error}`);
    }
  }

  delete config.profiles[profileName];

  // Clear active profile for coders that had this profile active
  for (const coder in config.coders) {
    if (config.coders[coder].activeProfile === profileName) {
      config.coders[coder].activeProfile = "";
    }
  }

  markDirty(config);
  await saveConfig(config);
}

/**
 * List all Profiles
 */
export async function listProfiles(): Promise<ClaudeCodeProfile[]> {
  const config = await loadConfig();
  return Object.values(config.profiles);
}

/**
 * Get specified Profile
 */
export async function getProfile(profileName: string): Promise<ClaudeCodeProfile | null> {
  const config = await loadConfig();
  return config.profiles[profileName] || null;
}

/**
 * Check if Profile exists
 */
export async function profileExists(profileName: string): Promise<boolean> {
  const config = await loadConfig();
  return profileName in config.profiles;
}

/**
 * Reset all data - delete all profiles and reset coder configs
 * This removes ALL profiles and clears active profile assignments
 */
export async function resetAllData(): Promise<void> {
  const config = await loadConfig();

  // Remove adapter configurations for all profiles across all coders
  const allCoders = Object.keys(CODER_REGISTRY);

  for (const profileName of Object.keys(config.profiles)) {
    for (const coder of allCoders) {
      try {
        const adapter = getAdapter(coder);
        await adapter.remove(profileName);
      } catch (error) {
        // Don't fail the entire reset if adapter cleanup fails
        console.warn(`Warning: Failed to cleanup ${coder} adapter configuration: ${error}`);
      }
    }
  }

  // Reset config to default (empty profiles and coders)
  const defaultConfig = createDefaultConfig();
  markDirty(defaultConfig);
  await saveConfig(defaultConfig);
}

/**
 * Clear sync metadata (e.g. on logout or user change).
 * Keeps local profiles/providers intact.
 */
export async function clearSyncMeta(): Promise<void> {
  const config = await loadConfig();
  if (config.syncMeta) {
    delete config.syncMeta;
    await saveConfig(config);
  }
}
