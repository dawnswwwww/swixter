/**
 * End-to-end cloud sync test
 * Tests the full flow: register → push → pull → status
 * Requires the Workers API to be running.
 */

import { describe, test, expect } from "bun:test";
import { sendVerificationCode, verifyAndRegister, loginUser, logoutUser } from "../../src/auth/client";
import { getSyncStatus, pushData, pullData } from "../../src/sync/client";
import { saveAuthState, clearAuthState, loadAuthState } from "../../src/auth/token";

describe("Cloud Sync E2E", () => {
  const testEmail = `e2e-${Date.now()}@test.com`;
  const testPassword = "testpass123";
  let accessToken: string;
  let refreshToken: string;

  test("register new account", async () => {
    // Step 1: Send verification code
    const sendResult = await sendVerificationCode(testEmail);
    expect(sendResult.success).toBe(true);
    expect(sendResult.code).toBeTruthy(); // Returned in test env

    // Step 2: Verify code and complete registration
    const result = await verifyAndRegister({
      email: testEmail,
      code: sendResult.code!,
      password: testPassword,
      displayName: "E2E Test",
    });

    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    expect(result.encryptionSalt).toBeTruthy();
    expect(result.user.email).toBe(testEmail);

    accessToken = result.accessToken;
    refreshToken = result.refreshToken;

    // Save auth state locally (as CLI would do)
    await saveAuthState({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      encryptionSalt: result.encryptionSalt,
      authMethod: "password",
      userId: result.user.id,
      email: result.user.email,
    });
  });

  test("push config data", async () => {
    const result = await pushData(accessToken, {
      dataKey: "config",
      encryptedData: "encrypted-config-v1",
      dataVersion: 0,
      clientTimestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    expect(result.dataVersion).toBe(1);
  });

  test("push providers data", async () => {
    const result = await pushData(accessToken, {
      dataKey: "providers",
      encryptedData: "encrypted-providers-v1",
      dataVersion: 0,
      clientTimestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    expect(result.dataVersion).toBe(1);
  });

  test("get sync status", async () => {
    const status = await getSyncStatus(accessToken);

    expect(status.statuses).toHaveLength(2);
    expect(status.statuses.map((s) => s.dataKey).sort()).toEqual(["config", "providers"]);
  });

  test("pull config data", async () => {
    const result = await pullData(accessToken, "config");

    expect(result.encryptedData).toBe("encrypted-config-v1");
    expect(result.dataVersion).toBe(1);
  });

  test("pull providers data", async () => {
    const result = await pullData(accessToken, "providers");

    expect(result.encryptedData).toBe("encrypted-providers-v1");
    expect(result.dataVersion).toBe(1);
  });

  test("detect version conflict", async () => {
    try {
      await pushData(accessToken, {
        dataKey: "config",
        encryptedData: "should-fail",
        dataVersion: 0, // stale version
        clientTimestamp: new Date().toISOString(),
      });
      expect(false).toBe(true); // should not reach here
    } catch (err: any) {
      expect(err.status).toBe(409);
      expect(err.code).toBe("CONFLICT");
    }
  });

  test("push with correct version", async () => {
    const result = await pushData(accessToken, {
      dataKey: "config",
      encryptedData: "encrypted-config-v2",
      dataVersion: 1,
      clientTimestamp: new Date().toISOString(),
    });

    expect(result.success).toBe(true);
    expect(result.dataVersion).toBe(2);
  });

  test("logout", async () => {
    await logoutUser(refreshToken);
    await clearAuthState();

    const state = await loadAuthState();
    expect(state).toBeNull();
  });
});
