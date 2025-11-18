import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { ConfigFile, ClaudeCodeProfile } from "../src/types.js";
import { ConfigFileSchema } from "../src/types.js";

const CONFIG_VERSION = "1.0.0";
let testConfigPath = "/tmp/swixter-test-config.json";

/**
 * 设置测试配置路径
 */
export function setTestConfigPath(path: string): void {
  testConfigPath = path;
}

/**
 * 获取测试配置路径
 */
export function getTestConfigPath(): string {
  return testConfigPath;
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
 * 加载测试配置文件
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
    console.error("加载配置失败，使用默认配置:", error);
    return createDefaultConfig();
  }
}

/**
 * 保存测试配置文件
 */
export async function saveTestConfig(config: ConfigFile): Promise<void> {
  try {
    ConfigFileSchema.parse(config);

    const content = JSON.stringify(config, null, 2);
    await Bun.write(testConfigPath, content);
  } catch (error) {
    throw new Error(`保存配置失败: ${error}`);
  }
}

/**
 * 添加或更新测试Profile
 */
export async function upsertTestProfile(profile: ClaudeCodeProfile): Promise<void> {
  const config = await loadTestConfig();

  const now = new Date().toISOString();
  const existingProfile = config.profiles[profile.name];

  config.profiles[profile.name] = {
    ...profile,
    createdAt: existingProfile?.createdAt || now,
    updatedAt: now,
  };

  if (Object.keys(config.profiles).length === 1) {
    config.activeProfile = profile.name;
  }

  await saveTestConfig(config);
}

/**
 * 设置激活的测试Profile
 */
export async function setActiveTestProfile(profileName: string): Promise<void> {
  const config = await loadTestConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" 不存在`);
  }

  config.activeProfile = profileName;
  await saveTestConfig(config);
}

/**
 * 获取当前激活的测试Profile
 */
export async function getActiveTestProfile(): Promise<ClaudeCodeProfile | null> {
  const config = await loadTestConfig();

  if (!config.activeProfile || !config.profiles[config.activeProfile]) {
    return null;
  }

  return config.profiles[config.activeProfile];
}

/**
 * 删除测试Profile
 */
export async function deleteTestProfile(profileName: string): Promise<void> {
  const config = await loadTestConfig();

  if (!config.profiles[profileName]) {
    throw new Error(`Profile "${profileName}" 不存在`);
  }

  delete config.profiles[profileName];

  if (config.activeProfile === profileName) {
    const remainingProfiles = Object.keys(config.profiles);
    config.activeProfile = remainingProfiles.length > 0 ? remainingProfiles[0] : "";
  }

  await saveTestConfig(config);
}

/**
 * 列出所有测试Profiles
 */
export async function listTestProfiles(): Promise<ClaudeCodeProfile[]> {
  const config = await loadTestConfig();
  return Object.values(config.profiles);
}
