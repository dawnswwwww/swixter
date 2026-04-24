/**
 * Local auth token management
 * Stores auth state in ~/.config/swixter/auth.json
 */

import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "../constants/paths.js";
import type { AuthState } from "./types.js";
import { refreshToken as apiRefresh } from "./client.js";

const AUTH_FILE = "auth.json";

function getAuthFilePath(): string {
  return join(getConfigDir("swixter"), AUTH_FILE);
}

/**
 * Load auth state from disk
 */
export async function loadAuthState(): Promise<AuthState | null> {
  const authPath = getAuthFilePath();
  if (!existsSync(authPath)) return null;

  try {
    const content = await readFile(authPath, "utf-8");
    return JSON.parse(content) as AuthState;
  } catch {
    return null;
  }
}

/**
 * Save auth state to disk
 */
export async function saveAuthState(state: AuthState): Promise<void> {
  const authPath = getAuthFilePath();
  await writeFile(authPath, JSON.stringify(state, null, 2), { mode: 0o600, encoding: "utf-8" });
}

/**
 * Clear local auth state
 */
export async function clearAuthState(): Promise<void> {
  const authPath = getAuthFilePath();
  if (existsSync(authPath)) {
    await unlink(authPath);
  }
}

/**
 * Check if the access token is expired (with 5 min buffer)
 */
function isExpired(expiresAt: string): boolean {
  const expiry = new Date(expiresAt).getTime();
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5 minutes
  return now >= expiry - bufferMs;
}

/**
 * Get valid access token, auto-refreshing if needed
 */
export async function getAccessToken(): Promise<string | null> {
  const state = await loadAuthState();
  if (!state) return null;

  // If not expired, return current token
  if (!isExpired(state.expiresAt)) {
    return state.accessToken;
  }

  // Token expired — try to refresh
  try {
    const refreshed = await apiRefresh(state.refreshToken);
    state.accessToken = refreshed.accessToken;
    state.expiresAt = refreshed.expiresAt;
    await saveAuthState(state);
    return refreshed.accessToken;
  } catch {
    // Refresh failed — clear auth and return null
    await clearAuthState();
    return null;
  }
}

/**
 * Check if user is currently logged in
 */
export async function isLoggedIn(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}
