import { describe, test, expect } from "bun:test";
import {
  ProviderPresetSchema,
  ClaudeCodeProfileSchema,
  ConfigFileSchema,
  ExportConfigSchema,
} from "../src/types.js";

describe("Zod Schema Validation", () => {
  describe("ProviderPresetSchema", () => {
    test("should validate valid preset", () => {
      const preset = {
        id: "anthropic",
        name: "Anthropic",
        displayName: "Anthropic (官方)",
        baseURL: "https://api.anthropic.com",
        defaultModels: ["claude-3-5-sonnet-20241022"],
        authType: "api-key" as const,
      };

      const result = ProviderPresetSchema.parse(preset);
      expect(result).toEqual(preset);
    });

    test("should accept preset with all optional fields", () => {
      const preset = {
        id: "test",
        name: "Test Provider",
        displayName: "Test Provider",
        baseURL: "https://api.test.com",
        defaultModels: ["test-model"],
        authType: "bearer" as const,
        isChinese: true,
        docs: "https://docs.test.com",
        rateLimit: {
          requestsPerMinute: 60,
          tokensPerMinute: 100000,
        },
      };

      const result = ProviderPresetSchema.parse(preset);
      expect(result.isChinese).toBe(true);
      expect(result.docs).toBe("https://docs.test.com");
      expect(result.rateLimit).toEqual({
        requestsPerMinute: 60,
        tokensPerMinute: 100000,
      });
    });

    test("should reject invalid authType", () => {
      const preset = {
        id: "test",
        name: "Test",
        displayName: "Test",
        baseURL: "https://api.test.com",
        defaultModels: [],
        authType: "invalid" as any,
      };

      expect(() => ProviderPresetSchema.parse(preset)).toThrow();
    });

    test("should require all mandatory fields", () => {
      const preset = {
        id: "test",
        // missing other fields
      };

      expect(() => ProviderPresetSchema.parse(preset)).toThrow();
    });

    test("should accept empty defaultModels array", () => {
      const preset = {
        id: "test",
        name: "Test",
        displayName: "Test",
        baseURL: "https://api.test.com",
        defaultModels: [],
        authType: "api-key" as const,
      };

      const result = ProviderPresetSchema.parse(preset);
      expect(result.defaultModels).toEqual([]);
    });
  });

  describe("ClaudeCodeProfileSchema", () => {
    test("should validate valid profile", () => {
      const profile = {
        name: "test-profile",
        providerId: "anthropic",
        apiKey: "sk-test-key",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: "2024-01-01T00:00:00Z",
      };

      const result = ClaudeCodeProfileSchema.parse(profile);
      expect(result.name).toBe("test-profile");
      expect(result.providerId).toBe("anthropic");
    });

    test("should reject empty name", () => {
      const profile = {
        name: "",
        providerId: "anthropic",
        apiKey: "sk-test",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      expect(() => ClaudeCodeProfileSchema.parse(profile)).toThrow();
    });

    test("should accept empty providerId (schema allows it)", () => {
      // Note: The schema allows empty providerId, validation is handled elsewhere
      const profile = {
        name: "test",
        providerId: "",
        apiKey: "sk-test",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      const result = ClaudeCodeProfileSchema.parse(profile);
      expect(result.providerId).toBe("");
    });

    test("should accept empty apiKey", () => {
      const profile = {
        name: "test",
        providerId: "ollama",
        apiKey: "",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      const result = ClaudeCodeProfileSchema.parse(profile);
      expect(result.apiKey).toBe("");
    });

    test("should accept optional authToken", () => {
      const profile = {
        name: "test",
        providerId: "custom",
        apiKey: "",
        authToken: "sk-auth-token",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      const result = ClaudeCodeProfileSchema.parse(profile);
      expect(result.authToken).toBe("sk-auth-token");
    });

    test("should accept optional baseURL", () => {
      const profile = {
        name: "test",
        providerId: "custom",
        apiKey: "test-key",
        baseURL: "https://custom.api.com/v1",
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      const result = ClaudeCodeProfileSchema.parse(profile);
      expect(result.baseURL).toBe("https://custom.api.com/v1");
    });

    test("should accept optional headers", () => {
      const profile = {
        name: "test",
        providerId: "custom",
        apiKey: "test-key",
        headers: {
          "X-Custom-Header": "value",
          "Authorization": "Bearer token",
        },
        createdAt: "2024-01-01",
        updatedAt: "2024-01-01",
      };

      const result = ClaudeCodeProfileSchema.parse(profile);
      expect(result.headers).toEqual({
        "X-Custom-Header": "value",
        "Authorization": "Bearer token",
      });
    });

    test("should require createdAt and updatedAt", () => {
      const profile = {
        name: "test",
        providerId: "anthropic",
        apiKey: "sk-test",
        // missing timestamps
      };

      expect(() => ClaudeCodeProfileSchema.parse(profile)).toThrow();
    });
  });

  describe("ConfigFileSchema", () => {
    test("should validate v2.0.0 config structure", () => {
      const config = {
        profiles: {
          "test-profile": {
            name: "test-profile",
            providerId: "anthropic",
            apiKey: "sk-test",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-01",
          },
        },
        coders: {
          claude: { activeProfile: "test-profile" },
        },
        version: "2.0.0",
      };

      const result = ConfigFileSchema.parse(config);
      expect(result.version).toBe("2.0.0");
      expect(result.coders.claude.activeProfile).toBe("test-profile");
    });

    test("should accept empty profiles", () => {
      const config = {
        profiles: {},
        coders: {},
        version: "2.0.0",
      };

      const result = ConfigFileSchema.parse(config);
      expect(Object.keys(result.profiles).length).toBe(0);
    });

    test("should accept multiple profiles", () => {
      const config = {
        profiles: {
          "profile1": {
            name: "profile1",
            providerId: "anthropic",
            apiKey: "key1",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-01",
          },
          "profile2": {
            name: "profile2",
            providerId: "ollama",
            apiKey: "",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-01",
          },
        },
        coders: {
          claude: { activeProfile: "profile1" },
          qwen: { activeProfile: "profile2" },
        },
        version: "2.0.0",
      };

      const result = ConfigFileSchema.parse(config);
      expect(Object.keys(result.profiles).length).toBe(2);
      expect(Object.keys(result.coders).length).toBe(2);
    });

    test("should accept empty activeProfile", () => {
      const config = {
        profiles: {},
        coders: {
          claude: { activeProfile: "" },
        },
        version: "2.0.0",
      };

      const result = ConfigFileSchema.parse(config);
      expect(result.coders.claude.activeProfile).toBe("");
    });

    test("should require version field", () => {
      const config = {
        profiles: {},
        coders: {},
        // missing version
      };

      expect(() => ConfigFileSchema.parse(config)).toThrow();
    });

    test("should require profiles field", () => {
      const config = {
        // missing profiles
        coders: {},
        version: "2.0.0",
      };

      expect(() => ConfigFileSchema.parse(config)).toThrow();
    });

    test("should require coders field", () => {
      const config = {
        profiles: {},
        // missing coders
        version: "2.0.0",
      };

      expect(() => ConfigFileSchema.parse(config)).toThrow();
    });
  });

  describe("ExportConfigSchema", () => {
    test("should validate export structure", () => {
      const exportData = {
        profiles: [
          {
            name: "test",
            providerId: "anthropic",
            apiKey: "sk-test",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-01",
          },
        ],
        exportedAt: "2024-01-01T00:00:00Z",
        version: "1.0.0",
        sanitized: false,
      };

      const result = ExportConfigSchema.parse(exportData);
      expect(result.sanitized).toBe(false);
      expect(result.profiles.length).toBe(1);
    });

    test("should accept sanitized exports", () => {
      const exportData = {
        profiles: [
          {
            name: "test",
            providerId: "anthropic",
            apiKey: "sk-t***test",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-01",
          },
        ],
        exportedAt: "2024-01-01T00:00:00Z",
        version: "1.0.0",
        sanitized: true,
      };

      const result = ExportConfigSchema.parse(exportData);
      expect(result.sanitized).toBe(true);
    });

    test("should accept empty profiles array", () => {
      const exportData = {
        profiles: [],
        exportedAt: "2024-01-01T00:00:00Z",
        version: "1.0.0",
        sanitized: false,
      };

      const result = ExportConfigSchema.parse(exportData);
      expect(result.profiles.length).toBe(0);
    });

    test("should require all mandatory fields", () => {
      const exportData = {
        profiles: [],
        // missing other fields
      };

      expect(() => ExportConfigSchema.parse(exportData)).toThrow();
    });

    test("should accept multiple profiles", () => {
      const exportData = {
        profiles: [
          {
            name: "test1",
            providerId: "anthropic",
            apiKey: "key1",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-01",
          },
          {
            name: "test2",
            providerId: "ollama",
            apiKey: "",
            createdAt: "2024-01-02",
            updatedAt: "2024-01-02",
          },
        ],
        exportedAt: "2024-01-01T00:00:00Z",
        version: "1.0.0",
        sanitized: false,
      };

      const result = ExportConfigSchema.parse(exportData);
      expect(result.profiles.length).toBe(2);
    });

    test("should validate profile structure in export", () => {
      const exportData = {
        profiles: [
          {
            name: "",  // invalid: empty name
            providerId: "anthropic",
            apiKey: "test",
            createdAt: "2024-01-01",
            updatedAt: "2024-01-01",
          },
        ],
        exportedAt: "2024-01-01T00:00:00Z",
        version: "1.0.0",
        sanitized: false,
      };

      expect(() => ExportConfigSchema.parse(exportData)).toThrow();
    });
  });
});
