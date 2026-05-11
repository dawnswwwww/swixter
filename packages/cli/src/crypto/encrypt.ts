/**
 * AES-256-GCM encrypt/decrypt for sensitive config fields.
 *
 * Format: base64(IV[12 bytes] + ciphertext + authTag[16 bytes])
 * - IV: 12 bytes, random per encryption
 * - Auth tag: 16 bytes, appended automatically by Web Crypto API
 */

const IV_LENGTH = 12; // 96 bits, recommended for AES-GCM

/**
 * Encrypt a plaintext string using AES-256-GCM.
 *
 * @param key - AES-256-GCM CryptoKey (from deriveKey)
 * @param plaintext - String to encrypt
 * @returns Base64-encoded string containing IV + ciphertext + authTag
 */
export async function encrypt(
  key: CryptoKey,
  plaintext: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  // Combine IV + ciphertext (includes auth tag)
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded AES-256-GCM ciphertext.
 *
 * @param key - AES-256-GCM CryptoKey (from deriveKey)
 * @param encryptedBase64 - Base64-encoded IV + ciphertext + authTag
 * @returns Decrypted plaintext string
 */
export async function decrypt(
  key: CryptoKey,
  encryptedBase64: string
): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), (c) =>
    c.charCodeAt(0)
  );

  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}
