/**
 * Auto-sync module for swixter
 *
 * Provides sync wrappers that the CLI layer can call explicitly.
 * loadConfig/saveConfig are pure file operations — sync is orchestrated
 * at the CLI level, not baked into the config manager.
 */

import { getAccessToken, loadAuthState } from "../auth/token.js";
import { pushData, pullData, getSyncStatus } from "./client.js";
import { loadConfig, saveConfig } from "../config/manager.js";
import { loadUserProviders, saveUserProviders } from "../providers/user-providers.js";
import { encryptSensitiveFields, decryptSensitiveFields } from "../crypto/fields.js";
import { importKeyFromBase64 } from "../crypto/derive.js";
import type { ClaudeCodeProfile, ProviderPreset } from "../types.js";

let autoSyncEnabled = false;
let isSyncing = false;

export function isAutoSyncEnabled(): boolean {
  return autoSyncEnabled;
}

export function setAutoSyncEnabled(enabled: boolean): void {
  autoSyncEnabled = enabled;
}

/**
 * Push current config and providers to cloud.
 */
export async function syncPush(): Promise<void> {
  if (isSyncing) return;
  if (!autoSyncEnabled) return;
  isSyncing = true;

  try {
    const token = await getAccessToken();
    if (!token) return;

    const state = await loadAuthState();
    if (!state) return;

    // For auto-sync, we need the stored key (can't prompt interactively)
    if (!state.encryptionKey) return;

    const key = await importKeyFromBase64(state.encryptionKey);

    const config = await loadConfig();
    const syncMeta = config.syncMeta;

    // Get remote status
    const remote = await getSyncStatus(token);

    // Push config
    const configRemoteEntry = remote.statuses.find((s) => s.dataKey === "config");
    const configVersion = configRemoteEntry?.dataVersion ?? 0;

    // Only push if local has changes (dirty flag or version mismatch)
    if (syncMeta?.dirty || !syncMeta || syncMeta.configVersion !== configVersion) {
      const encryptedProfiles: Record<string, unknown> = {};
      for (const [id, profile] of Object.entries(config.profiles)) {
        encryptedProfiles[id] = await encryptSensitiveFields(key, profile);
      }

      const result = await pushData(token, {
        dataKey: "config",
        encryptedData: JSON.stringify(encryptedProfiles),
        dataVersion: configVersion,
        clientTimestamp: new Date().toISOString(),
      });

      config.syncMeta = {
        lastSyncAt: new Date().toISOString(),
        configVersion: result.dataVersion,
        providersVersion: syncMeta?.providersVersion ?? 0,
        localUpdatedAt: new Date().toISOString(),
        dirty: false,
      };
      await saveConfig(config);
    }

    // Push providers
    const providers = await loadUserProviders();
    const providersRemoteEntry = remote.statuses.find((s) => s.dataKey === "providers");
    const providersVersion = providersRemoteEntry?.dataVersion ?? 0;

    if (providers && providers.length > 0) {
      if (syncMeta?.dirty || !syncMeta || syncMeta.providersVersion !== providersVersion) {
        const encryptedProviders = await encryptSensitiveFields(key, { providers });
        const result = await pushData(token, {
          dataKey: "providers",
          encryptedData: JSON.stringify(encryptedProviders),
          dataVersion: providersVersion,
          clientTimestamp: new Date().toISOString(),
        });

        config.syncMeta = {
          ...(config.syncMeta ?? {
            lastSyncAt: new Date().toISOString(),
            configVersion: 0,
            providersVersion: 0,
            localUpdatedAt: new Date().toISOString(),
          }),
          providersVersion: result.dataVersion,
        };
        await saveConfig(config);
      }
    }
  } finally {
    isSyncing = false;
  }
}

/**
 * Pull remote config and providers.
 */
export async function syncPull(): Promise<void> {
  if (isSyncing) return;
  if (!autoSyncEnabled) return;
  isSyncing = true;

  try {
    const token = await getAccessToken();
    if (!token) return;

    const state = await loadAuthState();
    if (!state?.encryptionKey) return;

    const key = await importKeyFromBase64(state.encryptionKey);

    const config = await loadConfig();
    const syncMeta = config.syncMeta;

    // Pull config — merge remote profiles into local
    try {
      const pullResult = await pullData(token, "config");
      if (!syncMeta || syncMeta.configVersion !== pullResult.dataVersion) {
        const encryptedProfiles = JSON.parse(pullResult.encryptedData) as Record<string, unknown>;
        const remoteProfiles: Record<string, ClaudeCodeProfile> = {};
        for (const [id, profile] of Object.entries(encryptedProfiles)) {
          remoteProfiles[id] = await decryptSensitiveFields(key, profile as Record<string, unknown>) as ClaudeCodeProfile;
        }

        // Merge: remote profiles overwrite local, local-only profiles are kept
        for (const [id, remoteProfile] of Object.entries(remoteProfiles)) {
          config.profiles[id] = remoteProfile;
        }
        // Local-only profiles (not in remote) are preserved automatically

        config.syncMeta = {
          lastSyncAt: new Date().toISOString(),
          configVersion: pullResult.dataVersion,
          providersVersion: syncMeta?.providersVersion ?? 0,
          localUpdatedAt: new Date().toISOString(),
        };
        await saveConfig(config);
      }
    } catch (err: any) {
      // 404 means no remote data yet, ignore
      if (err.status !== 404) throw err;
    }

    // Pull providers
    try {
      const pullResult = await pullData(token, "providers");
      if (!syncMeta || syncMeta.providersVersion !== pullResult.dataVersion) {
        const encryptedProviders = JSON.parse(pullResult.encryptedData) as Record<string, unknown>;
        const decrypted = await decryptSensitiveFields(key, encryptedProviders);
        const providersList = Array.isArray(decrypted.providers)
          ? (decrypted.providers as ProviderPreset[])
          : [];
        if (providersList.length > 0) {
          await saveUserProviders(providersList);
        }
        const now = new Date().toISOString();
        config.syncMeta = {
          ...(config.syncMeta ?? {
            lastSyncAt: now,
            configVersion: 0,
            providersVersion: 0,
            localUpdatedAt: now,
          }),
          providersVersion: pullResult.dataVersion,
        };
        await saveConfig(config);
      }
    } catch (err: any) {
      if (err.status !== 404) throw err;
    }
  } finally {
    isSyncing = false;
  }
}

/**
 * Load config with auto-sync pull (if enabled).
 * Call this from the CLI layer instead of raw loadConfig.
 */
export async function loadConfigWithSync(): Promise<import("../types.js").ConfigFile> {
  try {
    await syncPull();
  } catch {
    // Ignore auto-sync errors, don't block config loading
  }
  return loadConfig();
}

/**
 * Save config with auto-sync push (if enabled).
 * Call this from the CLI layer instead of raw saveConfig.
 */
export async function saveConfigWithSync(config: import("../types.js").ConfigFile): Promise<void> {
  await saveConfig(config);
  try {
    await syncPush();
  } catch {
    // Ignore auto-sync errors, don't block config saving
  }
}
