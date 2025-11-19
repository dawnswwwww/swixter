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
  });
});
