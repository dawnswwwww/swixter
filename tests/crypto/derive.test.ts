import { describe, test, expect } from "bun:test";
import { deriveKey, generateSalt } from "../../src/crypto/derive";

describe("generateSalt", () => {
  test("generates a base64-encoded salt string", () => {
    const salt = generateSalt();
    expect(typeof salt).toBe("string");
    expect(salt.length).toBeGreaterThan(0);
    // base64 of 16 bytes = 24 chars
    expect(salt.length).toBe(24);
  });

  test("generates unique salts each call", () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    expect(salt1).not.toBe(salt2);
  });
});

describe("deriveKey", () => {
  test("derives a CryptoKey from password and salt", async () => {
    const salt = generateSalt();
    const key = await deriveKey("my-master-password", salt);

    expect(key).toBeDefined();
    expect(key.type).toBe("secret");
    // AES-256-GCM key
    expect(key.algorithm).toHaveProperty("name", "AES-GCM");
  });

  test("same password + salt produces same key", async () => {
    const salt = generateSalt();
    const password = "consistent-password";

    const key1 = await deriveKey(password, salt);
    const key2 = await deriveKey(password, salt);

    // Can't compare CryptoKey objects directly, but we can verify
    // they produce the same encryption output
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode("test data");

    const encrypted1 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key1,
      data
    );
    const encrypted2 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key2,
      data
    );

    expect(new Uint8Array(encrypted1)).toEqual(new Uint8Array(encrypted2));
  });

  test("different passwords produce different keys", async () => {
    const salt = generateSalt();

    const key1 = await deriveKey("password-one", salt);
    const key2 = await deriveKey("password-two", salt);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode("test data");

    const encrypted1 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key1,
      data
    );
    const encrypted2 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key2,
      data
    );

    expect(new Uint8Array(encrypted1)).not.toEqual(new Uint8Array(encrypted2));
  });

  test("different salts produce different keys", async () => {
    const key1 = await deriveKey("same-password", generateSalt());
    const key2 = await deriveKey("same-password", generateSalt());

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode("test data");

    const encrypted1 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key1,
      data
    );
    const encrypted2 = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key2,
      data
    );

    expect(new Uint8Array(encrypted1)).not.toEqual(new Uint8Array(encrypted2));
  });
});
