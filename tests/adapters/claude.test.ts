import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ClaudeCodeAdapter } from "../../src/adapters/claude.js";
import type { ClaudeCodeProfile } from "../../src/types.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { getPresetById } from "../../src/providers/presets.js";

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
      // Smart merge: non-managed env vars are preserved
      expect(config.env.OTHER_VAR).toBe("this-will-be-removed");
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

    // New provider apply tests

    test("should apply Groq preset correctly", async () => {
      const groqPreset = getPresetById("groq");
      expect(groqPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-groq",
        providerId: groqPreset!.id,
        apiKey: "sk-groq-test",
        model: groqPreset!.defaultModels[0],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-groq-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(groqPreset!.baseURL);
    });

    test("should apply DeepSeek preset correctly", async () => {
      const deepseekPreset = getPresetById("deepseek");
      expect(deepseekPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-deepseek",
        providerId: deepseekPreset!.id,
        apiKey: "sk-deepseek-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-deepseek-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(deepseekPreset!.baseURL);
    });

    test("should apply Moonshot preset correctly", async () => {
      const moonshotPreset = getPresetById("moonshot");
      expect(moonshotPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-moonshot",
        providerId: moonshotPreset!.id,
        apiKey: "sk-moonshot-test",
        model: moonshotPreset!.defaultModels[0],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-moonshot-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(moonshotPreset!.baseURL);
    });

    test("should apply MiniMax CN preset correctly", async () => {
      const minimaxCnPreset = getPresetById("minimax-cn");
      expect(minimaxCnPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-minimax-cn",
        providerId: minimaxCnPreset!.id,
        apiKey: "sk-minimax-cn-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-minimax-cn-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(minimaxCnPreset!.baseURL);
    });

    test("should apply MiniMax Global preset correctly", async () => {
      const minimaxGlobalPreset = getPresetById("minimax-global");
      expect(minimaxGlobalPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-minimax-global",
        providerId: minimaxGlobalPreset!.id,
        apiKey: "sk-minimax-global-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-minimax-global-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(minimaxGlobalPreset!.baseURL);
    });

    test("should apply Dashscope preset correctly", async () => {
      const dashscopePreset = getPresetById("dashscope");
      expect(dashscopePreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-dashscope",
        providerId: dashscopePreset!.id,
        apiKey: "sk-dashscope-test",
        model: dashscopePreset!.defaultModels[0],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-dashscope-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(dashscopePreset!.baseURL);
    });

    test("should apply Together AI preset correctly", async () => {
      const togetherPreset = getPresetById("together");
      expect(togetherPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-together",
        providerId: togetherPreset!.id,
        apiKey: "sk-together-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-together-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(togetherPreset!.baseURL);
    });

    test("should apply Fireworks AI preset correctly", async () => {
      const fireworksPreset = getPresetById("fireworks");
      expect(fireworksPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-fireworks",
        providerId: fireworksPreset!.id,
        apiKey: "sk-fireworks-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-fireworks-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(fireworksPreset!.baseURL);
    });

    test("should apply 01.ai preset correctly", async () => {
      const zeroonePreset = getPresetById("zeroone");
      expect(zeroonePreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-zeroone",
        providerId: zeroonePreset!.id,
        apiKey: "sk-zeroone-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-zeroone-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(zeroonePreset!.baseURL);
    });

    test("should apply Zhipu CN preset correctly", async () => {
      const zhipuCnPreset = getPresetById("zhipu-cn");
      expect(zhipuCnPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-zhipu-cn",
        providerId: zhipuCnPreset!.id,
        apiKey: "sk-zhipu-cn-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_API_KEY).toBe("sk-zhipu-cn-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(zhipuCnPreset!.baseURL);
    });

    test("should apply Zhipu Global preset correctly", async () => {
      const zhipuGlobalPreset = getPresetById("zhipu-global");
      expect(zhipuGlobalPreset).toBeDefined();

      const profile: ClaudeCodeProfile = {
        name: "test-zhipu-global",
        providerId: zhipuGlobalPreset!.id,
        apiKey: "sk-zhipu-global-test",
        authToken: "sk-zhipu-auth-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = JSON.parse(await file.text());

      expect(config.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-zhipu-auth-test");
      expect(config.env.ANTHROPIC_BASE_URL).toBe(zhipuGlobalPreset!.baseURL);
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
