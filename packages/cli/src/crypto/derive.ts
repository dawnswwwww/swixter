/**
 * PBKDF2 key derivation for E2E encryption.
 * Derives an AES-256-GCM key from a master password + salt.
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16; // 128 bits

/**
 * Generate a random salt for key derivation.
 * Returns base64-encoded string.
 */
export function generateSalt(): string {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  return btoa(String.fromCharCode(...salt));
}

/**
 * Derive an AES-256-GCM key from a master password and salt.
 *
 * @param password - User's master password
 * @param saltBase64 - Base64-encoded salt (from generateSalt or server)
 * @returns CryptoKey suitable for AES-256-GCM encrypt/decrypt
 */
export async function deriveKey(
  password: string,
  saltBase64: string
): Promise<CryptoKey> {
  const salt = Uint8Array.from(atob(saltBase64), (c) => c.charCodeAt(0));

  // Import password as raw key material
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // Derive AES-256-GCM key
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Import an AES-256-GCM key from a base64-encoded raw key.
 * Used to restore a previously stored encryption key.
 */
export async function importKeyFromBase64(keyBase64: string): Promise<CryptoKey> {
  const keyBytes = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Export a CryptoKey to a base64-encoded string for storage.
 */
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return btoa(String.fromCharCode(...new Uint8Array(rawKey)));
}
