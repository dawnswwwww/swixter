/**
 * API util tests
 */

import { describe, it, expect } from "bun:test";
import { maskApiKey, maskAuthToken, sanitizeProfile, generateETag, parseIfNoneMatch } from "../../src/server/api/util.js";
import type { ClaudeCodeProfile } from "../../src/types.js";

describe("API Util", () => {
  describe("maskApiKey", () => {
    it("should mask short API keys", () => {
      expect(maskApiKey("")).toBe("****");
      expect(maskApiKey("abc")).toBe("****");
      expect(maskApiKey("abcd1234")).toBe("****");
    });

    it("should show first 4 and last 4 characters", () => {
      const masked = maskApiKey("sk-ant-api1234567890");
      expect(masked).not.toContain("sk-ant-api1234567890");
      expect(masked.startsWith("sk-a")).toBe(true);
      expect(masked.endsWith("7890")).toBe(true);
    });

    it("should mask very long keys", () => {
      const longKey = "a".repeat(50) + "b" + "c".repeat(50);
      const masked = maskApiKey(longKey);
      expect(masked).not.toContain(longKey);
      expect(masked.startsWith("aaaa")).toBe(true);
      expect(masked.endsWith("cccc")).toBe(true);
    });
  });

  describe("maskAuthToken", () => {
    it("should mask short tokens", () => {
      expect(maskAuthToken("")).toBe("****");
      expect(maskAuthToken("abc")).toBe("****");
    });

    it("should show first 4 and last 4 characters", () => {
      const masked = maskAuthToken("token-1234567890-xyz");
      expect(masked).not.toContain("token-1234567890-xyz");
      expect(masked.startsWith("toke")).toBe(true);
      expect(masked.endsWith("-xyz")).toBe(true);
    });
  });

  describe("sanitizeProfile", () => {
    const profile: ClaudeCodeProfile = {
      name: "test-profile",
      providerId: "anthropic",
      apiKey: "sk-ant-api1234567890",
      authToken: "token-1234567890-xyz",
      baseURL: "https://api.anthropic.com",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
    };

    it("should mask API key and auth token", () => {
      const sanitized = sanitizeProfile(profile);
      expect(sanitized.apiKey).toBe(maskApiKey(profile.apiKey));
      expect(sanitized.authToken).toBe(maskAuthToken(profile.authToken));
    });

    it("should preserve other fields", () => {
      const sanitized = sanitizeProfile(profile);
      expect(sanitized.name).toBe(profile.name);
      expect(sanitized.providerId).toBe(profile.providerId);
      expect(sanitized.baseURL).toBe(profile.baseURL);
      expect(sanitized.createdAt).toBe(profile.createdAt);
      expect(sanitized.updatedAt).toBe(profile.updatedAt);
    });

    it("should handle undefined auth token", () => {
      const noTokenProfile = { ...profile, authToken: undefined };
      const sanitized = sanitizeProfile(noTokenProfile);
      expect(sanitized.authToken).toBeUndefined();
    });
  });

  describe("generateETag", () => {
    it("should generate ETag from mtime and size", () => {
      const mtime = new Date("2024-01-01T12:00:00.000Z");
      const size = 1024;
      const etag = generateETag(mtime, size);
      // Format: "timestamp-size" where timestamp is mtime in seconds
      expect(etag).toMatch(/^"\d+-1024"$/);
    });

    it("should generate unique ETags for different inputs", () => {
      const mtime1 = new Date("2024-01-01T12:00:00.000Z");
      const mtime2 = new Date("2024-01-02T12:00:00.000Z");
      const etag1 = generateETag(mtime1, 1024);
      const etag2 = generateETag(mtime2, 1024);
      expect(etag1).not.toBe(etag2);
    });
  });

  describe("parseIfNoneMatch", () => {
    it("should parse valid If-None-Match header", () => {
      expect(parseIfNoneMatch('"1704100800-1024"')).toBe("1704100800-1024");
      expect(parseIfNoneMatch('"etag-value"')).toBe("etag-value");
    });

    it("should return null for undefined header", () => {
      expect(parseIfNoneMatch(undefined)).toBeNull();
    });

    it("should remove quotes", () => {
      expect(parseIfNoneMatch('"with-quotes"')).toBe("with-quotes");
    });
  });
});
