/**
 * Conflict detection for sync operations.
 */

import type { SyncMeta, SyncStatusEntry, SyncConflict } from "./types.js";

/**
 * Map dataKey to the corresponding version field in SyncMeta.
 */
function getLocalVersion(
  meta: SyncMeta | null,
  dataKey: string
): number {
  if (!meta) return 0;

  if (dataKey === "config") return meta.configVersion;
  if (dataKey === "providers") return meta.providersVersion;
  return 0;
}

/**
 * Detect conflict between local and remote versions for a given data key.
 *
 * Returns null if no conflict (safe to push/pull).
 * Returns SyncConflict if versions diverge.
 */
export function detectConflict(
  localMeta: SyncMeta | null,
  remoteStatuses: SyncStatusEntry[],
  dataKey: string
): SyncConflict | null {
  const localVersion = getLocalVersion(localMeta, dataKey);

  const remoteEntry = remoteStatuses.find((s) => s.dataKey === dataKey);
  const remoteVersion = remoteEntry?.dataVersion ?? 0;

  // No conflict if versions match
  if (localVersion === remoteVersion) {
    return null;
  }

  // No local data — just need to pull, not a conflict
  if (localVersion === 0) {
    return null;
  }

  // No remote data — safe to push
  if (remoteVersion === 0) {
    return null;
  }

  // Versions diverge — conflict
  return {
    localVersion,
    remoteVersion,
    dataKey,
  };
}
