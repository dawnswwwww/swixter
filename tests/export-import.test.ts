import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { exportConfig, importConfig, validateExportFile } from "../src/config/export.js";
import type { ClaudeCodeProfile } from "../src/types.js";
import { upsertProfile, getConfigPath } from "../src/config/manager.js";
import { existsSync, rmSync, unlinkSync } from "node:fs";

const TEST_CONFIG_PATH = "/tmp/swixter-test-config.json";

describe("Configuration Export and Import", () => {
  // Clean up before each test
  beforeEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }
  });

  // Clean up after each test
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }

    // Clean up exported test files
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
  test("should be able to export configuration to file", async () => {
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

    // Verify file exists
    const file = Bun.file(exportPath);
    const content = await file.text();
    const data = JSON.parse(content);

    expect(data.profiles).toBeDefined();
    expect(Array.isArray(data.profiles)).toBe(true);
    expect(data.profiles.length).toBeGreaterThan(0);
    const exportedProfile = data.profiles.find((p: any) => p.name === "export-test"); expect(exportedProfile).toBeDefined();
    expect(exportedProfile.apiKey).toBe("test-api-key-123");
    expect(data.exportedAt).toBeDefined();
    expect(data.version).toBeDefined();
  });

  test("should be able to export configuration and sanitize API Key", async () => {
    const testProfile: ClaudeCodeProfile = {
      name: "sanitize-test",
      providerId: "anthropic",
      apiKey: "sk-test123456789abcdef",
      model: "claude-3-5-sonnet-20241022",
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
    expect(data.profiles[0].apiKey).toContain("***"); expect(data.profiles[0].apiKey).not.toBe("sk-test123456789abcdef"); // Verify sanitization format
    expect(data.profiles[0].apiKey).not.toBe("sk-test123456789abcdef");
  });

  test("should be able to import configuration", async () => {
    // First create a file with test data
    const testProfile: ClaudeCodeProfile = {
      name: "import-source",
      providerId: "ollama",
      apiKey: "",
      model: "qwen2.5-coder:7b",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(testProfile);

    const exportPath = "/tmp/test-import-export.json";
    await exportConfig(exportPath, { sanitizeKeys: false });

    // Delete original configuration
    // await deleteProfile("import-source");

    // Import configuration
    const result = await importConfig(exportPath, { overwrite: true });

    expect(result.imported).toBeGreaterThan(0);
    expect(result.skipped).toBe(0);
    expect(result.errors.length).toBe(0);
  });

  test("should be able to validate export file format", async () => {
    const validPath = "/tmp/valid-export.json";
    const invalidPath = "/tmp/invalid-file.json";

    // Create valid file
    await exportConfig(validPath, { sanitizeKeys: false });

    // Validate valid file
    let result = await validateExportFile(validPath);
    expect(result.valid).toBe(true);
    expect(result.profileCount).toBeGreaterThan(0);

    // Validate invalid file
    result = await validateExportFile(invalidPath);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  test("should reject importing sanitized configuration file", async () => {
    const sanitizedPath = "/tmp/sanitized-export.json";

    const testProfile: ClaudeCodeProfile = {
      name: "sanitize-import-test",
      providerId: "anthropic",
      apiKey: "test-key",
      model: "claude-3-5-sonnet-20241022",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(testProfile);
    await exportConfig(sanitizedPath, { sanitizeKeys: true });

    try {
      await importConfig(sanitizedPath, { skipSanitized: true });
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("sanitized");
    }
  });

  test("should support overwriting existing configurations on import", async () => {
    const exportPath = "/tmp/overwrite-export.json";

    const profile1: ClaudeCodeProfile = {
      name: "overwrite-test",
      providerId: "ollama",
      apiKey: "",
      model: "qwen2.5-coder:7b",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(profile1);
    await exportConfig(exportPath, { sanitizeKeys: false });

    // Try import without overwrite
    let result = await importConfig(exportPath, { overwrite: false });
    expect(result.skipped).toBeGreaterThan(0);

    // Import with overwrite
    result = await importConfig(exportPath, { overwrite: true });
    expect(result.imported).toBeGreaterThan(0);
  });
});
