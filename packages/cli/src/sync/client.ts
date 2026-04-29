/**
 * Sync API client for swixter-cloud
 */

import type {
  SyncStatusResponse,
  PushRequest,
  PushResponse,
  PullResponse,
} from "./types.js";

import { API_BASE } from "../constants/api.js";

class SyncError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "SyncError";
  }
}

async function syncRequest<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
    };
    throw new SyncError(
      response.status,
      error.code || "UNKNOWN",
      error.message || `HTTP ${response.status}`
    );
  }

  return response.json() as Promise<T>;
}

/**
 * Get sync status (versions and timestamps for all data keys)
 */
export async function getSyncStatus(
  accessToken: string
): Promise<SyncStatusResponse> {
  return syncRequest<SyncStatusResponse>("/api/sync/status", accessToken);
}

/**
 * Push encrypted data to cloud
 */
export async function pushData(
  accessToken: string,
  data: PushRequest
): Promise<PushResponse> {
  return syncRequest<PushResponse>("/api/sync/push", accessToken, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Pull encrypted data from cloud
 */
export async function pullData(
  accessToken: string,
  dataKey: string
): Promise<PullResponse> {
  return syncRequest<PullResponse>(
    `/api/sync/pull?dataKey=${encodeURIComponent(dataKey)}`,
    accessToken
  );
}

/**
 * Delete synced data from cloud
 */
export async function deleteSyncData(
  accessToken: string,
  dataKey?: string
): Promise<void> {
  const path = dataKey
    ? `/api/sync/data?dataKey=${encodeURIComponent(dataKey)}`
    : "/api/sync/data";
  await syncRequest<{ success: boolean }>(path, accessToken, {
    method: "DELETE",
  });
}

export { SyncError };
