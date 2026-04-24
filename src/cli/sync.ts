/**
 * Sync CLI commands
 * swixter sync push | pull | status | enable | disable
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { getAccessToken, loadAuthState } from "../auth/token.js";
import { getSyncStatus, pullData, pushData } from "../sync/client.js";
import { SyncError } from "../sync/client.js";
import { detectConflict } from "../sync/merge.js";
import { loadConfig, saveConfig } from "../config/manager.js";
import type { ClaudeCodeProfile } from "../types.js";
import { loadUserProviders, saveUserProviders } from "../providers/user-providers.js";
import type { ProviderPreset } from "../types.js";
import { deriveKey, importKeyFromBase64 } from "../crypto/derive.js";
import {
  encryptSensitiveFields,
  decryptSensitiveFields,
} from "../crypto/fields.js";
import { setAutoSyncEnabled } from "../sync/auto-sync.js";

/**
 * Ensure user is logged in, return access token or exit
 */
async function requireAuth(): Promise<string> {
  const token = await getAccessToken();
  if (!token) {
    console.log(pc.yellow("Not logged in."));
    console.log(pc.dim("Run 'swixter auth login' first"));
    process.exit(1);
  }
  return token;
}

/**
 * Get encryption key from stored key or master password
 */
async function getEncryptionKey(): Promise<CryptoKey> {
  const state = await loadAuthState();
  if (!state) throw new Error("Not authenticated");

  // If encryption key is stored, import it directly
  if (state.encryptionKey) {
    return importKeyFromBase64(state.encryptionKey);
  }

  // Otherwise prompt for master password
  const masterPassword = await p.password({
    message: "Master password:",
    validate: (v) => {
      if (!v) return "Master password is required for encryption";
    },
  });
  if (p.isCancel(masterPassword)) {
    process.exit(0);
  }

  // Use the server's salt from auth state
  return deriveKey(masterPassword as string, state.encryptionSalt);
}

/**
 * swixter sync status
 */
async function cmdStatus(): Promise<void> {
  const token = await requireAuth();

  const s = p.spinner();
  s.start("Checking sync status...");

  try {
    const remote = await getSyncStatus(token);
    const config = await loadConfig();
    const syncMeta = config.syncMeta;

    s.stop("Sync status:");

    console.log();
    console.log(pc.bold("  Remote:"));
    if (remote.statuses.length === 0) {
      console.log(pc.dim("    No data synced"));
    } else {
      for (const entry of remote.statuses) {
        console.log(
          `    ${pc.cyan(entry.dataKey)}: v${entry.dataVersion} (${pc.dim(entry.updatedAt)})`
        );
      }
    }

    console.log();
    console.log(pc.bold("  Local:"));
    if (syncMeta) {
      console.log(
        `    config: v${syncMeta.configVersion} (${pc.dim(syncMeta.localUpdatedAt)})`
      );
      console.log(
        `    providers: v${syncMeta.providersVersion} (${pc.dim(syncMeta.lastSyncAt)})`
      );
    } else {
      console.log(pc.dim("    Never synced"));
    }
    console.log();
  } catch (err: any) {
    s.stop(pc.red("Failed to get sync status"));
    console.error(pc.red(err.message || "Unknown error"));
    process.exit(1);
  }
}

/**
 * swixter sync push
 */
async function cmdPush(forceLocal = false): Promise<void> {
  const token = await requireAuth();

  const s = p.spinner();
  s.start("Pushing config to cloud...");

  try {
    const remote = await getSyncStatus(token);
    const config = await loadConfig();
    const syncMeta = config.syncMeta;

    // Check for conflicts
    if (!forceLocal) {
      const configConflict = detectConflict(
        syncMeta ?? null,
        remote.statuses,
        "config"
      );
      if (configConflict) {
        s.stop(pc.yellow("Version conflict detected!"));
        console.log(
          `  Local version: ${configConflict.localVersion}, Remote version: ${configConflict.remoteVersion}`
        );
        console.log(
          pc.dim("  Use --force-local to overwrite remote, or pull first")
        );
        process.exit(1);
      }
    }

    // Get encryption key (stop spinner for prompt)
    s.stop(pc.dim("Requesting master password..."));
    const key = await getEncryptionKey();
    s.start("Encrypting and pushing...");

    // Encrypt profiles
    const encryptedProfiles: Record<string, unknown> = {};
    for (const [id, profile] of Object.entries(config.profiles)) {
      encryptedProfiles[id] = await encryptSensitiveFields(key, profile);
    }

    // Determine version for push
    const configRemoteEntry = remote.statuses.find(
      (s) => s.dataKey === "config"
    );
    const configVersion = configRemoteEntry?.dataVersion ?? 0;

    // Push config
    const pushResult = await pushData(token, {
      dataKey: "config",
      encryptedData: JSON.stringify(encryptedProfiles),
      dataVersion: configVersion,
      clientTimestamp: new Date().toISOString(),
    });

    // Push providers
    const providers = await loadUserProviders();
    const providersRemoteEntry = remote.statuses.find(
      (s) => s.dataKey === "providers"
    );
    const providersVersion = providersRemoteEntry?.dataVersion ?? 0;

    const providersPushResult = await pushData(token, {
      dataKey: "providers",
      encryptedData: JSON.stringify(await encryptSensitiveFields(key, { providers })),
      dataVersion: providersVersion,
      clientTimestamp: new Date().toISOString(),
    });

    // Update local syncMeta
    const now = new Date().toISOString();
    const updatedMeta = {
      lastSyncAt: now,
      configVersion: pushResult.dataVersion,
      providersVersion: providersPushResult.dataVersion,
      localUpdatedAt: now,
    };
    config.syncMeta = updatedMeta;
    await saveConfig(config);

    s.stop(pc.green(`Pushed config (v${pushResult.dataVersion}), providers (v${providersPushResult.dataVersion})`));
  } catch (err: any) {
    s.stop(pc.red("Push failed"));
    if (err instanceof SyncError && err.status === 409) {
      console.log(pc.yellow("  Version conflict. Use --force-local to overwrite."));
    } else {
      console.error(pc.red(err.message || "Unknown error"));
    }
    process.exit(1);
  }
}

/**
 * swixter sync pull
 */
async function cmdPull(forceRemote = false): Promise<void> {
  const token = await requireAuth();

  const s = p.spinner();
  s.start("Pulling config from cloud...");

  try {
    const pullResult = await pullData(token, "config");
    const config = await loadConfig();
    const syncMeta = config.syncMeta;

    // Check for conflicts if not forcing
    if (!forceRemote && syncMeta) {
      const configConflict = detectConflict(
        syncMeta,
        [{ dataKey: "config", dataVersion: pullResult.dataVersion, updatedAt: pullResult.updatedAt }],
        "config"
      );
      if (configConflict) {
        s.stop(pc.yellow("Version conflict detected!"));
        console.log(
          `  Local version: ${configConflict.localVersion}, Remote version: ${configConflict.remoteVersion}`
        );
        console.log(
          pc.dim("  Use --force-remote to overwrite local, or push first")
        );
        process.exit(1);
      }
    }

    // Get encryption key (stop spinner for prompt)
    s.stop(pc.dim("Requesting master password..."));
    const key = await getEncryptionKey();
    s.start("Decrypting...");

    const encryptedProfiles = JSON.parse(pullResult.encryptedData) as Record<
      string,
      unknown
    >;

    // Decrypt profiles
    for (const [id, profile] of Object.entries(encryptedProfiles)) {
      config.profiles[id] = (await decryptSensitiveFields(
        key,
        profile as Record<string, unknown>
      )) as ClaudeCodeProfile;
    }

    // Pull providers if they exist remotely
    let providersVersion = syncMeta?.providersVersion ?? 0;
    try {
      const providersResult = await pullData(token, "providers");
      const providersEncrypted = JSON.parse(providersResult.encryptedData) as Record<string, unknown>;
      const providersDecrypted = await decryptSensitiveFields(key, providersEncrypted);
      if (providersDecrypted.providers && Array.isArray(providersDecrypted.providers)) {
        await saveUserProviders(providersDecrypted.providers as ProviderPreset[]);
        providersVersion = providersResult.dataVersion;
      }
    } catch (err: any) {
      if (err instanceof SyncError && err.status === 404) {
        // No remote providers — that's fine
      } else {
        throw err;
      }
    }

    // Update syncMeta
    const now = new Date().toISOString();
    config.syncMeta = {
      lastSyncAt: now,
      configVersion: pullResult.dataVersion,
      providersVersion,
      localUpdatedAt: now,
    };
    await saveConfig(config);

    s.stop(pc.green(`Pulled config (v${pullResult.dataVersion}), providers (v${providersVersion})`));
  } catch (err: any) {
    s.stop(pc.red("Pull failed"));
    if (err instanceof SyncError && err.status === 404) {
      console.log(pc.dim("No remote data found. Push first with 'swixter sync push'"));
    } else {
      console.error(pc.red(err.message || "Unknown error"));
    }
    process.exit(1);
  }
}

/**
 * Main sync command handler
 */
export async function handleSyncCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "push": {
      const forceLocal = args.includes("--force-local");
      await cmdPush(forceLocal);
      break;
    }
    case "pull": {
      const forceRemote = args.includes("--force-remote");
      await cmdPull(forceRemote);
      break;
    }
    case "status":
      await cmdStatus();
      break;
    case "enable":
      setAutoSyncEnabled(true);
      console.log(pc.green("✓ Auto sync enabled"));
      break;
    case "disable":
      setAutoSyncEnabled(false);
      console.log(pc.green("✓ Auto sync disabled"));
      break;
    default:
      console.log(pc.red(`Unknown sync subcommand: ${subcommand}`));
      console.log();
      console.log(pc.bold("Available subcommands:"));
      console.log(`  ${pc.cyan("push")}   [--force-local]  - Push config to cloud`);
      console.log(`  ${pc.cyan("pull")}   [--force-remote]  - Pull config from cloud`);
      console.log(`  ${pc.cyan("status")}                   - Show sync state`);
      console.log(`  ${pc.cyan("enable")}                   - Enable auto sync`);
      console.log(`  ${pc.cyan("disable")}                  - Disable auto sync`);
      console.log();
      process.exit(1);
  }
}
