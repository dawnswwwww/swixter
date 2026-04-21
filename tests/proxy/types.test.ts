import { describe, expect, test } from "bun:test";
import type { ProxyConfig, CircuitState, ForwardResponse } from "../../src/proxy/types.js";

describe("Proxy types", () => {
  test("ProxyConfig should accept timeout option", () => {
    const config: ProxyConfig = {
      host: "127.0.0.1",
      port: 15721,
      timeout: 60000,
    };
    expect(config.timeout).toBe(60000);
  });

  test("CircuitState should have state field", () => {
    const state: CircuitState = {
      profileId: "test",
      consecutiveFailures: 0,
      isOpen: false,
      state: "closed",
    };
    expect(state.state).toBe("closed");
  });

  test("ForwardResponse interface supports stream", () => {
    const response: ForwardResponse = {
      status: 200,
      headers: {},
      body: "test",
      isStream: false,
    };
    expect(response.isStream).toBe(false);
  });
});