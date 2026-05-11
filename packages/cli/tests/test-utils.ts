import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";

// 测试配置路径
export const TEST_CONFIG_PATH = "/tmp/swixter-test-config.json";

/**
 * 清理测试配置文件
 */
export async function cleanupTestConfig(): Promise<void> {
  if (existsSync(TEST_CONFIG_PATH)) {
    try {
      await rm(TEST_CONFIG_PATH);
    } catch (error) {
      console.warn("Failed to remove test config:", error);
    }
  }
}

/**
 * 在所有测试前清理
 */
export async function setupTests(): Promise<void> {
  await cleanupTestConfig();
}

/**
 * 在所有测试后清理
 */
export async function teardownTests(): Promise<void> {
  await cleanupTestConfig();
}
