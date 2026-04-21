import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT } from "../constants/proxy.js";
import { getConfigPath } from "../config/manager.js";
import type { ProxyConfig, ProxyInstanceType, ProxyStatus } from "./types.js";
import { ProxyHandler } from "./handler.js";
import { emitInstanceStart, emitInstanceStop, emitStatusUpdate } from "../server/events.js";

// ---------------------------------------------------------------------------
// In-process server map (only meaningful inside the process that started them)
// ---------------------------------------------------------------------------
const servers = new Map<string, ReturnType<typeof Bun.serve>>();
const statuses = new Map<string, ProxyStatus>();

// ---------------------------------------------------------------------------
// Registry file: proxy-instances.json
// ---------------------------------------------------------------------------

interface InstanceRegistry {
  instances: Record<string, ProxyStatus>;
}

function getRegistryPath(): string {
  return join(dirname(getConfigPath()), "proxy-instances.json");
}

function loadRegistry(): InstanceRegistry {
  const path = getRegistryPath();
  if (!existsSync(path)) {
    return { instances: {} };
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as InstanceRegistry;
  } catch {
    return { instances: {} };
  }
}

function saveRegistry(registry: InstanceRegistry): void {
  writeFileSync(getRegistryPath(), JSON.stringify(registry, null, 2), "utf-8");
}

function updateInstanceInRegistry(status: ProxyStatus): void {
  const registry = loadRegistry();
  registry.instances[status.instanceId] = status;
  saveRegistry(registry);
}

function removeInstanceFromRegistry(instanceId: string): void {
  const registry = loadRegistry();
  delete registry.instances[instanceId];
  saveRegistry(registry);
}

// ---------------------------------------------------------------------------
// PID liveness
// ---------------------------------------------------------------------------

function isProcessAlive(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check all persisted instances, clear stale entries where PID is dead.
 */
function cleanStaleInstances(): void {
  const registry = loadRegistry();
  let changed = false;
  for (const [id, status] of Object.entries(registry.instances)) {
    if (status.running && !isProcessAlive(status.pid)) {
      delete registry.instances[id];
      changed = true;
    }
  }
  if (changed) saveRegistry(registry);
}

// ---------------------------------------------------------------------------
// Migrate legacy proxy-runtime.json → proxy-instances.json (one-time)
// ---------------------------------------------------------------------------

function migrateLegacyRuntime(): void {
  const legacyPath = join(dirname(getConfigPath()), "proxy-runtime.json");
  if (!existsSync(legacyPath)) return;

  const registryPath = getRegistryPath();
  // Only migrate if registry doesn't exist yet
  if (existsSync(registryPath)) return;

  try {
    const legacy = JSON.parse(readFileSync(legacyPath, "utf-8")) as Record<string, unknown>;
    if (legacy && legacy.running) {
      const status: ProxyStatus = {
        ...(legacy as ProxyStatus),
        instanceId: "default",
        type: "service",
      };
      saveRegistry({ instances: { default: status } });
    }
  } catch {
    // Ignore corrupt legacy file
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get status of a single instance (default: "default").
 * Returns a not-running placeholder if not found.
 */
export function getProxyStatus(instanceId?: string): ProxyStatus {
  migrateLegacyRuntime();
  cleanStaleInstances();

  const id = instanceId || "default";
  const registry = loadRegistry();

  // Check in-process map first
  const inProcess = statuses.get(id);
  if (inProcess) return { ...inProcess };

  // Check persisted registry
  const persisted = registry.instances[id];
  if (persisted) return { ...persisted };

  // Not found — return empty status
  return {
    instanceId: id,
    type: "service",
    running: false,
    host: DEFAULT_PROXY_HOST,
    port: DEFAULT_PROXY_PORT,
    requestCount: 0,
    errorCount: 0,
  };
}

/**
 * List all proxy instances (running and stale-cleared).
 */
export function listProxyInstances(): ProxyStatus[] {
  migrateLegacyRuntime();
  cleanStaleInstances();

  // Merge in-process statuses with persisted ones
  const registry = loadRegistry();
  const allStatuses = new Map<string, ProxyStatus>();

  for (const [id, status] of Object.entries(registry.instances)) {
    allStatuses.set(id, status);
  }
  // In-process overrides persisted (more up-to-date counters)
  for (const [id, status] of statuses) {
    allStatuses.set(id, { ...status });
  }

  return Array.from(allStatuses.values());
}

/**
 * Start a proxy server instance.
 */
export async function startProxyServer(config: ProxyConfig): Promise<ProxyStatus> {
  const instanceId = config.instanceId;

  // Already running in this process?
  if (servers.has(instanceId)) {
    return statuses.get(instanceId)!;
  }

  // Check if port is already occupied by another instance
  const existing = listProxyInstances().find(
    (s) => s.running && s.port === config.port && s.instanceId !== instanceId
  );
  if (existing) {
    throw new Error(`Port ${config.port} already in use by instance "${existing.instanceId}"`);
  }

  const handler = new ProxyHandler(config.timeout, config.instanceId, config.groupName);

  const server = Bun.serve({
    hostname: config.host,
    port: config.port,
    fetch(req) {
      const status = statuses.get(instanceId);
      if (status) {
        status.requestCount++;
        emitStatusUpdate({ ...status });
      }
      return handler.handleRequest(req).catch((error) => {
        const s = statuses.get(instanceId);
        if (s) {
          s.errorCount++;
          emitStatusUpdate({ ...s });
        }
        console.error(`Proxy error [${instanceId}]:`, error);
        return new Response("Internal Server Error", { status: 500 });
      });
    },
  });

  const status: ProxyStatus = {
    instanceId,
    type: config.type,
    running: true,
    host: config.host,
    port: config.port,
    groupName: config.groupName,
    activeGroup: config.groupName,
    pid: process.pid,
    startTime: new Date().toISOString(),
    requestCount: 0,
    errorCount: 0,
  };

  servers.set(instanceId, server);
  statuses.set(instanceId, status);
  updateInstanceInRegistry(status);

  emitInstanceStart({ ...status });

  console.log(`Proxy [${instanceId}] listening on ${config.host}:${config.port}`);

  return { ...status };
}

/**
 * Stop a proxy server instance.
 * If no instanceId provided, stops "default".
 */
export async function stopProxyServer(instanceId?: string): Promise<void> {
  const id = instanceId || "default";

  const server = servers.get(id);
  if (server) {
    server.stop();
    servers.delete(id);
    statuses.delete(id);
  }

  removeInstanceFromRegistry(id);
  emitInstanceStop(id);
  console.log(`Proxy [${id}] stopped`);
}
