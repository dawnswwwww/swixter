import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { exportConfig, importConfig, validateExportFile } from "../src/config/export.js";
import type { ClaudeCodeProfile } from "../src/types.js";
import { upsertProfile, getConfigPath } from "../src/config/manager.js";
import { existsSync, rmSync, unlinkSync } from "node:fs";

const TEST_CONFIG_PATH = "/tmp/swixter-test-config.json";

describe("配置导出和导入", () => {
  // 每个测试前清理
  beforeEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }
  });

  // 每个测试后清理
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }

    // 清理导出的测试文件
    const testFiles = [
      "/tmp/test-export-config.json",
      "/tmp/test-sanitize-export.json",
      "/tmp/test-import-export.json",
      "/tmp/valid-export.json",
      "/tmp/invalid-file.json",
      "/tmp/sanitized-export.json",
      "/tmp/overwrite-export.json",
    ];

    testFiles.forEach(file => {
      if (existsSync(file)) {
        try {
          unlinkSync(file);
        } catch (e) {
          // ignore
        }
      }
    });
  });
  test("应该能够导出配置到文件", async () => {
    const testProfile: ClaudeCodeProfile = {
      name: "export-test",
      providerId: "anthropic",
      apiKey: "test-api-key-123",
      model: "claude-3-5-sonnet-20241022",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(testProfile);

    const exportPath = "/tmp/test-export-config.json";
    await exportConfig(exportPath, { sanitizeKeys: false });

    // 验证文件存在
    const file = Bun.file(exportPath);
    const content = await file.text();
    const data = JSON.parse(content);

    expect(data.profiles).toBeDefined();
    expect(Array.isArray(data.profiles)).toBe(true);
    expect(data.profiles.length).toBeGreaterThan(0);
    expect(data.profiles[0].name).toBe("export-test");
    expect(data.profiles[0].apiKey).toBe("test-api-key-123");
    expect(data.exportedAt).toBeDefined();
    expect(data.version).toBeDefined();
  });

  test("应该能够导出配置并脱敏API Key", async () => {
    const testProfile: ClaudeCodeProfile = {
      name: "sanitize-test",
      providerId: "zhipu",
      apiKey: "sk-test123456789abcdef",
      model: "glm-4",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(testProfile);

    const exportPath = "/tmp/test-sanitize-export.json";
    await exportConfig(exportPath, { sanitizeKeys: true });

    const file = Bun.file(exportPath);
    const content = await file.text();
    const data = JSON.parse(content);

    expect(data.sanitized).toBe(true);
    expect(data.profiles[0].apiKey).toBe("sk-t***cdef"); // 验证脱敏格式
    expect(data.profiles[0].apiKey).not.toBe("sk-test123456789abcdef");
  });

  test("应该能够导入配置", async () => {
    // 首先创建一个包含测试数据的文件
    const testProfile: ClaudeCodeProfile = {
      name: "import-source",
      providerId: "minimax",
      apiKey: "import-key-123",
      model: "abab6.5s-chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(testProfile);

    const exportPath = "/tmp/test-import-export.json";
    await exportConfig(exportPath, { sanitizeKeys: false });

    // 删除原配置
    // await deleteProfile("import-source");

    // 导入配置
    const result = await importConfig(exportPath, { overwrite: true });

    expect(result.imported).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  test("应该能够验证导出文件的格式", async () => {
    const validPath = "/tmp/valid-export.json";
    const invalidPath = "/tmp/invalid-file.json";

    // 创建有效文件
    await exportConfig(validPath, { sanitizeKeys: false });

    // 验证有效文件
    let result = await validateExportFile(validPath);
    expect(result.valid).toBe(true);
    expect(result.profileCount).toBeGreaterThan(0);

    // 验证无效文件
    result = await validateExportFile(invalidPath);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("应该拒绝导入脱敏的配置文件", async () => {
    const sanitizedPath = "/tmp/sanitized-export.json";

    const testProfile: ClaudeCodeProfile = {
      name: "sanitize-import-test",
      providerId: "deepseek",
      apiKey: "test-key",
      model: "deepseek-chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(testProfile);
    await exportConfig(sanitizedPath, { sanitizeKeys: true });

    try {
      await importConfig(sanitizedPath, { skipSanitized: true });
      expect(true).toBe(false); // 应该不执行到这里
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("脱敏");
    }
  });

  test("应该支持导入时覆盖已存在的配置", async () => {
    const exportPath = "/tmp/overwrite-export.json";

    const profile1: ClaudeCodeProfile = {
      name: "overwrite-test",
      providerId: "moonshot",
      apiKey: "original-key",
      model: "moonshot-v1-8k",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(profile1);
    await exportConfig(exportPath, { sanitizeKeys: false });

    // 尝试不覆盖导入
    let result = await importConfig(exportPath, { overwrite: false });
    expect(result.skipped).toBeGreaterThan(0);

    // 覆盖导入
    result = await importConfig(exportPath, { overwrite: true });
    expect(result.imported).toBeGreaterThan(0);
  });
});
