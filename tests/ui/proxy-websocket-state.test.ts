import { describe, expect, test } from "bun:test";
import type {
  GroupChangeEvent,
  ProxyLogEntry,
  ProxyStatus,
  ProxyWsServerEvent,
  SnapshotEvent,
} from "../../ui/src/api/types";
import {
  EMPTY_PROXY_WS_STATE,
  LIVE_LOG_LIMIT,
  applyProxyWsEvent,
  dedupeLogEntries,
  mergeLogHistory,
} from "../../ui/src/hooks/proxy-websocket-state";

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

function createLogEntry(index: number, overrides: Partial<ProxyLogEntry> = {}): ProxyLogEntry {
  return {
    ts: new Date(Date.UTC(2026, 3, 10, 0, 0, index)).toISOString(),
    level: "info",
    msg: `entry-${index}`,
    ...overrides,
  };
}

describe("proxy websocket state", () => {
  test("snapshot initializes all instances", () => {
    const snapshot: SnapshotEvent = {
      type: "snapshot",
      instances: [
        createStatus({ instanceId: "default" }),
        createStatus({ instanceId: "run-1", type: "run", port: 15722 }),
      ],
      activeGroupId: "group-1",
      activeGroupName: "Primary Group",
    };

    const state = applyProxyWsEvent(EMPTY_PROXY_WS_STATE, snapshot);

    expect(state.instances).toHaveLength(2);
    expect(state.status?.instanceId).toBe("default");
    expect(state.activeGroupId).toBe("group-1");
    expect(state.activeGroupName).toBe("Primary Group");
    expect(state.instances[0]).toEqual(expect.objectContaining({
      instanceId: "default",
      activeGroup: "group-1",
      activeGroupName: "Primary Group",
    }));
  });

  test("status replaces the latest state for the same instance", () => {
    const initial = applyProxyWsEvent(EMPTY_PROXY_WS_STATE, {
      type: "snapshot",
      instances: [createStatus({ requestCount: 1 })],
      activeGroupId: "group-1",
      activeGroupName: "Primary Group",
    });

    const state = applyProxyWsEvent(initial, {
      type: "status",
      status: createStatus({ requestCount: 3, errorCount: 1 }),
    });

    expect(state.instances).toHaveLength(1);
    expect(state.instances[0]).toEqual(expect.objectContaining({
      instanceId: "default",
      requestCount: 3,
      errorCount: 1,
    }));
    expect(state.status?.requestCount).toBe(3);
  });

  test("status updates preserve instance order", () => {
    const initial = applyProxyWsEvent(EMPTY_PROXY_WS_STATE, {
      type: "snapshot",
      instances: [
        createStatus({ instanceId: "default" }),
        createStatus({ instanceId: "run-1", type: "run", port: 15722 }),
      ],
      activeGroupId: "group-1",
      activeGroupName: "Primary Group",
    });

    const state = applyProxyWsEvent(initial, {
      type: "status",
      status: createStatus({ instanceId: "default", requestCount: 3 }),
    });

    expect(state.instances.map((instance) => instance.instanceId)).toEqual(["default", "run-1"]);
  });

  test("instance.start inserts a new instance", () => {
    const initial = applyProxyWsEvent(EMPTY_PROXY_WS_STATE, {
      type: "snapshot",
      instances: [createStatus({ instanceId: "default" })],
      activeGroupId: "group-1",
      activeGroupName: "Primary Group",
    });

    const state = applyProxyWsEvent(initial, {
      type: "instance.start",
      status: createStatus({ instanceId: "run-1", type: "run", port: 15722 }),
    });

    expect(state.instances.map((instance) => instance.instanceId)).toEqual(["default", "run-1"]);
  });

  test("instance.stop removes an instance", () => {
    const initial = applyProxyWsEvent(EMPTY_PROXY_WS_STATE, {
      type: "snapshot",
      instances: [
        createStatus({ instanceId: "default" }),
        createStatus({ instanceId: "run-1", type: "run", port: 15722 }),
      ],
      activeGroupId: "group-1",
      activeGroupName: "Primary Group",
    });

    const state = applyProxyWsEvent(initial, {
      type: "instance.stop",
      instanceId: "run-1",
    });

    expect(state.instances.map((instance) => instance.instanceId)).toEqual(["default"]);
  });

  test("group.change only updates default instances without a fixed groupName", () => {
    const initial = applyProxyWsEvent(EMPTY_PROXY_WS_STATE, {
      type: "snapshot",
      instances: [
        createStatus({ instanceId: "default", groupName: undefined, activeGroup: undefined, activeGroupName: undefined }),
        createStatus({ instanceId: "run-1", type: "run", port: 15722, groupName: "Pinned Group", activeGroup: "pinned", activeGroupName: "Pinned Group" }),
      ],
      activeGroupId: "group-1",
      activeGroupName: "Primary Group",
    });

    const event: GroupChangeEvent = {
      type: "group.change",
      groupId: "group-2",
      groupName: "Secondary Group",
    };
    const state = applyProxyWsEvent(initial, event);

    expect(state.instances.find((instance) => instance.instanceId === "default")).toEqual(
      expect.objectContaining({
        activeGroup: "group-2",
        activeGroupName: "Secondary Group",
      }),
    );
    expect(state.instances.find((instance) => instance.instanceId === "run-1")).toEqual(
      expect.objectContaining({
        groupName: "Pinned Group",
        activeGroup: "pinned",
        activeGroupName: "Pinned Group",
      }),
    );
  });

  test("log append keeps a bounded per-instance cache and dedupes", () => {
    let state = applyProxyWsEvent(EMPTY_PROXY_WS_STATE, {
      type: "snapshot",
      instances: [createStatus()],
      activeGroupId: "group-1",
      activeGroupName: "Primary Group",
    });

    const duplicate = createLogEntry(0);
    state = applyProxyWsEvent(state, {
      type: "log",
      instanceId: "default",
      entry: duplicate,
    });
    state = applyProxyWsEvent(state, {
      type: "log",
      instanceId: "default",
      entry: duplicate,
    });

    for (let index = 1; index <= LIVE_LOG_LIMIT + 5; index++) {
      state = applyProxyWsEvent(state, {
        type: "log",
        instanceId: "default",
        entry: createLogEntry(index),
      });
    }

    const logs = state.liveLogsByInstance.default;
    expect(logs).toHaveLength(LIVE_LOG_LIMIT);
    expect(logs[0]?.msg).toBe("entry-6");
    expect(logs.at(-1)?.msg).toBe(`entry-${LIVE_LOG_LIMIT + 5}`);
  });

  test("mergeLogHistory dedupes overlapping history and live entries", () => {
    const shared = createLogEntry(1);
    const history = [createLogEntry(0), shared];
    const live = [shared, createLogEntry(2)];

    expect(dedupeLogEntries([shared, shared, createLogEntry(2)])).toEqual([shared, createLogEntry(2)]);
    expect(mergeLogHistory(history, live)).toEqual([createLogEntry(0), shared, createLogEntry(2)]);
  });
});
