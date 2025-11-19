import { describe, test, expect } from "bun:test";
import {
  validateProfileName,
  validateApiKey,
  validateUrl,
} from "../../src/utils/validation.js";

describe("Validation Functions", () => {
  describe("validateProfileName", () => {
    test("should reject empty name", () => {
      const result = validateProfileName("");
      expect(result).toBeDefined();
      expect(result).toContain("cannot be empty");
    });

    test("should reject too short name", () => {
      const result = validateProfileName("a");
      expect(result).toBeDefined();
      expect(result).toContain("at least");
    });

    test("should reject name with spaces", () => {
      const result = validateProfileName("test profile");
      expect(result).toBeDefined();
      expect(result).toContain("letters");
    });

    test("should reject name with special characters", () => {
      const result = validateProfileName("test@profile!");
      expect(result).toBeDefined();
      expect(result).toContain("letters");
    });

    test("should accept valid names with lowercase", () => {
      const result = validateProfileName("my-config");
      expect(result).toBeUndefined();
    });

    test("should accept valid names with uppercase", () => {
      const result = validateProfileName("MyConfig");
      expect(result).toBeUndefined();
    });

    test("should accept valid names with numbers", () => {
      const result = validateProfileName("config123");
      expect(result).toBeUndefined();
    });

    test("should accept valid names with underscores", () => {
      const result = validateProfileName("test_profile_123");
      expect(result).toBeUndefined();
    });

    test("should accept valid names with hyphens", () => {
      const result = validateProfileName("test-profile-123");
      expect(result).toBeUndefined();
    });

    test("should accept minimum length name", () => {
      const result = validateProfileName("ab");
      expect(result).toBeUndefined();
    });
  });

  describe("validateApiKey", () => {
    test("should allow empty key for Ollama", () => {
      const result = validateApiKey("", "ollama");
      expect(result).toBeUndefined();
    });

    test("should require key for Anthropic", () => {
      const result = validateApiKey("", "anthropic");
      expect(result).toBeDefined();
      expect(result).toContain("cannot be empty");
    });

    test("should accept any non-empty key for Anthropic", () => {
      const result = validateApiKey("sk-ant-test123", "anthropic");
      expect(result).toBeUndefined();
    });

    test("should accept short keys", () => {
      const result = validateApiKey("x", "anthropic");
      expect(result).toBeUndefined();
    });

    test("should handle unknown provider (allow empty since no preset)", () => {
      // Unknown providers have no preset, so the function allows empty key
      const result = validateApiKey("", "unknown-provider");
      expect(result).toBeUndefined();
    });
  });

  describe("validateUrl", () => {
    test("should allow empty URL (optional)", () => {
      const result = validateUrl("");
      expect(result).toBeUndefined();
    });

    test("should accept valid HTTPS URL", () => {
      const result = validateUrl("https://api.example.com");
      expect(result).toBeUndefined();
    });

    test("should accept valid HTTP URL", () => {
      const result = validateUrl("http://localhost:8080");
      expect(result).toBeUndefined();
    });

    test("should accept URL with path", () => {
      const result = validateUrl("https://api.example.com/v1/chat");
      expect(result).toBeUndefined();
    });

    test("should accept URL with port", () => {
      const result = validateUrl("http://localhost:11434");
      expect(result).toBeUndefined();
    });

    test("should accept URL with subdomain", () => {
      const result = validateUrl("https://api.openai.com");
      expect(result).toBeUndefined();
    });

    test("should reject URL without protocol", () => {
      const result = validateUrl("api.example.com");
      expect(result).toBeDefined();
      expect(result).toContain("URL");
    });

    test("should reject invalid URL", () => {
      const result = validateUrl("not-a-url");
      expect(result).toBeDefined();
      expect(result).toContain("URL");
    });

    test("should reject URL with spaces", () => {
      const result = validateUrl("https://example .com");
      expect(result).toBeDefined();
      expect(result).toContain("URL");
    });

    test("should reject malformed URL", () => {
      const result = validateUrl("ht tp://example.com");
      expect(result).toBeDefined();
      expect(result).toContain("URL");
    });
  });
});
