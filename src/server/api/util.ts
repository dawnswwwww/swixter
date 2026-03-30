/**
 * API Utilities
 * Helper functions for API responses
 */

import type { ClaudeCodeProfile, ProviderPreset } from "../../types.js";

/**
 * Mask API key for display (show first 4 and last 4 characters)
 */
export function maskApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length <= 8) {
    return "****";
  }
  const first = apiKey.slice(0, 4);
  const last = apiKey.slice(-4);
  return `${first}${"*".repeat(Math.min(apiKey.length - 8, 20))}${last}`;
}

/**
 * Mask auth token for display
 */
export function maskAuthToken(token?: string): string {
  if (!token || token.length <= 8) {
    return "****";
  }
  const first = token.slice(0, 4);
  const last = token.slice(-4);
  return `${first}${"*".repeat(Math.min(token.length - 8, 20))}${last}`;
}

/**
 * Create a sanitized profile object for API responses
 * API keys are masked by default in GET responses
 */
export function sanitizeProfile(profile: ClaudeCodeProfile): ClaudeCodeProfile {
  return {
    ...profile,
    apiKey: maskApiKey(profile.apiKey),
    authToken: profile.authToken ? maskAuthToken(profile.authToken) : undefined,
  };
}

/**
 * Create a full profile object (with unmasked API key)
 * Only used in POST/PUT responses or when explicitly requested
 */
export function fullProfile(profile: ClaudeCodeProfile): ClaudeCodeProfile {
  return profile;
}

/**
 * Generate ETag from file stats
 * Uses mtime and size to create a unique identifier
 */
export function generateETag(mtime: Date, size: number): string {
  const mtimeMs = Math.floor(mtime.getTime() / 1000);
  return `"${mtimeMs}-${size}"`;
}

/**
 * Parse If-None-Match header
 */
export function parseIfNoneMatch(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  // Remove quotes if present
  return header.replace(/^"|"$/g, "");
}

/**
 * Send ETag headers for cache validation
 */
export function setETagHeaders(res: any, mtime: Date, size: number): void {
  const etag = generateETag(mtime, size);
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "no-cache");
}
