import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigFile, ClaudeCodeProfile } from "../src/types.js";
import { ConfigFileSchema } from "../src/types.js";

const CONFIG_VERSION = "2.0.0";
let testConfigPath = "/tmp/swixter-test-config.json";

/**
 * Set test config path
 */
export function setTestConfigPath(path: string): void {
  testConfigPath = path;
}

/**
 * Get test config path
 */
export function getTestConfigPath(): string {
  return testConfigPath;
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
 * Load test configuration file
 */
export async function loadTestConfig(): Promise<ConfigFile> {
  try {
    if (!existsSync(testConfigPath)) {
      const defaultConfig = createDefaultConfig();
      await saveTestConfig(defaultConfig);
      return defaultConfig;
    }

    const file = Bun.file(testConfigPath);
    const content = await file.text();
    const data = JSON.parse(content);

    const validated = ConfigFileSchema.parse(data);
    return validated;
  } catch (error) {
    console.error("Failed to load config, using default config:", error);
    return createDefaultConfig();
  }
}

/**
 * Save test configuration file
 */
export async function saveTestConfig(config: ConfigFile): Promise<void> {
  try {
    ConfigFileSchema.parse(config);

    const content = JSON.stringify(config, null, 2);
    await Bun.write(testConfigPath, content);
  } catch (error) {
    throw new Error(`Failed to save config: ${error}`);
  }
}

/**
 * Add or update test Profile
 */
export async function upsertTestProfile(profile: ClaudeCodeProfile, coder: string = "claude"): Promise<void> {
  const config = await loadTestConfig();

  const now = new Date().toISOString();
  const existingProfile = config.profiles[profile.name];

  config.profiles[profile.name] = {
    ...profile,
    createdAt: existingProfile?.createdAt || now,
    updatedAt: now,
  };

  // Ensure coder config exists
  if (!config.coders[coder]) {
    config.coders[coder] = { activeProfile: "" };
  }

  // If this is the first profile, automatically set as active
  if (Object.keys(config.profiles).length === 1 || !config.coders[coder].activeProfile) {
    config.coders[coder].activeProfile = profile.name;
  }

  await saveTestConfig(config);
}

/**
 * Set active test Profile
 */
export async function setActiveTestProfile(profileName: string, coder: string = "claude"): Promise<void> {
  const config = await loadTestConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" does not exist`);
  }

  // Ensure coder config exists
  if (!config.coders[coder]) {
    config.coders[coder] = { activeProfile: "" };
  }

  config.coders[coder].activeProfile = profileName;
  await saveTestConfig(config);
}

/**
 * Get current active test Profile
 */
export async function getActiveTestProfile(coder: string = "claude"): Promise<ClaudeCodeProfile | null> {
  const config = await loadTestConfig();

  const coderConfig = config.coders[coder];
  if (!coderConfig || !coderConfig.activeProfile || !config.profiles[coderConfig.activeProfile]) {
    return null;
  }

  return config.profiles[coderConfig.activeProfile];
}

/**
 * Delete test Profile
 */
export async function deleteTestProfile(profileName: string): Promise<void> {
  const config = await loadTestConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" does not exist`);
  }

  delete config.profiles[profileName];

  // Update all coder active configurations
  for (const coder in config.coders) {
    if (config.coders[coder].activeProfile === profileName) {
      const remainingProfiles = Object.keys(config.profiles);
      config.coders[coder].activeProfile = remainingProfiles.length > 0 ? remainingProfiles[0] : "";
    }
  }

  await saveTestConfig(config);
}

/**
 * List all test Profiles
 */
export async function listTestProfiles(): Promise<ClaudeCodeProfile[]> {
  const config = await loadTestConfig();
  return Object.values(config.profiles);
}
