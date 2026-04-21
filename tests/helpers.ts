import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Test configuration path - uses temp directory for isolation
 */
export const TEST_CONFIG_PATH = join(tmpdir(), `swixter-test-config-${Date.now()}.json`);

/**
 * Cleanup test configuration file
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
 * Setup before all tests
 */
export async function setupTests(): Promise<void> {
  await cleanupTestConfig();
}

/**
 * Teardown after all tests
 */
export async function teardownTests(): Promise<void> {
  await cleanupTestConfig();
}

/**
 * Generate a unique test name with timestamp
 */
export function generateTestName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
