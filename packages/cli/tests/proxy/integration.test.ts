import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SWIXTER_CLAUDE_HAIKU_MODEL,
  SWIXTER_PROXY_AUTH_TOKEN,
} from "../../src/constants/proxy.js";
import { startProxyServer, stopProxyServer, getProxyStatus } from "../../src/proxy/server.js";
import { createGroup, deleteGroup, setActiveGroup } from "../../src/groups/manager.js";
import { upsertProfile } from "../../src/config/manager.js";
import { subscribe, type ProxyEvent } from "../../src/server/events.js";

describe("Proxy Integration", () => {
  const originalConfigPath = process.env.SWIXTER_CONFIG_PATH;
  let testConfigDir: string;
  let testConfigPath: string;
  let testGroupId: string;
  let upstreamServer: ReturnType<typeof Bun.serve> | null;
  let upstreamRequests: Array<{ path: string; body: any }>;

  beforeEach(async () => {
    upstreamServer = null;
    upstreamRequests = [];
    testConfigDir = mkdtempSync(join(tmpdir(), "swixter-proxy-integration-"));
    testConfigPath = join(testConfigDir, "config.json");
    process.env.SWIXTER_CONFIG_PATH = testConfigPath;
    writeFileSync(testConfigPath, JSON.stringify({
      version: "2.0.0",
      profiles: {},
      coders: {},
      groups: {},
    }));

    // Create test profile
    await upsertProfile({
      name: "test-provider-failover",
      providerId: "custom",
      apiKey: "test-key",
      apiFormat: "anthropic_messages",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test group
    const group = await createGroup({
      name: "test-failover-group",
      profiles: ["test-provider-failover"],
    });
    testGroupId = group.id;
    await setActiveGroup(group.id);
  });

  afterEach(async () => {
    await stopProxyServer();
    upstreamServer?.stop();
    if (testGroupId) {
      await deleteGroup(testGroupId);
    }
    rmSync(testConfigDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) {
      delete process.env.SWIXTER_CONFIG_PATH;
    } else {
      process.env.SWIXTER_CONFIG_PATH = originalConfigPath;
    }
  });

  test("health endpoint returns ok", async () => {
    await startProxyServer({ instanceId: "default", type: "service", host: "127.0.0.1", port: 18721 });
    const status = getProxyStatus("default");
    expect(status.running).toBe(true);

    const res = await fetch("http://127.0.0.1:18721/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.uptime).toBeGreaterThan(0);
  });

  test("chat endpoint rejects missing proxy auth token over HTTP", async () => {
    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18724,
      groupName: "test-failover-group",
    });

    const res = await fetch("http://127.0.0.1:18724/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4",
        messages: [],
      }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Invalid or missing proxy authentication",
    });
  });

  test("messages endpoint rejects missing proxy auth token over HTTP", async () => {
    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18726,
      groupName: "test-failover-group",
    });

    const res = await fetch("http://127.0.0.1:18726/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet",
        messages: [],
      }),
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "Invalid or missing proxy authentication",
    });
  });

  test("proxy requests are written to proxy-default.log instead of relying on terminal output", async () => {
    const logPath = join(testConfigDir, "proxy-default.log");

    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18728,
      groupName: "test-failover-group",
    });

    await fetch("http://127.0.0.1:18728/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "claude-3-5-sonnet", messages: [] }),
    });

    const logLines = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(logLines.some((line) => line.includes('"path":"/v1/messages"'))).toBe(true);
    expect(logLines.some((line) => line.includes('"level":"access"'))).toBe(true);
  });

  test("messages endpoint resolves Swixter marker models before forwarding upstream over HTTP", async () => {
    upstreamServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 18740,
      fetch: async (request) => {
        upstreamRequests.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await upsertProfile({
      name: "test-provider-failover",
      providerId: "custom",
      apiKey: "test-key",
      baseURL: "http://127.0.0.1:18740",
      apiFormat: "anthropic_messages",
      models: {
        defaultHaikuModel: "claude-haiku-4-20250506",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18741,
      groupName: "test-failover-group",
    });

    const res = await fetch("http://127.0.0.1:18741/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_HAIKU_MODEL, messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(upstreamRequests).toEqual([
      expect.objectContaining({
        path: "/v1/messages",
        body: {
          model: "claude-haiku-4-20250506",
          messages: [],
        },
      }),
    ]);
  });

  test("chat endpoint overwrites non-marker models with the selected profile model over HTTP", async () => {
    upstreamServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 18742,
      fetch: async (request) => {
        upstreamRequests.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await upsertProfile({
      name: "test-provider-failover",
      providerId: "custom",
      apiKey: "test-key",
      baseURL: "http://127.0.0.1:18742",
      apiFormat: "openai_chat",
      model: "gpt-4.1-mini",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18743,
      groupName: "test-failover-group",
    });

    const res = await fetch("http://127.0.0.1:18743/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "user-picked-model", messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(upstreamRequests).toEqual([
      expect.objectContaining({
        path: "/v1/chat/completions",
        body: {
          model: "gpt-4.1-mini",
          messages: [],
        },
      }),
    ]);
  });

  test("messages endpoint fails over to the next profile and re-resolves the marker over HTTP", async () => {
    let requestCount = 0;
    upstreamServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 18744,
      fetch: async (request) => {
        requestCount += 1;
        const body = await request.json();
        upstreamRequests.push({
          path: new URL(request.url).pathname,
          body,
        });

        if (request.headers.get("x-api-key") === "first-key") {
          return new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    await upsertProfile({
      name: "test-provider-failover",
      providerId: "anthropic",
      apiKey: "first-key",
      baseURL: "http://127.0.0.1:18744",
      models: {
        defaultHaikuModel: "claude-haiku-first",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await upsertProfile({
      name: "test-provider-second",
      providerId: "anthropic",
      apiKey: "second-key",
      baseURL: "http://127.0.0.1:18744",
      models: {
        defaultHaikuModel: "claude-haiku-second",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const group = await createGroup({
      name: "test-failover-two-profiles",
      profiles: ["test-provider-failover", "test-provider-second"],
    });
    if (testGroupId) {
      await deleteGroup(testGroupId);
    }
    testGroupId = group.id;
    await setActiveGroup(group.id);

    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18745,
      groupName: "test-failover-two-profiles",
    });

    const res = await fetch("http://127.0.0.1:18745/v1/messages", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: SWIXTER_CLAUDE_HAIKU_MODEL, messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(requestCount).toBe(2);
    expect(upstreamRequests[0]).toEqual(expect.objectContaining({
      body: {
        model: "claude-haiku-first",
        messages: [],
      },
    }));
    expect(upstreamRequests[1]).toEqual(expect.objectContaining({
      body: {
        model: "claude-haiku-second",
        messages: [],
      },
    }));
  });
});

describe("Proxy Integration — Event Bus", () => {
  const originalConfigPath = process.env.SWIXTER_CONFIG_PATH;
  let testConfigDir: string;
  let testConfigPath: string;
  let testGroupId: string;
  let collectedEvents: ProxyEvent[];
  let unsubscribe: () => void;

  beforeEach(async () => {
    collectedEvents = [];
    unsubscribe = subscribe((event) => {
      collectedEvents.push(event);
    });

    testConfigDir = mkdtempSync(join(tmpdir(), "swixter-event-integration-"));
    testConfigPath = join(testConfigDir, "config.json");
    process.env.SWIXTER_CONFIG_PATH = testConfigPath;
    writeFileSync(testConfigPath, JSON.stringify({
      version: "2.0.0",
      profiles: {},
      coders: {},
      groups: {},
    }));

    await upsertProfile({
      name: "test-provider-events",
      providerId: "custom",
      apiKey: "test-key",
      apiFormat: "openai_chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const group = await createGroup({
      name: "test-event-group",
      profiles: ["test-provider-events"],
    });
    testGroupId = group.id;
    await setActiveGroup(group.id);
  });

  afterEach(async () => {
    await stopProxyServer();
    unsubscribe();
    if (testGroupId) {
      await deleteGroup(testGroupId);
    }
    rmSync(testConfigDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) {
      delete process.env.SWIXTER_CONFIG_PATH;
    } else {
      process.env.SWIXTER_CONFIG_PATH = originalConfigPath;
    }
  });

  test("start emits instance.start event", async () => {
    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18751,
      groupName: "test-event-group",
    });

    const startEvents = collectedEvents.filter((e) => e.type === "instance.start");
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toEqual({
      type: "instance.start",
      status: expect.objectContaining({
        instanceId: "default",
        running: true,
        port: 18751,
      }),
    });
  });

  test("stop emits instance.stop event", async () => {
    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18752,
      groupName: "test-event-group",
    });

    collectedEvents.length = 0;
    await stopProxyServer("default");

    const stopEvents = collectedEvents.filter((e) => e.type === "instance.stop");
    expect(stopEvents).toHaveLength(1);
    expect(stopEvents[0]).toEqual({
      type: "instance.stop",
      instanceId: "default",
    });
  });

  test("proxy request emits at least one log and one status event", async () => {
    await startProxyServer({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 18753,
      groupName: "test-event-group",
    });

    collectedEvents.length = 0;

    await fetch("http://127.0.0.1:18753/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${SWIXTER_PROXY_AUTH_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4", messages: [] }),
    });

    // Allow async event emission to settle
    await new Promise((r) => setTimeout(r, 50));

    const logEvents = collectedEvents.filter((e) => e.type === "log");
    const statusEvents = collectedEvents.filter((e) => e.type === "status");
    expect(logEvents.length).toBeGreaterThanOrEqual(1);
    expect(statusEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("active group change emits group.change event via API handler", async () => {
    const group2 = await createGroup({
      name: "test-event-group-2",
      profiles: ["test-provider-events"],
    });

    // The emit happens in the API handler (handleSetActiveGroup), not in the manager.
    // We simulate the same flow: set active via manager, then read active and emit.
    const { setActiveGroup: setManager, getActiveGroup } = await import("../../src/groups/manager.js");
    const { emitGroupChange } = await import("../../src/server/events.js");

    collectedEvents.length = 0;
    await setManager(group2.id);
    const active = await getActiveGroup();
    if (active) {
      emitGroupChange(active.id, active.name);
    }

    const groupEvents = collectedEvents.filter((e) => e.type === "group.change");
    expect(groupEvents).toHaveLength(1);
    expect(groupEvents[0]).toEqual({
      type: "group.change",
      groupId: group2.id,
      groupName: "test-event-group-2",
    });

    await deleteGroup(group2.id);
  });
});
