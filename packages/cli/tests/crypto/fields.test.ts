import { describe, test, expect } from "bun:test";
import {
  SENSITIVE_FIELDS,
  encryptSensitiveFields,
  decryptSensitiveFields,
} from "../../src/crypto/fields";
import { deriveKey, generateSalt } from "../../src/crypto/derive";
import { ClaudeCodeProfile } from "../../src/types";

describe("SENSITIVE_FIELDS", () => {
  test("contains apiKey and authToken", () => {
    expect(SENSITIVE_FIELDS).toContain("apiKey");
    expect(SENSITIVE_FIELDS).toContain("authToken");
  });
});

describe("encryptSensitiveFields", () => {
  test("encrypts apiKey in a profile", async () => {
    const salt = generateSalt();
    const key = await deriveKey("password", salt);

    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "sk-secret-key",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    const encrypted = await encryptSensitiveFields(key, profile);

    // apiKey should be encrypted (not plaintext)
    expect(encrypted.apiKey).not.toBe("sk-secret-key");
    // Non-sensitive fields unchanged
    expect(encrypted.name).toBe("test");
    expect(encrypted.providerId).toBe("anthropic");
    expect(encrypted.createdAt).toBe("2026-01-01");
  });

  test("encrypts apiKey and authToken in a profile", async () => {
    const salt = generateSalt();
    const key = await deriveKey("password", salt);

    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "sk-secret-key",
      authToken: "auth-token-xyz",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    const encrypted = await encryptSensitiveFields(key, profile);

    expect(encrypted.apiKey).not.toBe("sk-secret-key");
    expect(encrypted.authToken).not.toBe("auth-token-xyz");
    // Non-sensitive fields unchanged
    expect(encrypted.name).toBe("test");
  });

  test("handles profile without optional authToken", async () => {
    const salt = generateSalt();
    const key = await deriveKey("password", salt);

    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "sk-secret",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    const encrypted = await encryptSensitiveFields(key, profile);
    expect(encrypted.apiKey).not.toBe("sk-secret");
    expect(encrypted.authToken).toBeUndefined();
  });

  test("handles empty string sensitive fields", async () => {
    const salt = generateSalt();
    const key = await deriveKey("password", salt);

    const profile: ClaudeCodeProfile = {
      name: "ollama",
      providerId: "ollama",
      apiKey: "", // Ollama doesn't need a key
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    const encrypted = await encryptSensitiveFields(key, profile);
    // Empty string should still be encrypted (not left as empty)
    expect(typeof encrypted.apiKey).toBe("string");
  });
});

describe("decryptSensitiveFields", () => {
  test("decrypts encrypted profile back to original", async () => {
    const salt = generateSalt();
    const key = await deriveKey("password", salt);

    const original: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "sk-secret-key",
      authToken: "auth-token-xyz",
      baseURL: "https://api.anthropic.com",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    const encrypted = await encryptSensitiveFields(key, original);
    const decrypted = await decryptSensitiveFields(key, encrypted);

    expect(decrypted.apiKey).toBe("sk-secret-key");
    expect(decrypted.authToken).toBe("auth-token-xyz");
    // Non-sensitive fields unchanged
    expect(decrypted.name).toBe("test");
    expect(decrypted.providerId).toBe("anthropic");
    expect(decrypted.baseURL).toBe("https://api.anthropic.com");
  });

  test("handles profile without authToken", async () => {
    const salt = generateSalt();
    const key = await deriveKey("password", salt);

    const original: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "sk-secret",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };

    const encrypted = await encryptSensitiveFields(key, original);
    const decrypted = await decryptSensitiveFields(key, encrypted);

    expect(decrypted.apiKey).toBe("sk-secret");
    expect(decrypted.authToken).toBeUndefined();
  });

  test("batch encrypt/decrypt multiple profiles", async () => {
    const salt = generateSalt();
    const key = await deriveKey("password", salt);

    const profiles: Record<string, ClaudeCodeProfile> = {
      prod: {
        name: "prod",
        providerId: "anthropic",
        apiKey: "sk-prod-key",
        authToken: "prod-auth",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
      dev: {
        name: "dev",
        providerId: "ollama",
        apiKey: "",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
      },
    };

    // Encrypt all profiles
    const encrypted: Record<string, ClaudeCodeProfile> = {};
    for (const [id, profile] of Object.entries(profiles)) {
      encrypted[id] = await encryptSensitiveFields(key, profile);
    }

    // None should contain plaintext
    expect(encrypted.prod.apiKey).not.toBe("sk-prod-key");
    expect(encrypted.dev.apiKey).not.toBe("");

    // Decrypt all profiles
    const decrypted: Record<string, ClaudeCodeProfile> = {};
    for (const [id, profile] of Object.entries(encrypted)) {
      decrypted[id] = await decryptSensitiveFields(key, profile);
    }

    expect(decrypted.prod.apiKey).toBe("sk-prod-key");
    expect(decrypted.prod.authToken).toBe("prod-auth");
    expect(decrypted.dev.apiKey).toBe("");
    expect(decrypted.dev.authToken).toBeUndefined();
  });
});
