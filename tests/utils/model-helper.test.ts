import { describe, test, expect } from "bun:test";
import {
  buildProfileEnv,
  getModel,
  getOpenAIModel,
  hasClaudeModels,
  hasOpenAIModel,
  getClaudeModels,
} from "../../src/utils/model-helper.js";
import type { ClaudeCodeProfile } from "../../src/types.js";

const CLAUDE_ENV_MAPPING = {
  apiKey: "ANTHROPIC_API_KEY",
  authToken: "ANTHROPIC_AUTH_TOKEN",
  baseURL: "ANTHROPIC_BASE_URL",
  anthropicModel: "ANTHROPIC_MODEL",
  defaultHaikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  defaultOpusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  defaultSonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
};

const QWEN_ENV_MAPPING = {
  apiKey: "OPENAI_API_KEY",
  baseURL: "OPENAI_BASE_URL",
  openaiModel: "OPENAI_MODEL",
};

describe("buildProfileEnv", () => {
  test("builds Claude env with all fields", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "sk-test-key",
      authToken: "tok-123",
      baseURL: "https://api.anthropic.com",
      models: {
        anthropicModel: "claude-sonnet-4-20250514",
        defaultHaikuModel: "claude-haiku-4-20250506",
        defaultOpusModel: "claude-opus-4-20250514",
        defaultSonnetModel: "claude-sonnet-4-20250514",
      },
    };

    const env = buildProfileEnv(profile, CLAUDE_ENV_MAPPING, "https://api.anthropic.com");

    expect(env.ANTHROPIC_API_KEY).toBe("sk-test-key");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("tok-123");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-20250514");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-haiku-4-20250506");
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("claude-opus-4-20250514");
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("claude-sonnet-4-20250514");
  });

  test("builds Claude env without optional fields", () => {
    const profile: ClaudeCodeProfile = {
      name: "minimal",
      providerId: "anthropic",
      apiKey: "sk-key",
    };

    const env = buildProfileEnv(profile, CLAUDE_ENV_MAPPING, "https://api.anthropic.com");

    expect(env.ANTHROPIC_API_KEY).toBe("sk-key");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_MODEL).toBeUndefined();
  });

  test("builds Claude env with partial models", () => {
    const profile: ClaudeCodeProfile = {
      name: "partial",
      providerId: "anthropic",
      apiKey: "sk-key",
      models: {
        anthropicModel: "claude-sonnet-4-20250514",
      },
    };

    const env = buildProfileEnv(profile, CLAUDE_ENV_MAPPING, "");

    expect(env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-20250514");
    expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
  });

  test("builds Qwen env with model field", () => {
    const profile: ClaudeCodeProfile = {
      name: "qwen-test",
      providerId: "ollama",
      apiKey: "ollama-key",
      baseURL: "http://localhost:11434",
      model: "qwen3:32b",
    };

    const env = buildProfileEnv(profile, QWEN_ENV_MAPPING, "http://localhost:11434");

    expect(env.OPENAI_API_KEY).toBe("ollama-key");
    expect(env.OPENAI_BASE_URL).toBe("http://localhost:11434");
    expect(env.OPENAI_MODEL).toBe("qwen3:32b");
  });

  test("falls back to openaiModel for OPENAI_MODEL", () => {
    const profile: ClaudeCodeProfile = {
      name: "legacy",
      providerId: "ollama",
      openaiModel: "legacy-model",
    };

    const env = buildProfileEnv(profile, QWEN_ENV_MAPPING, "");

    expect(env.OPENAI_MODEL).toBe("legacy-model");
  });

  test("prefers model over openaiModel", () => {
    const profile: ClaudeCodeProfile = {
      name: "both",
      providerId: "ollama",
      model: "new-model",
      openaiModel: "old-model",
    };

    const env = buildProfileEnv(profile, QWEN_ENV_MAPPING, "");

    expect(env.OPENAI_MODEL).toBe("new-model");
  });

  test("skips empty baseURL", () => {
    const profile: ClaudeCodeProfile = {
      name: "no-url",
      providerId: "anthropic",
      apiKey: "sk-key",
    };

    const env = buildProfileEnv(profile, CLAUDE_ENV_MAPPING, "");

    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  test("skips empty apiKey", () => {
    const profile: ClaudeCodeProfile = {
      name: "no-key",
      providerId: "ollama",
      apiKey: "",
    };

    const env = buildProfileEnv(profile, CLAUDE_ENV_MAPPING, "http://localhost:11434");

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:11434");
  });

  test("supports custom apiKeyEnvName for Codex", () => {
    const profile: ClaudeCodeProfile = {
      name: "codex-test",
      providerId: "ollama",
      apiKey: "ollama-key",
      model: "qwen3:32b",
    };

    const env = buildProfileEnv(profile, QWEN_ENV_MAPPING, "", {
      apiKeyEnvName: "OLLAMA_API_KEY",
    });

    expect(env.OLLAMA_API_KEY).toBe("ollama-key");
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.OPENAI_MODEL).toBe("qwen3:32b");
  });

  test("returns empty object for empty profile", () => {
    const profile: ClaudeCodeProfile = {
      name: "empty",
      providerId: "ollama",
      apiKey: "",
    };

    const env = buildProfileEnv(profile, CLAUDE_ENV_MAPPING, "");

    expect(Object.keys(env)).toHaveLength(0);
  });
});

describe("getModel", () => {
  test("returns anthropicModel when models object exists", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "key",
      models: { anthropicModel: "claude-sonnet-4-20250514" },
    };
    expect(getModel(profile)).toBe("claude-sonnet-4-20250514");
  });

  test("returns model field for OpenAI-compatible", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "ollama",
      apiKey: "key",
      model: "qwen3:32b",
    };
    expect(getModel(profile)).toBe("qwen3:32b");
  });

  test("falls back to openaiModel", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "ollama",
      apiKey: "key",
      openaiModel: "old-model",
    };
    expect(getModel(profile)).toBe("old-model");
  });
});

describe("hasClaudeModels / hasOpenAIModel", () => {
  test("hasClaudeModels returns true for profiles with models", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "key",
      models: { anthropicModel: "claude-sonnet-4-20250514" },
    };
    expect(hasClaudeModels(profile)).toBe(true);
  });

  test("hasClaudeModels returns false without models", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "ollama",
      apiKey: "key",
    };
    expect(hasClaudeModels(profile)).toBe(false);
  });

  test("hasOpenAIModel returns true with model field", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "ollama",
      apiKey: "key",
      model: "qwen3:32b",
    };
    expect(hasOpenAIModel(profile)).toBe(true);
  });

  test("hasOpenAIModel returns false without model fields", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "key",
    };
    expect(hasOpenAIModel(profile)).toBe(false);
  });
});
