/**
 * Field-level encryption for sensitive config fields.
 *
 * Only encrypts sensitive fields (apiKey, authToken), leaving
 * non-sensitive config in plaintext for server-side debugging
 * and conflict resolution.
 */

import { encrypt, decrypt } from "./encrypt";

/**
 * Fields that contain secrets and must be encrypted before sync.
 */
export const SENSITIVE_FIELDS: readonly (keyof {
  apiKey: string;
  authToken?: string;
})[] = ["apiKey", "authToken"] as const;

/**
 * Encrypt all sensitive fields in a profile object.
 * Returns a shallow copy with sensitive fields replaced by ciphertext.
 */
export async function encryptSensitiveFields<T extends Record<string, unknown>>(
  key: CryptoKey,
  obj: T
): Promise<T> {
  const result = { ...obj };

  for (const field of SENSITIVE_FIELDS) {
    const value = result[field];
    if (typeof value === "string") {
      (result as Record<string, unknown>)[field] = await encrypt(key, value);
    }
  }

  return result;
}

/**
 * Decrypt all sensitive fields in a profile object.
 * Returns a shallow copy with sensitive fields restored to plaintext.
 */
export async function decryptSensitiveFields<T extends Record<string, unknown>>(
  key: CryptoKey,
  obj: T
): Promise<T> {
  const result = { ...obj };

  for (const field of SENSITIVE_FIELDS) {
    const value = result[field];
    if (typeof value === "string") {
      (result as Record<string, unknown>)[field] = await decrypt(key, value);
    }
  }

  return result;
}
