import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProxyForwarder } from "../../src/proxy/forwarder.js";

describe("ProxyForwarder auth selection", () => {
  const originalFetch = global.fetch;
  const originalConfigPath = process.env.SWIXTER_CONFIG_PATH;
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = mkdtempSync(join(tmpdir(), "swixter-proxy-forwarder-test-"));
    process.env.SWIXTER_CONFIG_PATH = join(testConfigDir, "config.json");
    global.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      return new Response("ok", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-auth-header": JSON.stringify(init?.headers ?? {}),
        },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    rmSync(testConfigDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) {
      delete process.env.SWIXTER_CONFIG_PATH;
    } else {
      process.env.SWIXTER_CONFIG_PATH = originalConfigPath;
    }
  });

  test("prefers profile authToken for responses providers", async () => {
    const forwarder = new ProxyForwarder();
    const response = await forwarder.forward(
      {
        method: "POST",
        path: "/v1/messages",
        headers: {
          authorization: "Bearer client-token",
          "X-Api-Key": "client-api-key",
          "Content-Length": "999",
        },
        body: JSON.stringify({}),
      },
      {
        name: "anthropic-profile",
        providerId: "anthropic",
        apiKey: "provider-api-key",
        authToken: "provider-auth-token",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );

    expect(response.status).toBe(200);
    const headerDump = JSON.parse(response.headers["x-auth-header"]);
    expect(headerDump["x-api-key"]).toBe("provider-auth-token");
    expect(headerDump.authorization).toBeUndefined();
    expect(headerDump["X-Api-Key"]).toBeUndefined();
    expect(headerDump["Content-Length"]).toBeUndefined();
  });

  test("does not forward the inbound host header to upstream providers", async () => {
    const forwarder = new ProxyForwarder();
    const response = await forwarder.forward(
      {
        method: "POST",
        path: "/v1/messages",
        headers: {
          host: "127.0.0.1:15721",
          authorization: "Bearer client-token",
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      {
        name: "zai-profile",
        providerId: "zhipu-cn",
        apiKey: "",
        authToken: "provider-auth-token",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );

    expect(response.status).toBe(200);
    const headerDump = JSON.parse(response.headers["x-auth-header"]);
    expect(headerDump.host).toBeUndefined();
    expect(headerDump["x-api-key"]).toBe("provider-auth-token");
  });

  test("uses the longer default timeout", async () => {
    const forwarder = new ProxyForwarder();
    const fetchSpy = global.fetch as ReturnType<typeof mock>;

    await forwarder.forward(
      { method: "POST", path: "/v1/messages", headers: {}, body: JSON.stringify({}) },
      {
        name: "anthropic-profile",
        providerId: "anthropic",
        apiKey: "provider-api-key",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );

    expect(fetchSpy).toHaveBeenCalled();
  });
});
