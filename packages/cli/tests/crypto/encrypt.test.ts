import { describe, test, expect } from "bun:test";
import { encrypt, decrypt } from "../../src/crypto/encrypt";
import { deriveKey, generateSalt } from "../../src/crypto/derive";

describe("encrypt + decrypt", () => {
  test("round-trips a string", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-password", salt);
    const plaintext = "sk-ant-api03-secret-key-12345";

    const encrypted = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted).toBe(plaintext);
  });

  test("round-trips an empty string", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-password", salt);

    const encrypted = await encrypt(key, "");
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted).toBe("");
  });

  test("produces different ciphertext for same plaintext (random IV)", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-password", salt);
    const plaintext = "same-data";

    const encrypted1 = await encrypt(key, plaintext);
    const encrypted2 = await encrypt(key, plaintext);

    // Random IV means different ciphertext each time
    expect(encrypted1).not.toBe(encrypted2);

    // But both decrypt correctly
    expect(await decrypt(key, encrypted1)).toBe(plaintext);
    expect(await decrypt(key, encrypted2)).toBe(plaintext);
  });

  test("fails to decrypt with wrong key", async () => {
    const salt = generateSalt();
    const key1 = await deriveKey("correct-password", salt);
    const key2 = await deriveKey("wrong-password", salt);

    const encrypted = await encrypt(key1, "secret-data");

    await expect(decrypt(key2, encrypted)).rejects.toThrow();
  });

  test("encrypted output is a single base64 string", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-password", salt);

    const encrypted = await encrypt(key, "test");

    // Should be valid base64
    expect(() => atob(encrypted)).not.toThrow();
  });

  test("handles unicode characters", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-password", salt);
    const plaintext = "密钥-🔑-key";

    const encrypted = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted).toBe(plaintext);
  });

  test("handles long strings", async () => {
    const salt = generateSalt();
    const key = await deriveKey("test-password", salt);
    const plaintext = "x".repeat(10_000);

    const encrypted = await encrypt(key, plaintext);
    const decrypted = await decrypt(key, encrypted);

    expect(decrypted).toBe(plaintext);
  });
});
