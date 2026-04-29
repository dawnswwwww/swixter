/**
 * Auth token management tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "../../src/constants/paths.js";
import {
  loadAuthState,
  saveAuthState,
  clearAuthState,
  isLoggedIn,
} from "../../src/auth/token.js";
import type { AuthState } from "../../src/auth/types.js";

const AUTH_PATH = join(getConfigDir("swixter"), "auth.json");

const mockAuth: AuthState = {
  accessToken: "test-access-token",
  refreshToken: "test-refresh-token",
  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  authMethod: "password",
  userId: "user-123",
  email: "test@example.com",
};

describe("Auth Token Management", () => {
  beforeEach(async () => {
    // Clean up before each test
    if (existsSync(AUTH_PATH)) {
      await unlink(AUTH_PATH);
    }
  });

  afterEach(async () => {
    if (existsSync(AUTH_PATH)) {
      await unlink(AUTH_PATH);
    }
  });

  it("should return null when no auth file exists", async () => {
    const state = await loadAuthState();
    expect(state).toBeNull();
  });

  it("should save and load auth state", async () => {
    await saveAuthState(mockAuth);
    const loaded = await loadAuthState();
    expect(loaded).not.toBeNull();
    expect(loaded!.email).toBe("test@example.com");
    expect(loaded!.accessToken).toBe("test-access-token");
  });

  it("should report logged in when token is valid", async () => {
    await saveAuthState(mockAuth);
    const loggedIn = await isLoggedIn();
    expect(loggedIn).toBe(true);
  });

  it("should report not logged in when token is expired", async () => {
    const expiredAuth = {
      ...mockAuth,
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    await saveAuthState(expiredAuth);
    // isLoggedIn calls getAccessToken which tries to refresh
    // Since the refresh will fail (no server), it should clear auth and return null
    const loggedIn = await isLoggedIn();
    expect(loggedIn).toBe(false);
  });

  it("should clear auth state", async () => {
    await saveAuthState(mockAuth);
    await clearAuthState();
    const state = await loadAuthState();
    expect(state).toBeNull();
  });
});
