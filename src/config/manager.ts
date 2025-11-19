import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConfigFile, ClaudeCodeProfile } from "../types.js";
import { ConfigFileSchema } from "../types.js";
import { CONFIG_VERSION, SERIALIZATION } from "../constants/index.js";
import { getConfigPath as getSwixterConfigPath } from "../constants/paths.js";

/**
 * Get configuration file path
 */
export function getConfigPath(): string {
  return getSwixterConfigPath("swixter");
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
      // Save upgraded config
      await saveConfig(data as ConfigFile);
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

    // Format and save
    const content = JSON.stringify(config, null, SERIALIZATION.jsonIndent);
    await writeFile(configPath, content, "utf-8");
  } catch (error) {
    throw new Error(`Failed to save configuration: ${error}`);
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

  delete config.profiles[profileName];

  // Update active config for all coders
  for (const coder in config.coders) {
    if (config.coders[coder].activeProfile === profileName) {
      const remainingProfiles = Object.keys(config.profiles);
      config.coders[coder].activeProfile = remainingProfiles.length > 0 ? remainingProfiles[0] : "";
    }
  }

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
