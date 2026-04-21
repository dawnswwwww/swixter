import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { WsManager } from "../../src/server/ws-manager.js";
import { emitStatusUpdate, emitInstanceStart, emitGroupChange, subscribe, type ProxyEvent } from "../../src/server/events.js";
import type { ProxyStatus } from "../../src/proxy/types.js";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function createStatus(overrides: Partial<ProxyStatus> = {}): ProxyStatus {
  return {
    instanceId: "default",
    type: "service",
    running: true,
    host: "127.0.0.1",
    port: 15721,
    requestCount: 0,
    errorCount: 0,
    ...overrides,
  };
}

// Minimal mock for ServerWebSocket
function createMockWs(): any {
  const messages: string[] = [];
  return {
    messages,
    send(data: string) {
      messages.push(data);
    },
    close() {},
  };
}

describe("WsManager", () => {
  let manager: WsManager;
  const originalConfigPath = process.env.SWIXTER_CONFIG_PATH;
  let testConfigDir: string;

  beforeEach(() => {
    testConfigDir = mkdtempSync(join(tmpdir(), "swixter-ws-test-"));
    process.env.SWIXTER_CONFIG_PATH = join(testConfigDir, "config.json");
    writeFileSync(process.env.SWIXTER_CONFIG_PATH, JSON.stringify({
      version: "2.0.0",
      profiles: {},
      coders: {},
      groups: {},
    }));
    manager = new WsManager();
  });

  afterEach(() => {
    manager.stop();
    rmSync(testConfigDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) {
      delete process.env.SWIXTER_CONFIG_PATH;
    } else {
      process.env.SWIXTER_CONFIG_PATH = originalConfigPath;
    }
  });

  test("client receives snapshot on connect", async () => {
    manager.start();

    const ws = createMockWs();
    await manager.addClient(ws);

    expect(ws.messages.length).toBeGreaterThanOrEqual(1);
    const snapshot = JSON.parse(ws.messages[0]);
    expect(snapshot.type).toBe("snapshot");
    expect(snapshot.instances).toBeDefined();
  });

  test("broadcast sends event to all clients", () => {
    manager.start();

    const ws1 = createMockWs();
    const ws2 = createMockWs();
    // Add without awaiting since we just need them in the set
    manager.addClient(ws1);
    manager.addClient(ws2);

    const status = createStatus({ requestCount: 5 });
    emitStatusUpdate(status);

    // Both clients should receive the status event
    const ws1Events = ws1.messages.map((m: string) => JSON.parse(m));
    const ws2Events = ws2.messages.map((m: string) => JSON.parse(m));

    const ws1Status = ws1Events.find((e: any) => e.type === "status");
    const ws2Status = ws2Events.find((e: any) => e.type === "status");

    expect(ws1Status).toBeDefined();
    expect(ws2Status).toBeDefined();
    expect(ws1Status.status.requestCount).toBe(5);
    expect(ws2Status.status.requestCount).toBe(5);
  });

  test("one client send throwing does not affect other clients", async () => {
    manager.start();

    const goodWs = createMockWs();
    const badWs = {
      messages: [] as string[],
      send(_data: string) {
        throw new Error("send failed");
      },
      close() {},
    };

    await manager.addClient(goodWs);
    // Manually add bad client since addClient would try to sendSnapshot
    (manager as any).clients.add(badWs);

    const status = createStatus();
    emitStatusUpdate(status);

    const events = goodWs.messages.map((m: string) => JSON.parse(m));
    const statusEvent = events.find((e: any) => e.type === "status");
    expect(statusEvent).toBeDefined();
  });

  test("stop unsubscribes from event bus", async () => {
    manager.start();

    const ws = createMockWs();
    await manager.addClient(ws);

    manager.stop();

    // Emit event after stop — should NOT reach any client
    const beforeCount = ws.messages.length;
    emitStatusUpdate(createStatus());

    expect(ws.messages.length).toBe(beforeCount);
  });

  test("removeClient removes client from broadcast set", async () => {
    manager.start();

    const ws = createMockWs();
    await manager.addClient(ws);
    manager.removeClient(ws);

    const beforeCount = ws.messages.length;
    emitStatusUpdate(createStatus());

    expect(ws.messages.length).toBe(beforeCount);
  });
});
