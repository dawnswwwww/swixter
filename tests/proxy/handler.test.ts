import * as configManager from "../../src/config/manager.js";
import { SWIXTER_CLAUDE_HAIKU_MODEL, SWIXTER_CLAUDE_MODEL, SWIXTER_PROXY_AUTH_TOKEN } from "../../src/constants/proxy.js";
import * as groupManager from "../../src/groups/manager.js";
import { ProxyHandler } from "../../src/proxy/handler.js";
import { ProxyForwarder } from "../../src/proxy/forwarder.js";

describe("ProxyHandler", () => {
  let getActiveGroupSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    getActiveGroupSpy = vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("handler has circuit breaker", () => {
    const handler = new ProxyHandler();
    const cb = handler.getCircuitBreaker();

    expect(cb).toBeDefined();
    expect(typeof cb.isAvailable).toBe("function");
    expect(typeof cb.recordSuccess).toBe("function");
    expect(typeof cb.recordFailure).toBe("function");
  });

  test("health endpoint returns status", async () => {
    const handler = new ProxyHandler();
    const request = new Request("http://localhost/health");
    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
    expect(body.uptime).toBeDefined();
  });

  test("chat endpoint rejects missing proxy auth token", async () => {
    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid or missing proxy authentication" });
    expect(getActiveGroupSpy).not.toHaveBeenCalled();
  });

  test("chat endpoint rejects invalid proxy auth token", async () => {
    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-token",
      },
      body: JSON.stringify({ model: "test", messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Invalid or missing proxy authentication" });
    expect(getActiveGroupSpy).not.toHaveBeenCalled();
  });

  test("chat endpoint accepts valid proxy auth token and reaches group resolution", async () => {
    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: "test", messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(503);
    expect(getActiveGroupSpy).toHaveBeenCalledTimes(1);
  });

  test("messages endpoint is registered", async () => {
    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: "test", messages: [] }),
    });

    const response = await handler.handleRequest(request);
    expect(response.status).toBe(503);
  });

  test("responses endpoint is registered", async () => {
    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: "test" }),
    });

    const response = await handler.handleRequest(request);
    expect(response.status).toBe(503);
  });

  test("anthropic wildcard endpoint is registered", async () => {
    const handler = new ProxyHandler();
    const request = new Request("http://localhost/anthropic/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({}),
    });

    const response = await handler.handleRequest(request);
    expect(response.status).toBe(503);
  });

  test("messages endpoint falls back to the original request model when a marker cannot be resolved for a profile", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockResolvedValue({
      name: "profile-1",
      providerId: "custom",
      apiKey: "key",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const forwardSpy = vi.spyOn(ProxyForwarder.prototype, "forward").mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
      isStream: false,
    });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_MODEL, messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);
    const forwarded = forwardSpy.mock.calls[0]?.[0];
    expect(JSON.parse(Buffer.from(forwarded.body as Uint8Array).toString("utf-8"))).toEqual({
      model: SWIXTER_CLAUDE_MODEL,
      messages: [],
    });
  });

  test("messages endpoint resolves Swixter marker models against the selected profile before forwarding", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockResolvedValue({
      name: "profile-1",
      providerId: "anthropic",
      apiKey: "key",
      models: {
        defaultHaikuModel: "claude-haiku-4-20250506",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const forwardSpy = vi.spyOn(ProxyForwarder.prototype, "forward").mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
      isStream: false,
    });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_HAIKU_MODEL, messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);
    const forwarded = forwardSpy.mock.calls[0]?.[0];
    expect(forwarded).toBeDefined();
    expect(JSON.parse(Buffer.from(forwarded.body as Uint8Array).toString("utf-8"))).toEqual({
      model: "claude-haiku-4-20250506",
      messages: [],
    });
  });

  test("chat endpoint overwrites a non-marker model with the selected profile general model", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockResolvedValue({
      name: "profile-1",
      providerId: "openai",
      apiKey: "key",
      model: "gpt-4.1-mini",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const forwardSpy = vi.spyOn(ProxyForwarder.prototype, "forward").mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
      isStream: false,
    });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: "user-picked-model", messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);
    const forwarded = forwardSpy.mock.calls[0]?.[0];
    expect(JSON.parse(Buffer.from(forwarded.body as Uint8Array).toString("utf-8"))).toEqual({
      model: "gpt-4.1-mini",
      messages: [],
    });
  });

  test("messages endpoint leaves a non-marker model unchanged when the selected profile has no general model", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockResolvedValue({
      name: "profile-1",
      providerId: "anthropic",
      apiKey: "key",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const forwardSpy = vi.spyOn(ProxyForwarder.prototype, "forward").mockResolvedValue({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
      isStream: false,
    });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: "user-picked-model", messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);
    const forwarded = forwardSpy.mock.calls[0]?.[0];
    expect(JSON.parse(Buffer.from(forwarded.body as Uint8Array).toString("utf-8"))).toEqual({
      model: "user-picked-model",
      messages: [],
    });
  });

  test("messages endpoint fails over on upstream 404 and uses the next profile", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1", "profile-2"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockImplementation(async (profileName: string) => ({
      name: profileName,
      providerId: "anthropic",
      apiKey: `${profileName}-key`,
      models: {
        defaultHaikuModel: profileName === "profile-1" ? "claude-haiku-first" : "claude-haiku-second",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const forwardSpy = vi.spyOn(ProxyForwarder.prototype, "forward")
      .mockResolvedValueOnce({
        status: 404,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "not found" }),
        isStream: false,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
        isStream: false,
      });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_HAIKU_MODEL, messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);
    expect(forwardSpy).toHaveBeenCalledTimes(2);
    expect(handler.getCircuitBreaker().getState("profile-1").consecutiveFailures).toBe(0);
    expect(forwardSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ name: "profile-1" }));
    expect(forwardSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ name: "profile-2" }));
  });

  test("messages endpoint returns the last upstream error when every profile fails", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1", "profile-2"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockImplementation(async (profileName: string) => ({
      name: profileName,
      providerId: "anthropic",
      apiKey: `${profileName}-key`,
      models: {
        defaultHaikuModel: profileName === "profile-1" ? "claude-haiku-first" : "claude-haiku-second",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    vi.spyOn(ProxyForwarder.prototype, "forward")
      .mockResolvedValueOnce({
        status: 404,
        headers: { "content-type": "application/json", "x-upstream": "first" },
        body: JSON.stringify({ error: "not found" }),
        isStream: false,
      })
      .mockResolvedValueOnce({
        status: 429,
        headers: { "content-type": "application/json", "x-upstream": "second" },
        body: JSON.stringify({ error: { code: "1305", message: "busy" } }),
        isStream: false,
      });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_HAIKU_MODEL, messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(429);
    expect(response.headers.get("x-upstream")).toBe("second");
    expect(await response.json()).toEqual({ error: { code: "1305", message: "busy" } });
  });

  test("messages endpoint fails over on upstream 500 and uses the next profile", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1", "profile-2"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockImplementation(async (profileName: string) => ({
      name: profileName,
      providerId: "anthropic",
      apiKey: `${profileName}-key`,
      models: {
        defaultHaikuModel: profileName === "profile-1" ? "claude-haiku-first" : "claude-haiku-second",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const forwardSpy = vi.spyOn(ProxyForwarder.prototype, "forward")
      .mockResolvedValueOnce({
        status: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "boom" }),
        isStream: false,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
        isStream: false,
      });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_HAIKU_MODEL, messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);
    expect(forwardSpy).toHaveBeenCalledTimes(2);
    expect(forwardSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ name: "profile-1" }));
    expect(forwardSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ name: "profile-2" }));
  });

  test("messages endpoint fails over on upstream 429 and uses the next profile", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      id: "group-1",
      name: "test-group",
      profiles: ["profile-1", "profile-2"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(configManager, "getProfile").mockImplementation(async (profileName: string) => ({
      name: profileName,
      providerId: "anthropic",
      apiKey: `${profileName}-key`,
      models: {
        defaultHaikuModel: profileName === "profile-1" ? "claude-haiku-first" : "claude-haiku-second",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    const forwardSpy = vi.spyOn(ProxyForwarder.prototype, "forward")
      .mockResolvedValueOnce({
        status: 429,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: { code: "1305", message: "busy" } }),
        isStream: false,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
        isStream: false,
      });

    const handler = new ProxyHandler();
    const request = new Request("http://localhost/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_HAIKU_MODEL, messages: [] }),
    });

    const response = await handler.handleRequest(request);

    expect(response.status).toBe(200);
    expect(forwardSpy).toHaveBeenCalledTimes(2);
    expect(forwardSpy.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ name: "profile-1" }));
    expect(forwardSpy.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ name: "profile-2" }));
  });
});
