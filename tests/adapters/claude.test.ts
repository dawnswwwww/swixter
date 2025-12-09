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

    test("should replace all env vars (full replacement strategy)", async () => {
      const initialConfig = {
        env: {
          ANTHROPIC_API_KEY: "old-key",
          ANTHROPIC_BASE_URL: "https://old.url.com",
          OTHER_VAR: "this-will-be-removed",
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
      // Full replacement strategy: non-managed env vars are removed
      expect(config.env.OTHER_VAR).toBeUndefined();
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

    test("should remove undefined fields when switching profiles", async () => {
      // First, apply profile with both apiKey and authToken
      const profileA: ClaudeCodeProfile = {
        name: "profile-a",
        providerId: "anthropic",
        apiKey: "sk-ant-old",
        authToken: "tok-old",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profileA);
      let file = Bun.file(TEST_CONFIG_PATH);
      let config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-ant-old");
      expect(config.env.ANTHROPIC_AUTH_TOKEN).toBe("tok-old");

      // Then, apply profile with only apiKey (authToken undefined)
      const profileB: ClaudeCodeProfile = {
        name: "profile-b",
        providerId: "anthropic",
        apiKey: "sk-ant-new",
        // authToken is undefined
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profileB);
      file = Bun.file(TEST_CONFIG_PATH);
      config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-ant-new");
      // authToken should be removed (not preserved from previous profile)
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

    test("should create config with model configuration", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        models: {
          anthropicModel: "claude-3-5-sonnet-20241022",
          defaultHaikuModel: "claude-3-5-haiku-20241022",
          defaultOpusModel: "claude-3-opus-20240229",
          defaultSonnetModel: "claude-3-5-sonnet-20241022",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-test-key");
      expect(config.env.ANTHROPIC_MODEL).toBe("claude-3-5-sonnet-20241022");
      expect(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-3-5-haiku-20241022");
      expect(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-3-opus-20240229");
      expect(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-3-5-sonnet-20241022");
      expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    });

    test("should create config with partial model configuration", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        models: {
          anthropicModel: "claude-3-5-sonnet-20241022",
          // Only some models configured
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-test-key");
      expect(config.env.ANTHROPIC_MODEL).toBe("claude-3-5-sonnet-20241022");
      // Unconfigured models should not be set
      expect(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
      expect(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
      expect(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    });

    test("should create config without models (backward compatibility)", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        // No models field - should work fine
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-test-key");
      expect(config.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
      // Model env vars should not be set
      expect(config.env.ANTHROPIC_MODEL).toBeUndefined();
      expect(config.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
      expect(config.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
      expect(config.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
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

    test("should verify model configuration correctly", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        models: {
          anthropicModel: "claude-3-5-sonnet-20241022",
          defaultHaikuModel: "claude-3-5-haiku-20241022",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should return false if model configuration doesn't match", async () => {
      const profile1: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        models: {
          anthropicModel: "claude-3-5-sonnet-20241022",
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile1);

      const profile2: ClaudeCodeProfile = {
        ...profile1,
        models: {
          anthropicModel: "claude-3-opus-20240229", // Different model
        },
      };

      const result = await adapter.verify(profile2);
      expect(result).toBe(false);
    });

    test("should verify profile without models (backward compatibility)", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        // No models field
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });
  });
});
