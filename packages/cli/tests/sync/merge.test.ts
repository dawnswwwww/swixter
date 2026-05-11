import { describe, test, expect } from "bun:test";
import { detectConflict } from "../../src/sync/merge";
import type { SyncMeta, SyncStatusEntry } from "../../src/sync/types";

describe("detectConflict", () => {
  test("returns null when local and remote versions match", () => {
    const localMeta: SyncMeta = {
      lastSyncAt: "2026-04-22T10:00:00Z",
      configVersion: 3,
      providersVersion: 2,
      localUpdatedAt: "2026-04-22T09:30:00Z",
    };

    const remoteStatuses: SyncStatusEntry[] = [
      { dataKey: "config", dataVersion: 3, updatedAt: "2026-04-22T10:00:00Z" },
    ];

    const conflict = detectConflict(localMeta, remoteStatuses, "config");
    expect(conflict).toBeNull();
  });

  test("returns conflict when remote version is higher", () => {
    const localMeta: SyncMeta = {
      lastSyncAt: "2026-04-22T10:00:00Z",
      configVersion: 3,
      providersVersion: 2,
      localUpdatedAt: "2026-04-22T09:30:00Z",
    };

    const remoteStatuses: SyncStatusEntry[] = [
      { dataKey: "config", dataVersion: 5, updatedAt: "2026-04-22T12:00:00Z" },
    ];

    const conflict = detectConflict(localMeta, remoteStatuses, "config");
    expect(conflict).not.toBeNull();
    expect(conflict!.localVersion).toBe(3);
    expect(conflict!.remoteVersion).toBe(5);
    expect(conflict!.dataKey).toBe("config");
  });

  test("returns null when remote has no data (version 0)", () => {
    const localMeta: SyncMeta = {
      lastSyncAt: "2026-04-22T10:00:00Z",
      configVersion: 3,
      providersVersion: 0,
      localUpdatedAt: "2026-04-22T09:30:00Z",
    };

    const remoteStatuses: SyncStatusEntry[] = [];

    const conflict = detectConflict(localMeta, remoteStatuses, "providers");
    expect(conflict).toBeNull();
  });

  test("detects conflict for providers data key", () => {
    const localMeta: SyncMeta = {
      lastSyncAt: "2026-04-22T10:00:00Z",
      configVersion: 3,
      providersVersion: 2,
      localUpdatedAt: "2026-04-22T09:30:00Z",
    };

    const remoteStatuses: SyncStatusEntry[] = [
      { dataKey: "config", dataVersion: 3, updatedAt: "2026-04-22T10:00:00Z" },
      { dataKey: "providers", dataVersion: 5, updatedAt: "2026-04-22T12:00:00Z" },
    ];

    const conflict = detectConflict(localMeta, remoteStatuses, "providers");
    expect(conflict).not.toBeNull();
    expect(conflict!.localVersion).toBe(2);
    expect(conflict!.remoteVersion).toBe(5);
  });

  test("returns null when no local meta (first sync)", () => {
    const remoteStatuses: SyncStatusEntry[] = [
      { dataKey: "config", dataVersion: 3, updatedAt: "2026-04-22T10:00:00Z" },
    ];

    const conflict = detectConflict(null, remoteStatuses, "config");
    expect(conflict).toBeNull();
  });
});
