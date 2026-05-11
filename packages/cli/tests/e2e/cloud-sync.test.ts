/**
 * End-to-end cloud sync test
 * Atomic tests — each test is independent and verifies a single API behavior.
 * Requires the Workers API to be running.
 */

import { describe, test, expect } from "bun:test";
import { sendVerificationCode, loginUser } from "../../src/auth/client";
import { getSyncStatus } from "../../src/sync/client";

describe("Cloud Sync E2E", () => {
  test("send verification code succeeds", async () => {
    const result = await sendVerificationCode(`e2e-${Date.now()}@test.com`);
    expect(result.success).toBe(true);
    expect(result.expiresIn).toBeGreaterThan(0);
  });

  test("login with wrong credentials returns 401", async () => {
    try {
      await loginUser({ email: "nonexistent@test.com", password: "wrong" });
      expect(false).toBe(true); // should not reach here
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });

  test("sync request without valid token returns 401", async () => {
    try {
      await getSyncStatus("invalid-token");
      expect(false).toBe(true); // should not reach here
    } catch (err: any) {
      expect(err.status).toBe(401);
    }
  });
});
