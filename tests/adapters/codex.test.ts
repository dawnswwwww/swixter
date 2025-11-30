import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { CodexAdapter } from "../../src/adapters/codex.js";
import type { ClaudeCodeProfile } from "../../src/types.js";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { parse as parseToml } from "smol-toml";

const TEST_CONFIG_DIR = "/tmp/swixter-test-codex";
const TEST_CONFIG_PATH = `${TEST_CONFIG_DIR}/config.toml`;

describe("CodexAdapter", () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    // Create adapter and override config path for testing
    adapter = new CodexAdapter();
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

    // Clean up environment variables
    delete process.env.OPENAI_API_KEY;
    delete process.env.OLLAMA_API_KEY;
  });

  describe("apply - Basic Functionality", () => {
    test("should create new config.toml from scratch", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      expect(existsSync(TEST_CONFIG_PATH)).toBe(true);

      const file = Bun.file(TEST_CONFIG_PATH);
      const content = await file.text();
      const config = parseToml(content);

      // Verify profile is active
      expect(config.profile).toBe("swixter-test");

      // Verify profile table exists
      expect(config.profiles["swixter-test"]).toBeDefined();
      expect(config.profiles["swixter-test"].model_provider).toBe("swixter-test");

      // Verify provider table exists
      expect(config.model_providers["swixter-test"]).toBeDefined();
      expect(config.model_providers["swixter-test"].name).toBe("Ollama (Local models)");
      expect(config.model_providers["swixter-test"].base_url).toBe("http://localhost:11434");
      expect(config.model_providers["swixter-test"].wire_api).toBe("chat");
    });

    test("should create config with custom baseURL", async () => {
      const profile: ClaudeCodeProfile = {
        name: "custom-server",
        providerId: "custom",
        apiKey: "custom-key",
        baseURL: "https://api.example.com/v1",
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

      // Verify Swixter profile is now active
      expect(config.profile).toBe("swixter-test");
    });
  });

  describe("apply - Environment Variable Handling", () => {
    test("should always use env_key reference (per official Codex spec)", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "ollama",
        apiKey: "my-api-key",
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

      // Original profiles should still exist
      expect(config.profiles["my-work"]).toBeDefined();
      expect(config.profiles["my-work"].model).toBe("gpt-4");
      expect(config.profiles["my-personal"]).toBeDefined();

      // Swixter profile should also exist
      expect(config.profiles["swixter-test"]).toBeDefined();
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

      expect(config.profile).toBe("swixter-test");

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

      expect(config.profile).toBe("swixter-test");
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

      expect(config.profile).toBe("swixter-test");
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
    test("should set wire_api to 'chat' for Ollama", async () => {
      const profile: ClaudeCodeProfile = {
        name: "ollama-test",
        providerId: "ollama",
        apiKey: "test-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-ollama-test"].wire_api).toBe("chat");
    });

    test("should set wire_api to 'chat' for Custom provider", async () => {
      const profile: ClaudeCodeProfile = {
        name: "custom-test",
        providerId: "custom",
        apiKey: "test-key",
        baseURL: "https://api.example.com",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-custom-test"].wire_api).toBe("chat");
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

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      // Should have model from Ollama preset's defaultModels[0]
      expect(config.profiles["swixter-ollama-test"].model).toBe("qwen2.5-coder:7b");
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

      // Verify it was created
      let file = Bun.file(TEST_CONFIG_PATH);
      let config = parseToml(await file.text());
      expect(config.profiles["swixter-test"]).toBeDefined();
      expect(config.model_providers["swixter-test"]).toBeDefined();
      expect(config.profile).toBe("swixter-test");

      // Remove it
      await adapter.remove("test");

      // Verify it was removed
      file = Bun.file(TEST_CONFIG_PATH);
      config = parseToml(await file.text());
      expect(config.profiles["swixter-test"]).toBeUndefined();
      expect(config.model_providers["swixter-test"]).toBeUndefined();
      expect(config.profile).toBeUndefined();
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

      // Verify it's active
      let file = Bun.file(TEST_CONFIG_PATH);
      let config = parseToml(await file.text());
      expect(config.profile).toBe("swixter-test");

      // Remove it
      await adapter.remove("test");

      // Verify active profile was cleared
      file = Bun.file(TEST_CONFIG_PATH);
      config = parseToml(await file.text());
      expect(config.profile).toBeUndefined();
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

      // Profile should be removed
      expect(config.profiles["swixter-test"]).toBeUndefined();
      expect(config.model_providers["swixter-test"]).toBeUndefined();

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

      const commands = adapter.getEnvExportCommands(profile);

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

      const commands = adapter.getEnvExportCommands(profile);

      expect(commands).toEqual(['export OLLAMA_API_KEY="test-key"']);
    });

    test("should handle custom env_key with special characters", async () => {
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "test-key",
        envKey: "MY_API_KEY_2024",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await adapter.apply(profile);

      const file = Bun.file(TEST_CONFIG_PATH);
      const config = parseToml(await file.text());

      expect(config.model_providers["swixter-test"].env_key).toBe("MY_API_KEY_2024");
    });

    test("should preserve custom env_key when updating other profile fields", async () => {
      // First create profile with custom env_key
      const profile: ClaudeCodeProfile = {
        name: "test",
        providerId: "custom",
        apiKey: "original-key",
        envKey: "MY_CUSTOM_KEY",
        baseURL: "https://api.example.com",
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
});
