import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeCodeAdapter } from "../../src/adapters/claude.js";
import type { ClaudeCodeProfile } from "../../src/types.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const TEST_CONFIG_DIR = "/tmp/swixter-test-claude";
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/settings.json`;

describe("ClaudeCodeAdapter", () => {
  let adapter: ClaudeCodeAdapter;

  beforeEach(() => {
    // Create adapter and override config path for testing
    adapter = new ClaudeCodeAdapter();
    (adapter as any).configPath = TEST_CONFIG_PATH;

    // Clean up and create test directory
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
  });

  describe("apply", () => {
    test("should create new config with apiKey", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const config = JSON.parse(content);

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-test-key");
      expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    });

    test("should create new config with both apiKey and authToken", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        authToken: "sk-test-auth",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const config = JSON.parse(content);

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-test-key");
      expect(config.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-test-auth");
      expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    });

    test("should create config with custom baseURL", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "minimax",
        apiKey: "new-key",
        baseURL: "https://api.minimax.chat/v1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("new-key");
      expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.minimax.chat/v1");
    });

    test("should preserve existing config fields (smart merge)", async () => {
      // Create initial config with extra fields
      const initialConfig = {
        env: {
          ANTHROPIC_API_KEY: "old-key",
        },
        permissions: { allow: ["Read(*)"] },
        hooks: { "user-prompt-submit-hook": "echo test" },
      };
      await Bun.write(TEST_CONFIG_PATH, JSON.stringify(initialConfig, null, 2));

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "new-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("new-key");
      expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
      expect(config.permissions).toEqual({ allow: ["Read(*)"] });
      expect(config.hooks).toEqual({ "user-prompt-submit-hook": "echo test" });
    });

    test("should update existing API settings without touching other env vars", async () => {
      const initialConfig = {
        env: {
          ANTHROPIC_API_KEY: "old-key",
          ANTHROPIC_BASE_URL: "https://old.url.com",
          OTHER_VAR: "keep-this",
        },
      };
      await Bun.write(TEST_CONFIG_PATH, JSON.stringify(initialConfig));

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "new-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("new-key");
      expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
      expect(config.env.OTHER_VAR).toBe("keep-this");
    });

    test("should handle profile with only apiKey", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "openrouter",
        apiKey: "sk-or-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-or-test");
      expect(config.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    });

    test("should handle profile with only authToken", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "zhipu",
        apiKey: "",
        authToken: "sk-auth-only",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-auth-only");
      // Empty apiKey should not be set
      expect(config.env.ANTHROPIC_API_KEY).toBeUndefined();
    });

    test("should create directory if it doesn't exist", async () => {
      const deepPath = "/tmp/swixter-test-deep/nested/dir/settings.json";
      (adapter as any).configPath = deepPath;

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      expect(existsSync(deepPath)).toBe(true);

      // Clean up
      rmSync("/tmp/swixter-test-deep", { recursive: true });
    });
  });

  describe("verify", () => {
    test("should return false if config file doesn't exist", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBe(false);
    });

    test("should return true if config matches profile with apiKey", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should return true if config matches profile with authToken", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "zhipu",
        apiKey: "",
        authToken: "sk-auth-token",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should return true if both apiKey and authToken match", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        authToken: "sk-test-auth",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should return false if apiKey doesn't match", async () => {
      const profile1: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key-1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile1);

      const profile2: ClaudeCodeProfile = {
        ...profile1,
        apiKey: "sk-test-key-2",
      };

      const result = await adapter.verify(profile2);
      expect(result).toBeFalsy();
    });

    test("should return false if baseURL doesn't match", async () => {
      const profile1: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        baseURL: "https://api.anthropic.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile1);

      const profile2: ClaudeCodeProfile = {
        ...profile1,
        baseURL: "https://different.url.com",
      };

      const result = await adapter.verify(profile2);
      expect(result).toBe(false);
    });

    test("should handle corrupted config file", async () => {
      await Bun.write(TEST_CONFIG_PATH, "invalid json{{{");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBe(false);
    });

    test("should return false if env section is missing", async () => {
      const config = { permissions: { allow: ["Read(*)"] } };
      await Bun.write(TEST_CONFIG_PATH, JSON.stringify(config));

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBeFalsy();
    });
  });
});
