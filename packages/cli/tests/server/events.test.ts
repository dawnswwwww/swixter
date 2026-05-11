import { describe, expect, test } from "bun:test";
import type { ProxyStatus } from "../../src/proxy/types.js";
import {
  emitGroupChange,
  emitInstanceStart,
  emitInstanceStop,
  emitStatusUpdate,
  subscribe,
} from "../../src/server/events.js";

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

describe("server events", () => {
  test("subscribe receives emitted events", () => {
    const events: unknown[] = [];
    const unsubscribe = subscribe((event) => {
      events.push(event);
    });

    try {
      const status = createStatus();
      emitStatusUpdate(status);

      expect(events).toEqual([
        {
          type: "status",
          status,
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("instance.start emits the provided status payload", () => {
    const events: unknown[] = [];
    const unsubscribe = subscribe((event) => {
      events.push(event);
    });

    try {
      const status = createStatus({ instanceId: "run-1", type: "run", port: 15722 });
      emitInstanceStart(status);

      expect(events).toEqual([
        {
          type: "instance.start",
          status,
        },
      ]);
    } finally {
      unsubscribe();
    }
  });

  test("unsubscribe removes the handler", () => {
    const events: unknown[] = [];
    const unsubscribe = subscribe((event) => {
      events.push(event);
    });

    unsubscribe();
    emitInstanceStop("default");

    expect(events).toEqual([]);
  });

  test("one subscriber throwing does not affect other subscribers", () => {
    const events: unknown[] = [];
    const unsubscribeGood = subscribe((event) => {
      events.push(event);
    });
    const unsubscribeBad = subscribe(() => {
      throw new Error("boom");
    });

    try {
      emitGroupChange("group-1", "Primary Group");

      expect(events).toEqual([
        {
          type: "group.change",
          groupId: "group-1",
          groupName: "Primary Group",
        },
      ]);
    } finally {
      unsubscribeGood();
      unsubscribeBad();
    }
  });
});
