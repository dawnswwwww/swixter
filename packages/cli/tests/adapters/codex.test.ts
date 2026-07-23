import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { CodexAdapter } from "../../src/adapters/codex.js";
import * as codexBridge from "../../src/utils/codex-bridge.js";
import {
  resolveProviderEndpoints,
  setProxyAuthEnvForGUI,
  ensureProxyRunning,
} from "../../src/utils/codex-bridge.js";
import {
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  SWIXTER_PROXY_AUTH_TOKEN,
  SWIXTER_PROXY_ENV_KEY,
} from "../../src/constants/proxy.js";
import type { ClaudeCodeProfile, ProviderPreset } from "../../src/types.js";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

const TEST_CONFIG_DIR = "/tmp/swixter-test-codex";
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/config.toml`;
const TEST_AUTH_PATH = `${TEST_CONFIG_DIR}/auth.json`;

describe("CodexAdapter", () => {
  let adapter: CodexAdapter;

  let ensureProxySpy: ReturnType<typeof spyOn> | null = null;
  let setEnvSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(() => {
    // Create adapter and override paths for testing
    adapter = new CodexAdapter();
    (adapter as any).configPath = TEST_CONFIG_PATH;

    // Clean up and create test directory
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });

    // Stub proxy/launchctl side-effects globally so adapter.apply() never
    // actually starts a daemon or touches launchd during tests. The adapter
    // calls these via the `codexBridge` namespace import, so spyOn on the
    // namespace object intercepts them. Individual tests that want to
    // exercise the real side-effects restore these.
    ensureProxySpy = spyOn(codexBridge, "ensureProxyRunning").mockReturnValue(
      Promise.resolve(true) as never,
    );
    setEnvSpy = spyOn(codexBridge, "setProxyAuthEnvForGUI").mockReturnValue(
      undefined as never,
    );
  });

  afterEach(() => {
    // Clean up
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true });
    }

    // Clean up environment variables
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_API_KEY;

    // Restore stubs
    ensureProxySpy?.mockRestore();
    setEnvSpy?.mockRestore();
  });

  describe("apply - Basic Functionality", () => {
    test("should create new config.toml from scratch", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const config = parseToml(content);

      // Verify model_provider points at our provider (no deprecated profile= selector)
      expect(config.profile).toBeUndefined();
      expect(config.model_provider).toBe("swixter-test");

      // Verify NO [profiles.xxx] table is written (Codex 0.134.0+ uses standalone files)
      expect(config.profiles).toBeUndefined();

      // Verify standalone profile file exists
      const profileFile = parseToml(await Bun.file(`${TEST_CONFIG_DIR}/swixter-test.config.toml`).text());
      expect(profileFile.model_provider).toBe("swixter-test");

      // Verify provider table exists
      expect(config.model_providers["swixter-test"]).toBeDefined();
      expect(config.model_providers["swixter-test"].name).toBe("Ollama (Local models)");
      expect(config.model_providers["swixter-test"].base_url).toBe("http://localhost:11434");
      expect(config.model_providers["swixter-test"].wire_api).toBe("responses");
    });

    test("should create config with custom baseURL", async () => {
      const profile: ClaudeCodeProfile = {
        name: "custom-server",
        providerId: "custom",
        apiKey: "custom-key",
        baseURL: "https://api.example.com/v1",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-custom-server"].base_url).toBe("https://api.example.com/v1");
    });

    test("should update existing provider configuration", async () => {
      // First apply
      const profile1: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "key1",
        baseURL: "http://localhost:11434",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile1);

      // Update with new base URL
      const profile2: ClaudeCodeProfile = {
        ...profile1,
        baseURL: "http://localhost:12345",
      };

      await adapter.apply(profile2);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-test"].base_url).toBe("http://localhost:12345");
    });

    test("should preserve other providers when updating one", async () => {
      // Create initial config with two profiles
      const initialToml = `
profile = "user-profile"

[model_providers.user-provider]
name = "User Provider"
base_url = "https://user.example.com"
api_key = "user-key"

[profiles.user-profile]
model_provider = "user-provider"
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      // Apply Swixter profile
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // Verify both providers exist
      expect(config.model_providers["user-provider"]).toBeDefined();
      expect(config.model_providers["user-provider"].name).toBe("User Provider");
      expect(config.model_providers["swixter-test"]).toBeDefined();

      // Verify model_provider points at our provider (no deprecated profile= selector)
      expect(config.model_provider).toBe("swixter-test");
    });
  });

  describe("apply - Environment Variable Handling", () => {
    test("should always use env_key reference (per official Codex spec)", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "my-api-key",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // Should always use env_key, never api_key
      expect(config.model_providers["swixter-test"].env_key).toBe("OLLAMA_API_KEY");
      expect(config.model_providers["swixter-test"].api_key).toBeUndefined();
    });

    test("should use OPENAI_API_KEY for custom provider", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "custom-key",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-test"].env_key).toBe("OPENAI_API_KEY");
      expect(config.model_providers["swixter-test"].api_key).toBeUndefined();
    });

    test("should include env_key in config regardless of whether env var exists", async () => {
      // Ensure env var is NOT set
      delete process.env.OLLAMA_API_KEY;

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // Should still reference env_key, user needs to set the env var themselves
      expect(config.model_providers["swixter-test"].env_key).toBe("OLLAMA_API_KEY");
      expect(config.model_providers["swixter-test"].api_key).toBeUndefined();
    });
  });

  describe("apply - Smart Merge", () => {
    test("should preserve MCP servers configuration", async () => {
      const initialToml = `
[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[mcp_servers.filesystem]
command = "python"
args = ["fs_server.py"]
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // MCP servers should still exist
      expect(config.mcp_servers).toBeDefined();
      expect(config.mcp_servers.context7).toBeDefined();
      expect(config.mcp_servers.context7.command).toBe("npx");
      expect(config.mcp_servers.filesystem).toBeDefined();
    });

    test("should preserve approval_policy and sandbox_mode", async () => {
      const initialToml = `
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
exclude_tmpdir_env_var = false
network_access = true
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.approval_policy).toBe("on-request");
      expect(config.sandbox_mode).toBe("workspace-write");
      expect(config.sandbox_workspace_write).toBeDefined();
      expect(config.sandbox_workspace_write.network_access).toBe(true);
    });

    test("should preserve other profiles in profiles table", async () => {
      const initialToml = `
[profiles.my-work]
model = "gpt-4"
model_provider = "openai"
approval_policy = "never"

[profiles.my-personal]
model = "gpt-3.5-turbo"
model_provider = "openai"
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // User's own [profiles.*] tables are preserved (we don't touch foreign profiles)
      expect(config.profiles["my-work"]).toBeDefined();
      expect(config.profiles["my-work"].model).toBe("gpt-4");
      expect(config.profiles["my-personal"]).toBeDefined();

      // swixter does NOT add itself to [profiles]; it uses a standalone file
      expect(config.profiles["swixter-test"]).toBeUndefined();
      const swixterProfileFile = `${TEST_CONFIG_DIR}/swixter-test.config.toml`;
      expect(existsSync(swixterProfileFile)).toBe(true);
    });

    test("should preserve unknown/custom fields", async () => {
      const initialToml = `
custom_field = "custom_value"
model_context_window = 128000
model_max_output_tokens = 4096

[features]
web_search_request = true
view_image_tool = false

[otel]
environment = "production"
log_user_prompt = false
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.custom_field).toBe("custom_value");
      expect(config.model_context_window).toBe(128000);
      expect(config.model_max_output_tokens).toBe(4096);
      expect(config.features).toBeDefined();
      expect(config.features.web_search_request).toBe(true);
      expect(config.otel).toBeDefined();
      expect(config.otel.environment).toBe("production");
    });
  });

  describe("apply - Standalone profile file (Codex 0.134.0+)", () => {
    test("should write profile to a standalone .config.toml file, not [profiles.xxx] in config.toml", async () => {
      const profile: ClaudeCodeProfile = {
        name: "kimi-codex",
        providerId: "custom",
        apiKey: "sk-test-key",
        baseURL: "https://api.kimi.com/coding/v1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Standalone profile file exists
      const profileFilePath = `${TEST_CONFIG_DIR}/swixter-kimi-codex.config.toml`;
      expect(existsSync(profileFilePath)).toBe(true);

      const profileFile = parseToml(await Bun.file(profileFilePath).text());
      // Per Codex spec: top-level keys in profile file, NOT nested under [profiles.xxx]
      expect(profileFile.profiles).toBeUndefined();
      expect(profileFile.model_provider).toBe("swixter-kimi-codex");
      expect(profileFile.model).toBeUndefined(); // no model set on this profile
    });

    test("should NOT write top-level profile= selector or [profiles.xxx] table in config.toml", async () => {
      const profile: ClaudeCodeProfile = {
        name: "kimi-codex",
        providerId: "custom",
        apiKey: "sk-test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const config = parseToml(await Bun.file(TEST_CONFIG_PATH).text());
      // config.toml must not contain the deprecated selector/table
      expect(config.profile).toBeUndefined();
      expect(config.profiles).toBeUndefined();
      // but model_provider at root still points at the provider table
      expect(config.model_provider).toBe("swixter-kimi-codex");
    });

    test("should write model into standalone profile file when profile has a model", async () => {
      const profile: ClaudeCodeProfile = {
        name: "kimi-codex",
        providerId: "custom",
        apiKey: "sk-test-key",
        model: "kimi-for-coding",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const profileFilePath = `${TEST_CONFIG_DIR}/swixter-kimi-codex.config.toml`;
      const profileFile = parseToml(await Bun.file(profileFilePath).text());
      expect(profileFile.model).toBe("kimi-for-coding");
      expect(profileFile.model_provider).toBe("swixter-kimi-codex");
    });

    test("verify should pass when standalone profile file and provider table exist", async () => {
      const profile: ClaudeCodeProfile = {
        name: "kimi-codex",
        providerId: "custom",
        apiKey: "sk-test-key",
        model: "kimi-for-coding",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      expect(await adapter.verify(profile)).toBe(true);
    });

    test("verify should fail when standalone profile file is missing", async () => {
      const profile: ClaudeCodeProfile = {
        name: "kimi-codex",
        providerId: "custom",
        apiKey: "sk-test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Delete the standalone profile file
      rmSync(`${TEST_CONFIG_DIR}/swixter-kimi-codex.config.toml`);

      expect(await adapter.verify(profile)).toBe(false);
    });

    test("remove should delete the standalone profile file and clean config.toml", async () => {
      const profile: ClaudeCodeProfile = {
        name: "kimi-codex",
        providerId: "custom",
        apiKey: "sk-test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const profileFilePath = `${TEST_CONFIG_DIR}/swixter-kimi-codex.config.toml`;
      expect(existsSync(profileFilePath)).toBe(true);

      await adapter.remove("kimi-codex");

      // File gone
      expect(existsSync(profileFilePath)).toBe(false);
      const config = parseToml(await Bun.file(TEST_CONFIG_PATH).text());
      expect(config.model_providers?.["swixter-kimi-codex"]).toBeUndefined();
    });
  });

  describe("apply - TOML Features", () => {
    test("should handle nested tables correctly", async () => {
      const initialToml = `
[shell_environment_policy]
inherit = "none"

[shell_environment_policy.set]
PATH = "/usr/bin"
MY_FLAG = "1"
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.shell_environment_policy).toBeDefined();
      expect(config.shell_environment_policy.inherit).toBe("none");
      expect(config.shell_environment_policy.set).toBeDefined();
      expect(config.shell_environment_policy.set.PATH).toBe("/usr/bin");
    });

    test("should handle arrays correctly", async () => {
      const initialToml = `
notify = ["python3", "/path/to/notify.py"]

[mcp_servers.test]
command = "node"
args = ["server.js", "--port", "8080"]
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.notify).toEqual(["python3", "/path/to/notify.py"]);
      expect(config.mcp_servers.test.args).toEqual(["server.js", "--port", "8080"]);
    });

    test("should properly escape strings in TOML", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test-with-quotes",
        providerId: "custom",
        apiKey: 'key-with-"quotes"',
        baseURL: "https://api.example.com/path?param=value&other=test",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const config = parseToml(content);

      // Should parse back correctly despite special characters in base_url
      // API key is now always referenced via env_key, not stored directly
      expect(config.model_providers["swixter-test-with-quotes"].env_key).toBe("OPENAI_API_KEY");
      expect(config.model_providers["swixter-test-with-quotes"].api_key).toBeUndefined();
      expect(config.model_providers["swixter-test-with-quotes"].base_url).toBe("https://api.example.com/path?param=value&other=test");
    });
  });

  describe("apply - Edge Cases", () => {
    test("should handle corrupted TOML file by creating backup", async () => {
      // Write invalid TOML
      writeFileSync(TEST_CONFIG_PATH, "invalid [[ toml } content", "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Should create backup and new valid config
      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_provider).toBe("swixter-test");

      // Backup file should exist
      const backupFiles = require("node:fs").readdirSync(TEST_CONFIG_DIR).filter((f: string) => f.includes("backup"));
      expect(backupFiles.length).toBeGreaterThan(0);
    });

    test("should create config directory if it doesn't exist", async () => {
      // Remove the directory
      rmSync(TEST_CONFIG_DIR, { recursive: true });

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      expect(existsSync(TEST_CONFIG_DIR)).toBe(true);
      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);
    });

    test("should handle empty config file", async () => {
      writeFileSync(TEST_CONFIG_PATH, "", "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_provider).toBe("swixter-test");
    });

    test("should handle config with only comments", async () => {
      writeFileSync(TEST_CONFIG_PATH, "# This is a comment\n# Another comment\n", "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_provider).toBe("swixter-test");
    });

    test("should throw error for unknown provider", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "unknown-provider-12345",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await expect(adapter.apply(profile)).rejects.toThrow("Unknown provider");
    });
  });

  describe("verify", () => {
    test("should return true for correctly applied profile", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const result = await adapter.verify(profile);
      expect(result).toBe(true);
    });

    test("should return false when config file doesn't exist", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBe(false);
    });

    test("should return false when profile is not active", async () => {
      // Create config with different active profile
      const toml = `
profile = "other-profile"

[model_providers."swixter-test"]
name = "Ollama"
base_url = "http://localhost:11434"

[profiles."swixter-test"]
model_provider = "swixter-test"
`;
      writeFileSync(TEST_CONFIG_PATH, toml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBe(false);
    });

    test("should return false when profile table doesn't exist", async () => {
      const toml = `
profile = "swixter-test"

[model_providers."swixter-test"]
name = "Ollama"
base_url = "http://localhost:11434"
`;
      writeFileSync(TEST_CONFIG_PATH, toml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBe(false);
    });

    test("should return false when provider table doesn't exist", async () => {
      const toml = `
profile = "swixter-test"

[profiles."swixter-test"]
model_provider = "swixter-test"
`;
      writeFileSync(TEST_CONFIG_PATH, toml, "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBe(false);
    });

    test("should return false when config is corrupted", async () => {
      writeFileSync(TEST_CONFIG_PATH, "invalid {{{ toml", "utf-8");

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const result = await adapter.verify(profile);
      expect(result).toBe(false);
    });
  });

  describe("wire_api field", () => {
    test("should set wire_api to 'responses' for all providers", async () => {
      const profile: ClaudeCodeProfile = {
        name: "ollama-test",
        providerId: "ollama",
        apiKey: "test-key",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-ollama-test"].wire_api).toBe("responses");
      // requires_openai_auth must NOT be set: it's reserved for OpenAI-managed auth
      // and is mutually exclusive with env_key. swixter uses env_key only.
      expect(config.model_providers["swixter-ollama-test"].requires_openai_auth).toBeUndefined();
      expect(config.model_providers["swixter-ollama-test"].env_key).toBe("OLLAMA_API_KEY");
    });

    test("should set wire_api to 'responses' for Custom provider", async () => {
      const profile: ClaudeCodeProfile = {
        name: "custom-test",
        providerId: "custom",
        apiKey: "test-key",
        baseURL: "https://api.example.com",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-custom-test"].wire_api).toBe("responses");
      expect(config.model_providers["swixter-custom-test"].requires_openai_auth).toBeUndefined();
      expect(config.model_providers["swixter-custom-test"].env_key).toBe("OPENAI_API_KEY");
    });
  });

  describe("default model field", () => {
    test("should set default model from provider preset", async () => {
      const profile: ClaudeCodeProfile = {
        name: "ollama-test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Default model now lives in the standalone profile file (Codex 0.134.0+)
      const profileFile = parseToml(await Bun.file(`${TEST_CONFIG_DIR}/swixter-ollama-test.config.toml`).text());

      // Should have model from Ollama preset's defaultModels[0]
      expect(profileFile.model).toBe("qwen2.5-coder:7b");
    });
  });

  describe("env_key authentication (no auth.json)", () => {
    test("should NOT write API key to auth.json on apply (env_key model only)", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "sk-test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // auth.json must not be created by swixter — keys are provided via env var
      expect(existsSync(TEST_AUTH_PATH)).toBe(false);
    });

    test("provider table uses env_key and never requires_openai_auth", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "sk-test-key",
        envKey: "MY_CUSTOM_KEY",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const config = parseToml(await Bun.file(TEST_CONFIG_PATH).text());
      const provider = config.model_providers["swixter-test"];
      expect(provider.env_key).toBe("MY_CUSTOM_KEY");
      expect(provider.requires_openai_auth).toBeUndefined();
    });

    test("verify should pass based on config structure regardless of apiKey", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "sk-some-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);
      // No auth.json needed; verification is structural
      expect(await adapter.verify(profile)).toBe(true);
    });

    test("apply must not touch an existing auth.json owned by Codex login", async () => {
      // Codex itself may write auth.json for ChatGPT login. swixter must leave it alone.
      writeFileSync(TEST_AUTH_PATH, JSON.stringify({ tokens: "codex-owned" }, null, 2));

      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "sk-test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const auth = JSON.parse(await Bun.file(TEST_AUTH_PATH).text());
      expect(auth.tokens).toBe("codex-owned");
      expect(auth.OPENAI_API_KEY).toBeUndefined();
    });
  });

  describe("remove", () => {
    test("should remove profile and provider entries from config", async () => {
      // First apply a profile
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Verify it was created (standalone file + provider table, no [profiles])
      let config = parseToml(await Bun.file(TEST_CONFIG_PATH).text());
      expect(existsSync(`${TEST_CONFIG_DIR}/swixter-test.config.toml`)).toBe(true);
      expect(config.model_providers["swixter-test"]).toBeDefined();
      expect(config.model_provider).toBe("swixter-test");

      // Remove it
      await adapter.remove("test");

      // Verify it was removed
      config = parseToml(await Bun.file(TEST_CONFIG_PATH).text());
      expect(existsSync(`${TEST_CONFIG_DIR}/swixter-test.config.toml`)).toBe(false);
      expect(config.model_providers["swixter-test"]).toBeUndefined();
      expect(config.model_provider).toBeUndefined();
    });

    test("should preserve other profiles when removing one", async () => {
      // Create initial config with two profiles
      const initialToml = `
profile = "swixter-test1"

[model_providers."swixter-test1"]
name = "Ollama"
base_url = "http://localhost:11434"
env_key = "OLLAMA_API_KEY"

[profiles."swixter-test1"]
model_provider = "swixter-test1"
model = "qwen2.5-coder:7b"

[model_providers."swixter-test2"]
name = "Custom"
base_url = "https://api.example.com"
env_key = "OPENAI_API_KEY"

[profiles."swixter-test2"]
model_provider = "swixter-test2"
model = "gpt-4"
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      // Remove test1
      await adapter.remove("test1");

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // test1 should be gone
      expect(config.profiles["swixter-test1"]).toBeUndefined();
      expect(config.model_providers["swixter-test1"]).toBeUndefined();

      // test2 should still exist
      expect(config.profiles["swixter-test2"]).toBeDefined();
      expect(config.model_providers["swixter-test2"]).toBeDefined();
    });

    test("should clear active profile if it's being removed", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Verify it's active (model_provider points at our provider)
      let config = parseToml(await Bun.file(TEST_CONFIG_PATH).text());
      expect(config.model_provider).toBe("swixter-test");

      // Remove it
      await adapter.remove("test");

      // Verify active provider was cleared
      config = parseToml(await Bun.file(TEST_CONFIG_PATH).text());
      expect(config.model_provider).toBeUndefined();
    });

    test("should not clear active profile if removing a different profile", async () => {
      // Create config with two profiles, test2 is active
      const initialToml = `
profile = "swixter-test2"
model_provider = "swixter-test2"

[model_providers."swixter-test1"]
name = "Ollama"
base_url = "http://localhost:11434"
env_key = "OLLAMA_API_KEY"

[profiles."swixter-test1"]
model_provider = "swixter-test1"

[model_providers."swixter-test2"]
name = "Custom"
base_url = "https://api.example.com"
env_key = "OPENAI_API_KEY"

[profiles."swixter-test2"]
model_provider = "swixter-test2"
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      // Remove test1
      await adapter.remove("test1");

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // Active profile should still be test2
      expect(config.profile).toBe("swixter-test2");
      expect(config.model_provider).toBe("swixter-test2");
    });

    test("should do nothing if config file doesn't exist", async () => {
      // Should not throw error
      await expect(adapter.remove("test")).resolves.toBeUndefined();
    });

    test("should do nothing if profile doesn't exist", async () => {
      // Create config without the profile we're trying to remove
      const initialToml = `
profile = "other-profile"

[model_providers."other-provider"]
name = "Other"
base_url = "http://example.com"

[profiles."other-profile"]
model_provider = "other-provider"
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      // Should not throw error
      await adapter.remove("nonexistent");

      // Config should remain unchanged
      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());
      expect(config.profile).toBe("other-profile");
      expect(config.profiles["other-profile"]).toBeDefined();
    });

    test("should preserve MCP servers and other config when removing profile", async () => {
      // Create config with profile and MCP servers
      const initialToml = `
profile = "swixter-test"
approval_policy = "on-request"

[mcp_servers.context7]
command = "npx"
args = ["-y", "@upstash/context7-mcp"]

[model_providers."swixter-test"]
name = "Ollama"
base_url = "http://localhost:11434"
env_key = "OLLAMA_API_KEY"

[profiles."swixter-test"]
model_provider = "swixter-test"
`;
      writeFileSync(TEST_CONFIG_PATH, initialToml, "utf-8");

      await adapter.remove("test");

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // Profile/provider should be removed
      expect(config.profiles?.["swixter-test"]).toBeUndefined();
      expect(config.model_providers?.["swixter-test"]).toBeUndefined();

      // Other config should be preserved
      expect(config.mcp_servers).toBeDefined();
      expect(config.mcp_servers.context7).toBeDefined();
      expect(config.approval_policy).toBe("on-request");
    });

    test("should handle corrupted config gracefully", async () => {
      writeFileSync(TEST_CONFIG_PATH, "invalid {{{ toml", "utf-8");

      // Should not throw error, just log warning
      await expect(adapter.remove("test")).resolves.toBeUndefined();
    });
  });

  describe("custom env_key handling", () => {
    test("should use custom env_key from profile when provided", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "test-key",
        envKey: "MY_CUSTOM_API_KEY",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-test"].env_key).toBe("MY_CUSTOM_API_KEY");
    });

    test("should fall back to preset env_key when profile env_key is not provided", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        apiFormat: "openai_responses",
        // No envKey field
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-test"].env_key).toBe("OLLAMA_API_KEY");
    });

    test("should fall back to OPENAI_API_KEY when env_key is empty string", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "test-key",
        envKey: "",  // Empty string should use default
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // Empty string falls back to preset, which for custom is OPENAI_API_KEY
      expect(config.model_providers["swixter-test"].env_key).toBe("OPENAI_API_KEY");
    });

    test("getEnvExportCommands should use custom env_key", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        envKey: "MY_CUSTOM_ENV",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const commands = await adapter.getEnvExportCommands(profile);

      expect(commands).toEqual(['export MY_CUSTOM_ENV="test-key"']);
    });

    test("getEnvExportCommands should fall back to preset env_key", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        // No custom envKey
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const commands = await adapter.getEnvExportCommands(profile);

      expect(commands).toEqual(['export OLLAMA_API_KEY="test-key"']);
    });

    test("should handle custom env_key with special characters", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "test-key",
        envKey: "MY_API_KEY_2024",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-test"].env_key).toBe("MY_API_KEY_2024");
    });

    test("getEnvExportCommands should include OPENAI_MODEL when model is set", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "openai",
        apiKey: "sk-test",
        model: "gpt-4",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const commands = await adapter.getEnvExportCommands(profile);

      expect(commands).toEqual([
        'export OPENAI_API_KEY="sk-test"',
        'export OPENAI_MODEL="gpt-4"'
      ]);
    });

    test("getEnvExportCommands should include OPENAI_MODEL when openaiModel is set", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "sk-or-test",
        openaiModel: "claude-3-5-sonnet-20241022",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const commands = await adapter.getEnvExportCommands(profile);

      expect(commands).toEqual([
        'export OPENAI_API_KEY="sk-or-test"',
        'export OPENAI_MODEL="claude-3-5-sonnet-20241022"'
      ]);
    });

    test("getEnvExportCommands should prefer model over openaiModel", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "openai",
        apiKey: "sk-test",
        model: "gpt-4",
        openaiModel: "gpt-3.5-turbo", // Should be ignored
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const commands = await adapter.getEnvExportCommands(profile);

      expect(commands).toEqual([
        'export OPENAI_API_KEY="sk-test"',
        'export OPENAI_MODEL="gpt-4"'
      ]);
    });

    test("getEnvExportCommands should not include OPENAI_MODEL when no model is set", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "openai",
        apiKey: "sk-test",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const commands = await adapter.getEnvExportCommands(profile);

      expect(commands).toEqual([
        'export OPENAI_API_KEY="sk-test"'
      ]);
    });

    test("should preserve custom env_key when updating other profile fields", async () => {
      // First create profile with custom env_key
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "original-key",
        envKey: "MY_CUSTOM_KEY",
        baseURL: "https://api.example.com",
        apiFormat: "openai_responses",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      // Update profile with different base URL but same env_key
      const updatedProfile: ClaudeCodeProfile = {
        ...profile,
        baseURL: "https://api2.example.com",
        apiKey: "new-key",
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(updatedProfile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // env_key should be preserved
      expect(config.model_providers["swixter-test"].env_key).toBe("MY_CUSTOM_KEY");
      expect(config.model_providers["swixter-test"].base_url).toBe("https://api2.example.com");
    });
  });

  describe("chat-only provider bridging (proxy bridge)", () => {
    // Fixture presets for resolveProviderEndpoints decision tests.
    const moonshotPreset: ProviderPreset = {
      id: "moonshot",
      name: "Moonshot",
      displayName: "Moonshot (Kimi)",
      baseURL: "https://api.moonshot.cn/v1",
      defaultModels: [],
      authType: "api-key",
      defaultApiFormat: "openai_chat",
      wire_api: "chat",
      env_key: "MOONSHOT_API_KEY",
    };

    // A responses-native provider (e.g. MiniMax-CN style): not bridged.
    const responsesPreset: ProviderPreset = {
      id: "minimax-cn",
      name: "MiniMax",
      displayName: "MiniMax (CN)",
      baseURL: "https://api.minimax.chat/v1",
      defaultModels: [],
      authType: "api-key",
      defaultApiFormat: "anthropic_messages",
      wire_api: "responses",
      env_key: "ANTHROPIC_API_KEY",
    };

    describe("resolveProviderEndpoints (pure decision logic)", () => {
      test("chat-only provider → bridged through local proxy", () => {
        const profile: ClaudeCodeProfile = {
          name: "kimi",
          providerId: "moonshot",
          apiKey: "sk-real-kimi-key",
          baseURL: "https://api.moonshot.cn/v1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = resolveProviderEndpoints(profile, moonshotPreset);

        expect(result.bridged).toBe(true);
        expect(result.base_url).toBe(
          `http://${DEFAULT_PROXY_HOST}:${DEFAULT_PROXY_PORT}/v1`,
        );
        expect(result.env_key).toBe(SWIXTER_PROXY_ENV_KEY);
      });

      test("non-chat (responses-native) provider → NOT bridged, real base_url + real env_key", () => {
        const profile: ClaudeCodeProfile = {
          name: "minimax",
          providerId: "minimax-cn",
          apiKey: "sk-real",
          baseURL: "https://api.minimax.chat/v1",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = resolveProviderEndpoints(profile, responsesPreset);

        expect(result.bridged).toBe(false);
        expect(result.base_url).toBe("https://api.minimax.chat/v1");
        expect(result.env_key).toBe("ANTHROPIC_API_KEY");
      });

      test("profile.apiFormat override to openai_chat forces bridge even if preset says responses", () => {
        const profile: ClaudeCodeProfile = {
          name: "force-chat",
          providerId: "minimax-cn",
          apiKey: "sk-real",
          baseURL: "https://api.minimax.chat/v1",
          apiFormat: "openai_chat",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = resolveProviderEndpoints(profile, responsesPreset);

        expect(result.bridged).toBe(true);
        expect(result.env_key).toBe(SWIXTER_PROXY_ENV_KEY);
      });

      test("profile.apiFormat override to non-chat disables bridge even if preset says chat", () => {
        const profile: ClaudeCodeProfile = {
          name: "force-resp",
          providerId: "moonshot",
          apiKey: "sk-real",
          baseURL: "https://api.moonshot.cn/v1",
          apiFormat: "anthropic_messages",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = resolveProviderEndpoints(profile, moonshotPreset);

        expect(result.bridged).toBe(false);
        expect(result.base_url).toBe("https://api.moonshot.cn/v1");
        expect(result.env_key).toBe("MOONSHOT_API_KEY");
      });

      test("profile-level envKey is honored on the non-bridged path", () => {
        const profile: ClaudeCodeProfile = {
          name: "custom",
          providerId: "minimax-cn",
          apiKey: "sk",
          baseURL: "https://api.minimax.chat/v1",
          envKey: "MY_CUSTOM_ENV",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const result = resolveProviderEndpoints(profile, responsesPreset);
        expect(result.bridged).toBe(false);
        expect(result.env_key).toBe("MY_CUSTOM_ENV");
      });
    });

    describe("side-effect helpers are non-throwing best-effort", () => {
      test("setProxyAuthEnvForGUI does not throw (any platform)", () => {
        // Should be safe to call on any test platform; on non-darwin it just
        // prints an instruction, on darwin it spawns a fire-and-forget launchctl.
        expect(() => setProxyAuthEnvForGUI()).not.toThrow();
      });

      test("ensureProxyRunning does not throw even if it can't start the daemon", async () => {
        // No real proxy is running in CI/sandbox; this should either start a
        // throwaway daemon or return false with a warning — never throw.
        const result = await ensureProxyRunning("definitely-nonexistent-profile-xyz");
        expect(typeof result).toBe("boolean");
      });
    });

    describe("constants are wired", () => {
      test("SWIXTER_PROXY_ENV_KEY is the documented env var name", () => {
        expect(SWIXTER_PROXY_ENV_KEY).toBe("SWIXTER_PROXY_KEY");
      });
      test("SWIXTER_PROXY_AUTH_TOKEN is the fixed bearer the proxy authenticates", () => {
        expect(SWIXTER_PROXY_AUTH_TOKEN).toBe("swixter-local-proxy");
      });
    });
  });
});