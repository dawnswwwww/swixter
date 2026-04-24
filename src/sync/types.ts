/**
 * Sync module types
 */

/** Sync metadata stored in config.json */
export interface SyncMeta {
  lastSyncAt: string;
  configVersion: number;
  providersVersion: number;
  localUpdatedAt: string;
}

/** Sync status from remote server */
export interface SyncStatusEntry {
  dataKey: string;
  dataVersion: number;
  updatedAt: string;
}

/** API response for GET /api/sync/status */
export interface SyncStatusResponse {
  statuses: SyncStatusEntry[];
}

/** API request for POST /api/sync/push */
export interface PushRequest {
  dataKey: string;
  encryptedData: string;
  dataVersion: number;
  clientTimestamp: string;
}

/** API response for POST /api/sync/push */
export interface PushResponse {
  success: boolean;
  dataVersion: number;
  updatedAt: string;
}

/** API response for GET /api/sync/pull */
export interface PullResponse {
  dataKey: string;
  encryptedData: string;
  dataVersion: number;
  clientTimestamp: string;
  updatedAt: string;
}

/** Encrypted config data ready for sync */
export interface EncryptedSyncPayload {
  profiles: Record<string, unknown>;
  providers?: Record<string, unknown>;
}

/** Sync conflict info */
export interface SyncConflict {
  localVersion: number;
  remoteVersion: number;
  dataKey: string;
}
