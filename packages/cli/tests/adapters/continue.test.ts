import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ContinueAdapter } from "../../src/adapters/continue.js";
import type { ClaudeCodeProfile } from "../../src/types.js";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import * as yaml from "js-yaml";

const TEST_CONFIG_DIR = "/tmp/swixter-test-continue";
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/config.yaml`;

describe("ContinueAdapter", () => {
  let adapter: ContinueAdapter;

  beforeEach(() => {
    // Create adapter and override config path for testing
    adapter = new ContinueAdapter();
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
    test("should create new YAML config", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test-profile",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const config = yaml.load(content) as any;

      expect(config.models).toBeDefined();
      expect(config.models.length).toBe(1);
      expect(config.models[0].title).toBe("test-profile");
      expect(config.models[0].provider).toBe("anthropic");
      expect(config.models[0].apiKey).toBe("sk-test");
      expect(config.models[0].roles).toEqual(["chat", "edit", "apply"]);
    });

    test("should include apiBase from profile", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        baseURL: "https://api.anthropic.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models[0].apiBase).toBe("https://api.anthropic.com");
    });

    test("should update existing model", async () => {
      // Create initial config
      const initialConfig = {
        models: [{ title: "test-profile", provider: "openai", apiKey: "old-key" }],
      };
      await Bun.write(TEST_CONFIG_PATH, yaml.dump(initialConfig));

      const profile: ClaudeCodeProfile = {
        name: "test-profile",
        providerId: "anthropic",
        apiKey: "new-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models.length).toBe(1);
      expect(config.models[0].provider).toBe("anthropic");
      expect(config.models[0].apiKey).toBe("new-key");
    });

    test("should preserve other models", async () => {
      const initialConfig = {
        models: [
          { title: "other-model", provider: "openai", apiKey: "other-key" },
        ],
      };
      await Bun.write(TEST_CONFIG_PATH, yaml.dump(initialConfig));

      const profile: ClaudeCodeProfile = {
        name: "test-profile",
        providerId: "anthropic",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models.length).toBe(2);
      expect(config.models.find((m: any) => m.title === "other-model")).toBeDefined();
      expect(config.models.find((m: any) => m.title === "test-profile")).toBeDefined();
    });

    test("should map OpenRouter to openai provider", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "openrouter",
        apiKey: "sk-or-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models[0].provider).toBe("openai");
    });

    test("should map Ollama correctly", async () => {
      const profile: ClaudeCodeProfile = {
        name: "ollama-model",
        providerId: "ollama",
        apiKey: "",
        baseURL: "http://localhost:11434",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models[0].provider).toBe("ollama");
      expect(config.models[0].apiBase).toBe("http://localhost:11434");
      // apiKey should not be present for empty string
      expect(config.models[0].apiKey).toBeUndefined();
    });

    test("should handle custom provider", async () => {
      const profile: ClaudeCodeProfile = {
        name: "custom",
        providerId: "custom",
        apiKey: "custom-key",
        baseURL: "https://custom.api.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      // Custom provider should default to openai in provider map
      expect(config.models[0].provider).toBe("openai");
      expect(config.models[0].apiBase).toBe("https://custom.api.com");
    });

    test("should preserve existing config fields", async () => {
      const initialConfig = {
        models: [],
        tabAutocompleteOptions: {
          multilineCompletions: "always",
        },
        customCommands: [
          {
            name: "test",
            description: "Test command",
          },
        ],
      };
      await Bun.write(TEST_CONFIG_PATH, yaml.dump(initialConfig));

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.tabAutocompleteOptions).toEqual({
        multilineCompletions: "always",
      });
      expect(config.customCommands).toEqual([
        {
          name: "test",
          description: "Test command",
        },
      ]);
      expect(config.models.length).toBe(1);
    });

    test("should include model field when specified", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test-with-model",
        providerId: "openai",
        apiKey: "sk-test",
        model: "gpt-4",
        openaiModel: "gpt-4",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models[0].model).toBe("gpt-4");
    });

    test("should use openaiModel when model is not set", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test-with-openai-model",
        providerId: "openrouter",
        apiKey: "sk-or-test",
        openaiModel: "claude-3-5-sonnet-20241022",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models[0].model).toBe("claude-3-5-sonnet-20241022");
    });

    test("should not include model field when not specified", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test-without-model",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = yaml.load(await file.text()) as any;

      expect(config.models[0].model).toBeUndefined();
    });

    test("should create directory if it doesn't exist", async () => {
      const deepPath = "/tmp/swixter-test-deep-continue/nested/dir/config.yaml";
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
      rmSync("/tmp/swixter-test-deep-continue", { recursive: true });
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

    test("should return true if model exists with correct settings", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should return false if model doesn't exist", async () => {
      const config = {
        models: [
          { title: "other-model", provider: "openai", apiKey: "other-key" },
        ],
      };
      await Bun.write(TEST_CONFIG_PATH, yaml.dump(config));

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

    test("should return false if apiBase doesn't match", async () => {
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

    test("should handle corrupted YAML file", async () => {
      await Bun.write(TEST_CONFIG_PATH, "invalid: yaml: {{{{");

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

    test("should return false if models array is missing", async () => {
      const config = { other: "field" };
      await Bun.write(TEST_CONFIG_PATH, yaml.dump(config));

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

    test("should verify Ollama model without apiKey", async () => {
      const profile: ClaudeCodeProfile = {
        name: "ollama",
        providerId: "ollama",
        apiKey: "",
        baseURL: "http://localhost:11434",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should verify model field", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test-model",
        providerId: "openai",
        apiKey: "sk-test",
        model: "gpt-4",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should return false if model doesn't match", async () => {
      const profile1: ClaudeCodeProfile = {
        name: "test-model-mismatch",
        providerId: "openai",
        apiKey: "sk-test",
        model: "gpt-4",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile1);

      const profile2: ClaudeCodeProfile = {
        ...profile1,
        model: "gpt-3.5-turbo", // Different model
      };

      const result = await adapter.verify(profile2);
      expect(result).toBe(false);
    });

    test("should verify openaiModel field", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test-openai-model",
        providerId: "openrouter",
        apiKey: "sk-or-test",
        openaiModel: "claude-3-5-sonnet-20241022",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });
  });

  describe("remove", () => {
    test("should remove model from config", async () => {
      // First apply a profile
      const profile: ClaudeCodeProfile = {
        name: "test-profile",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Verify it was created
      let file = Bun.file(TEST_CONFIG_PATH);
      let content = await file.text();
      let config = yaml.load(content) as any;
      expect(config.models).toHaveLength(1);
      expect(config.models[0].title).toBe("test-profile");

      // Remove it
      await adapter.remove("test-profile");

      // Verify it was removed
      file = Bun.file(TEST_CONFIG_PATH);
      content = await file.text();
      config = yaml.load(content) as any;
      expect(config.models).toHaveLength(0);
    });

    test("should preserve other models when removing one", async () => {
      // Create config with two models
      const config = {
        models: [
          {
            title: "model1",
            provider: "anthropic",
            apiBase: "https://api.anthropic.com",
            apiKey: "key1",
            roles: ["chat", "edit", "apply"],
          },
          {
            title: "model2",
            provider: "openai",
            apiBase: "https://api.openai.com/v1",
            apiKey: "key2",
            roles: ["chat"],
          },
        ],
      };

      await Bun.write(TEST_CONFIG_PATH, yaml.dump(config));

      // Remove model1
      await adapter.remove("model1");

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const updatedConfig = yaml.load(content) as any;

      // model1 should be gone
      expect(updatedConfig.models).toHaveLength(1);
      expect(updatedConfig.models[0].title).toBe("model2");
    });

    test("should do nothing if config file doesn't exist", async () => {
      // Should not throw error
      await expect(adapter.remove("test")).resolves.toBeUndefined();
    });

    test("should do nothing if models array is missing", async () => {
      const config = { other: "field" };
      await Bun.write(TEST_CONFIG_PATH, yaml.dump(config));

      // Should not throw error
      await expect(adapter.remove("test")).resolves.toBeUndefined();

      // Config should remain unchanged
      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const updatedConfig = yaml.load(content) as any;
      expect(updatedConfig.other).toBe("field");
    });

    test("should do nothing if profile doesn't exist", async () => {
      const config = {
        models: [
          {
            title: "existing-model",
            provider: "anthropic",
            apiBase: "https://api.anthropic.com",
            apiKey: "key",
            roles: ["chat"],
          },
        ],
      };

      await Bun.write(TEST_CONFIG_PATH, yaml.dump(config));

      // Should not throw error
      await adapter.remove("nonexistent");

      // Config should remain unchanged
      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const updatedConfig = yaml.load(content) as any;
      expect(updatedConfig.models).toHaveLength(1);
      expect(updatedConfig.models[0].title).toBe("existing-model");
    });

    test("should preserve other fields in config", async () => {
      const config = {
        models: [
          {
            title: "test-model",
            provider: "anthropic",
            apiBase: "https://api.anthropic.com",
            apiKey: "key",
            roles: ["chat"],
          },
        ],
        tabAutocompleteModel: {
          title: "Tab Autocomplete",
          provider: "ollama",
          model: "qwen2.5-coder:7b",
        },
        customCommands: [
          {
            name: "test",
            prompt: "test prompt",
          },
        ],
      };

      await Bun.write(TEST_CONFIG_PATH, yaml.dump(config));

      await adapter.remove("test-model");

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const updatedConfig = yaml.load(content) as any;

      // Model should be removed
      expect(updatedConfig.models).toHaveLength(0);

      // Other fields should be preserved
      expect(updatedConfig.tabAutocompleteModel).toBeDefined();
      expect(updatedConfig.tabAutocompleteModel.title).toBe("Tab Autocomplete");
      expect(updatedConfig.customCommands).toBeDefined();
      expect(updatedConfig.customCommands).toHaveLength(1);
    });

    test("should handle corrupted config gracefully", async () => {
      await Bun.write(TEST_CONFIG_PATH, "invalid: yaml: {{{{");

      // Should not throw error, just log warning
      await expect(adapter.remove("test")).resolves.toBeUndefined();
    });
  });
});
