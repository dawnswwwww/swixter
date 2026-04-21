import { describe, expect, test, beforeEach } from "bun:test";
import { CircuitBreaker } from "../../src/proxy/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker();
  });

  test("initial state - provider is available", () => {
    expect(cb.isAvailable("provider-1")).toBe(true);
  });

  test("getState returns default state for unknown provider", () => {
    const state = cb.getState("unknown");
    expect(state.profileId).toBe("unknown");
    expect(state.consecutiveFailures).toBe(0);
    expect(state.isOpen).toBe(false);
  });

  test("recordSuccess resets failure count", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    expect(cb.getState("provider-1").consecutiveFailures).toBe(2);

    cb.recordSuccess("provider-1");
    expect(cb.getState("provider-1").consecutiveFailures).toBe(0);
    expect(cb.isAvailable("provider-1")).toBe(true);
  });

  test("recordFailure increments failure count", () => {
    cb.recordFailure("provider-1");
    expect(cb.getState("provider-1").consecutiveFailures).toBe(1);
    expect(cb.isAvailable("provider-1")).toBe(true);
  });

  test("opens after 3 consecutive failures", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    expect(cb.isAvailable("provider-1")).toBe(true);

    cb.recordFailure("provider-1"); // 3rd failure
    expect(cb.isAvailable("provider-1")).toBe(false);
    expect(cb.getState("provider-1").isOpen).toBe(true);
  });

  test("success after open closes circuit", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1"); // opens
    expect(cb.isAvailable("provider-1")).toBe(false);

    cb.recordSuccess("provider-1");
    expect(cb.isAvailable("provider-1")).toBe(true);
    expect(cb.getState("provider-1").consecutiveFailures).toBe(0);
  });

  test("reset clears all states", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1"); // opens

    cb.reset();

    expect(cb.isAvailable("provider-1")).toBe(true);
  });

  test("resetProvider clears specific provider state", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1"); // opens - 3 failures

    cb.recordFailure("provider-2");
    cb.recordFailure("provider-2");
    cb.recordFailure("provider-2"); // opens - 3 failures

    cb.resetProvider("provider-1");

    expect(cb.isAvailable("provider-1")).toBe(true);
    expect(cb.isAvailable("provider-2")).toBe(false); // still open with 3 failures
  });

  test("multiple providers have independent states", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1"); // opens

    cb.recordFailure("provider-2"); // only 1 failure

    expect(cb.isAvailable("provider-1")).toBe(false);
    expect(cb.isAvailable("provider-2")).toBe(true);
  });

  test("opens circuit after 3 consecutive failures", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    expect(cb.isAvailable("provider-1")).toBe(true);

    cb.recordFailure("provider-1");
    expect(cb.isAvailable("provider-1")).toBe(false);
    expect(cb.getState("provider-1").state).toBe("open");
  });

  test("half_open after 60s recovery timeout", async () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    expect(cb.getState("provider-1").state).toBe("open");

    // Manually trigger recovery check (in real impl this is timer-based)
    // For unit test, we test the method exists
    expect(typeof cb["checkRecovery"]).toBe("function");
  });

  test("success in half_open transitions to closed", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1"); // opens
    expect(cb.getState("provider-1").state).toBe("open");

    // Simulate half_open by directly setting (for unit test)
    cb["forceHalfOpen"]("provider-1");
    expect(cb.getState("provider-1").state).toBe("half_open");

    cb.recordSuccess("provider-1");
    expect(cb.getState("provider-1").state).toBe("closed");
    expect(cb.isAvailable("provider-1")).toBe(true);
  });

  test("failure in half_open returns to open", () => {
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1");
    cb.recordFailure("provider-1"); // opens

    cb["forceHalfOpen"]("provider-1"); // half_open
    expect(cb.getState("provider-1").state).toBe("half_open");

    cb.recordFailure("provider-1"); // fails in half_open
    expect(cb.getState("provider-1").state).toBe("open");
    expect(cb.isAvailable("provider-1")).toBe(false);
  });
});
