import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import type { ConfigFile, ClaudeCodeProfile } from "../types.js";
import { ConfigFileSchema } from "../types.js";

const CONFIG_VERSION = "1.0.0";

/**
 * 获取配置文件路径
 */
export function getConfigPath(): string {
  // Claude Code 默认配置目录
  return join(homedir(), ".config", "swixter", "config.json");
}

/**
 * 确保配置目录存在
 */
async function ensureConfigDir(): Promise<void> {
  const configPath = getConfigPath();
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }
}

/**
 * 创建默认配置
 */
function createDefaultConfig(): ConfigFile {
  return {
    activeProfile: "",
    profiles: {},
    version: CONFIG_VERSION,
  };
}

/**
 * 加载配置文件
 */
export async function loadConfig(): Promise<ConfigFile> {
  const configPath = getConfigPath();

  try {
    if (!existsSync(configPath)) {
      const defaultConfig = createDefaultConfig();
      await saveConfig(defaultConfig);
      return defaultConfig;
    }

    const file = Bun.file(configPath);
    const content = await file.text();
    const data = JSON.parse(content);

    // 验证配置结构
    const validated = ConfigFileSchema.parse(data);
    return validated;
  } catch (error) {
    console.error("加载配置失败，使用默认配置:", error);
    return createDefaultConfig();
  }
}

/**
 * 保存配置文件
 */
export async function saveConfig(config: ConfigFile): Promise<void> {
  await ensureConfigDir();
  const configPath = getConfigPath();

  try {
    // 验证配置
    ConfigFileSchema.parse(config);

    // 格式化并保存
    const content = JSON.stringify(config, null, 2);
    await Bun.write(configPath, content);
  } catch (error) {
    throw new Error(`保存配置失败: ${error}`);
  }
}

/**
 * 获取当前激活的 Profile
 */
export async function getActiveProfile(): Promise<ClaudeCodeProfile | null> {
  const config = await loadConfig();

  if (!config.activeProfile || !config.profiles[config.activeProfile]) {
    return null;
  }

  return config.profiles[config.activeProfile];
}

/**
 * 设置激活的 Profile
 */
export async function setActiveProfile(profileName: string): Promise<void> {
  const config = await loadConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" 不存在`);
  }

  config.activeProfile = profileName;
  await saveConfig(config);
}

/**
 * 添加或更新 Profile
 */
export async function upsertProfile(profile: ClaudeCodeProfile): Promise<void> {
  const config = await loadConfig();

  const now = new Date().toISOString();
  const existingProfile = config.profiles[profile.name];

  config.profiles[profile.name] = {
    ...profile,
    createdAt: existingProfile?.createdAt || now,
    updatedAt: now,
  };

  // 如果是第一个 profile，自动设为激活
  if (Object.keys(config.profiles).length === 1) {
    config.activeProfile = profile.name;
  }

  await saveConfig(config);
}

/**
 * 删除 Profile
 */
export async function deleteProfile(profileName: string): Promise<void> {
  const config = await loadConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" 不存在`);
  }

  delete config.profiles[profileName];

  // 如果删除的是激活的 profile，清空激活状态
  if (config.activeProfile === profileName) {
    const remainingProfiles = Object.keys(config.profiles);
    config.activeProfile = remainingProfiles.length > 0 ? remainingProfiles[0] : "";
  }

  await saveConfig(config);
}

/**
 * 列出所有 Profiles
 */
export async function listProfiles(): Promise<ClaudeCodeProfile[]> {
  const config = await loadConfig();
  return Object.values(config.profiles);
}

/**
 * 获取指定 Profile
 */
export async function getProfile(profileName: string): Promise<ClaudeCodeProfile | null> {
  const config = await loadConfig();
  return config.profiles[profileName] || null;
}

/**
 * 检查 Profile 是否存在
 */
export async function profileExists(profileName: string): Promise<boolean> {
  const config = await loadConfig();
  return profileName in config.profiles;
}
