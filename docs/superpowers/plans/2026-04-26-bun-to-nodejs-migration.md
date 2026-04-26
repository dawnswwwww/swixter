# Bun to Node.js API Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all Bun-specific APIs (`Bun.serve`, `Bun.file`, `ServerWebSocket`) with Node.js standard library equivalents so `swixter ui` and `swixter proxy` work in pure Node.js environments.

**Architecture:** Use `node:http.createServer()` for both Web UI and proxy servers. Use `ws` library for WebSocket support. Delete `bun-http-bridge.ts` since Node.js server directly produces `IncomingMessage`/`ServerResponse`. Proxy server needs a thin adapter at the entry point to convert Node.js req to Web API `Request` before passing to `ProxyHandler`.

**Tech Stack:** Node.js 18+, `ws` (^8.18.0), `bun build --target node`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `package.json` | Modify | Add `ws` dependency; change build target from `--target bun --standalone` to `--target node` |
| `src/server/bun-static.ts` | Modify | Replace `Bun.file()` with `node:fs.readFile()`; change signature to accept/respond via `ServerResponse` |
| `src/server/ws-manager.ts` | Modify | Replace Bun `ServerWebSocket` type with `ws` `WebSocket` type |
| `src/server/index.ts` | Modify | Replace `Bun.serve()` with `http.createServer()`; integrate `ws` WebSocketServer; delete `bun-http-bridge` usage |
| `src/proxy/server.ts` | Modify | Replace `Bun.serve()` with `http.createServer()`; add Node.js req → Web API Request conversion; write Response back to `ServerResponse` |
| `src/server/bun-http-bridge.ts` | **Delete** | No longer needed — Node.js server gives `IncomingMessage`/`ServerResponse` directly |

---

### Task 1: Install ws dependency and update package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install ws package**

Run: `bun add ws`

Expected: `ws` added to `dependencies` in `package.json`

- [ ] **Step 2: Add @types/ws dev dependency**

Run: `bun add -d @types/ws`

Expected: `@types/ws` added to `devDependencies`

- [ ] **Step 3: Update build scripts to use `--target node`**

Modify `package.json` scripts section:

```json
"scripts": {
  "build": "bun run build:ui && bun build src/cli/index.ts --outdir dist/cli --target node",
  "build:cli": "bun build src/cli/index.ts --outdir dist/cli --target node",
```

Replace both occurrences of `--target bun --standalone` with `--target node`.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
# or: git add package.json package-lock.json if lockfile name differs
git commit -m "chore: add ws dependency and switch build target to node"
```

---

### Task 2: Rewrite static file serving for Node.js

**Files:**
- Modify: `src/server/bun-static.ts`

- [ ] **Step 1: Replace Bun.file with node:fs readFile**

Replace the entire content of `src/server/bun-static.ts` with:

```typescript
/**
 * Static File Server
 * Serves static files using node:fs for Node.js compatibility.
 */

import { extname, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".avif": "image/avif",
};

export interface StaticOptions {
  root: string;
  index?: string;
  spa?: boolean;
}

/**
 * Serve a static file request, writing directly to the ServerResponse.
 */
export async function serveStaticFile(
  _req: IncomingMessage,
  res: ServerResponse,
  options: StaticOptions,
): Promise<void> {
  const { root, index = "index.html", spa = true } = options;
  const url = new URL(_req.url || "/", `http://${_req.headers.host || "localhost"}`);
  let filePath = join(root, url.pathname);

  try {
    const stats = await stat(filePath);

    if (stats.isDirectory()) {
      filePath = join(filePath, index);
    }

    const content = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";

    res.setHeader("Content-Type", contentType);
    res.statusCode = 200;
    res.end(content);
  } catch {
    if (spa) {
      const indexPath = join(root, index);
      try {
        const content = await readFile(indexPath);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.statusCode = 200;
        res.end(content);
      } catch {
        res.statusCode = 404;
        res.end("Not Found");
      }
    } else {
      res.statusCode = 404;
      res.end("Not Found");
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/bun-static.ts
git commit -m "refactor(server): replace Bun.file with node:fs for static serving"
```

---

### Task 3: Rewrite WebSocket manager for ws library

**Files:**
- Modify: `src/server/ws-manager.ts`

- [ ] **Step 1: Replace Bun ServerWebSocket with ws WebSocket**

Replace the entire content of `src/server/ws-manager.ts` with:

```typescript
import type WebSocket from "ws";
import { subscribe, type ProxyEvent } from "./events.js";
import { listProxyInstances } from "../proxy/server.js";
import { getActiveGroup } from "../groups/manager.js";

export interface SnapshotPayload {
  type: "snapshot";
  instances: ReturnType<typeof listProxyInstances>;
  activeGroupId?: string;
  activeGroupName?: string;
}

export class WsManager {
  private clients = new Set<WebSocket>();
  private unsubscribe: (() => void) | null = null;

  start(): void {
    this.unsubscribe = subscribe((event: ProxyEvent) => {
      this.broadcast(event);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Already closed.
      }
    }
    this.clients.clear();
  }

  async addClient(ws: WebSocket): Promise<void> {
    this.clients.add(ws);
    await this.sendSnapshot(ws);
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const instances = listProxyInstances();

    let activeGroupId: string | undefined;
    let activeGroupName: string | undefined;
    try {
      const active = await getActiveGroup();
      if (active) {
        activeGroupId = active.id;
        activeGroupName = active.name;
      }
    } catch {
      // Active group may not be available yet.
    }

    const snapshot: SnapshotPayload = {
      type: "snapshot",
      instances,
      activeGroupId,
      activeGroupName,
    };

    this.sendTo(ws, snapshot);
  }

  private broadcast(event: ProxyEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        client.send(data);
      } catch {
        // Send failed; remove stale client.
        this.clients.delete(client);
      }
    }
  }

  private sendTo(ws: WebSocket, payload: SnapshotPayload): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Client already gone.
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/ws-manager.ts
git commit -m "refactor(server): replace Bun WebSocket with ws library"
```

---

### Task 4: Rewrite Web UI server with http.createServer

**Files:**
- Modify: `src/server/index.ts`
- Delete: `src/server/bun-http-bridge.ts` (will be handled in Task 6)

- [ ] **Step 1: Replace Bun.serve with http.createServer and ws**

Replace the entire content of `src/server/index.ts` with:

```typescript
/**
 * Web UI Server
 * Local HTTP server for Swixter Web UI
 */

import http from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import pc from "picocolors";
import { Router } from "./router.js";
import { corsMiddleware, jsonBodyMiddleware, notFoundHandler } from "./middleware.js";
import { serveStaticFile } from "./bun-static.js";
import { WsManager } from "./ws-manager.js";
import * as profilesApi from "./api/profiles.js";
import * as providersApi from "./api/providers.js";
import * as codersApi from "./api/coders.js";
import * as configApi from "./api/config.js";
import * as groupsApi from "./api/groups.js";
import * as proxyStatusApi from "./api/proxy-status.js";
import * as proxyLogsApi from "./api/proxy-logs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Server handle returned by startServer().
 * Provides close() for graceful shutdown, compatible with Node Server API.
 */
export interface WebUiServerHandle {
  host: string;
  port: number;
  close(callback?: () => void): void;
}

/**
 * Find an available port starting from the given port
 */
export async function findAvailablePort(startPort = 3141): Promise<number> {
  const net = await import("node:net");

  return new Promise((resolve) => {
    const server = net.createServer();

    server.listen(startPort, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      server.close(() => resolve(port));
    });

    server.on("error", () => {
      // Port is in use, try next port
      server.close();
      resolve(findAvailablePort(startPort + 1));
    });
  });
}

/**
 * Open browser URL based on platform
 */
export function openBrowser(url: string): void {
  const command = process.platform === "win32"
    ? "start"
    : process.platform === "darwin"
    ? "open"
    : "xdg-open";

  // Use array form of execFile to avoid shell injection
  import("node:child_process").then(({ execFile }) => {
    execFile(command, [url], (error) => {
      if (error) {
        console.warn(pc.yellow(`Could not open browser automatically: ${error.message}`));
      }
    });
  });
}

/**
 * Get UI directory path
 */
export function getUiDir(): string {
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    return join(__dirname, "..", "..", "ui", "dist");
  }

  return join(__dirname, "..", "..", "ui");
}

/**
 * Start the Web UI server using Node.js http.createServer with WebSocket support.
 */
export async function startServer(portArg?: number): Promise<WebUiServerHandle> {
  const port = portArg || await findAvailablePort(3141);
  const host = "127.0.0.1";

  // Create router
  const router = new Router();

  // Add middleware
  router.use(corsMiddleware);
  router.use(jsonBodyMiddleware);

  // Profile routes
  router.get("/api/profiles", profilesApi.listProfiles);
  router.get("/api/profiles/:name", profilesApi.getProfile);
  router.post("/api/profiles", profilesApi.createProfile);
  router.put("/api/profiles/:name", profilesApi.updateProfile);
  router.delete("/api/profiles/:name", profilesApi.deleteProfile);

  // Provider routes
  router.get("/api/providers", providersApi.listProviders);
  router.post("/api/providers", providersApi.createProvider);
  router.put("/api/providers/:id", providersApi.updateProvider);
  router.delete("/api/providers/:id", providersApi.deleteProvider);

  // Coder routes
  router.get("/api/coders", codersApi.listCoders);
  router.get("/api/coders/:coder/active", codersApi.getActiveProfile);
  router.put("/api/coders/:coder/active", codersApi.setActiveProfile);
  router.post("/api/coders/:coder/apply", codersApi.applyProfile);
  router.get("/api/coders/:coder/verify", codersApi.verifyConfig);

  // Config routes
  router.get("/api/version", configApi.getVersion);
  router.get("/api/config", configApi.getConfigMeta);
  router.get("/api/config/export", configApi.exportConfigFile);
  router.post("/api/config/import", configApi.importConfigFile);
  router.post("/api/config/reset", configApi.resetConfig);

  // Group routes
  router.get("/api/groups", groupsApi.handleListGroups);
  router.get("/api/groups/:id", groupsApi.handleGetGroup);
  router.post("/api/groups", groupsApi.handleCreateGroup);
  router.put("/api/groups/:id", groupsApi.handleUpdateGroup);
  router.delete("/api/groups/:id", groupsApi.handleDeleteGroup);
  router.put("/api/groups/:id/active", groupsApi.handleSetActiveGroup);

  // Proxy routes
  router.get("/api/proxy/status", proxyStatusApi.handleGetProxyStatus);
  router.get("/api/proxy/instances", proxyStatusApi.handleListInstances);
  router.post("/api/proxy/start", proxyStatusApi.handleStartProxy);
  router.post("/api/proxy/stop", proxyStatusApi.handleStopProxy);
  router.get("/api/proxy/logs", proxyLogsApi.handleGetProxyLogs);

  // Static file serving options
  const uiDir = getUiDir();
  const staticOptions = { root: uiDir, index: "index.html", spa: true };

  // WebSocket manager
  const wsManager = new WsManager();
  wsManager.start();

  // Create HTTP server
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // API routes
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      router.handle(req, res);
      return;
    }

    // Static files / SPA
    serveStaticFile(req, res, staticOptions).catch(() => {
      res.statusCode = 500;
      res.end("Internal Server Error");
    });
  });

  // WebSocket server attached to HTTP server
  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (ws) => {
    wsManager.addClient(ws);
    ws.on("close", () => wsManager.removeClient(ws));
  });

  // Start listening
  await new Promise<void>((resolve) => {
    server.listen(port, host, () => {
      resolve();
    });
  });

  const url = `http://${host}:${port}`;
  console.log();
  console.log(pc.bold(pc.cyan("Swixter Web UI")));
  console.log();
  console.log(`  Server: ${pc.cyan(url)}`);
  console.log(`  Press ${pc.bold("Ctrl+C")} to stop`);
  console.log();

  // Auto-open browser
  openBrowser(url);

  // Return handle with close() compatible with Node Server API
  const handle: WebUiServerHandle = {
    host,
    port,
    close(callback?: () => void) {
      wsManager.stop();
      wss.close();
      server.close(() => {
        console.log();
        console.log(pc.dim("Server closed"));
        callback?.();
      });
    },
  };

  return handle;
}

/**
 * Stop the server gracefully
 */
export function stopServer(server: WebUiServerHandle): void {
  server.close();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/index.ts
git commit -m "refactor(server): replace Bun.serve with http.createServer and ws"
```

---

### Task 5: Rewrite proxy server with http.createServer

**Files:**
- Modify: `src/proxy/server.ts`

- [ ] **Step 1: Replace Bun.serve with http.createServer**

Replace the entire content of `src/proxy/server.ts` with:

```typescript
import http from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT } from "../constants/proxy.js";
import { getConfigPath } from "../config/manager.js";
import type { ProxyConfig, ProxyInstanceType, ProxyStatus } from "./types.js";
import { ProxyHandler } from "./handler.js";
import { emitInstanceStart, emitInstanceStop, emitStatusUpdate } from "../server/events.js";

// ---------------------------------------------------------------------------
// In-process server map
// ---------------------------------------------------------------------------
const servers = new Map<string, http.Server>();
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
// Helpers: Convert Node.js req to Web API Request
// ---------------------------------------------------------------------------

async function nodeReqToWebRequest(req: http.IncomingMessage): Promise<Request> {
  const url = `http://${req.headers.host}${req.url}`;

  // Collect body
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  // Build headers
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v);
      }
    } else {
      headers.set(key, value);
    }
  }

  return new Request(url, {
    method: req.method,
    headers,
    body: body.length > 0 ? body : undefined,
  });
}

async function writeWebResponseToNodeRes(response: Response, res: http.ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (response.body) {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }

  res.end();
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

  const server = http.createServer(async (req, res) => {
    const status = statuses.get(instanceId);
    if (status) {
      status.requestCount++;
      emitStatusUpdate({ ...status });
    }

    try {
      const request = await nodeReqToWebRequest(req);
      const response = await handler.handleRequest(request);
      await writeWebResponseToNodeRes(response, res);
    } catch (error) {
      const s = statuses.get(instanceId);
      if (s) {
        s.errorCount++;
        emitStatusUpdate({ ...s });
      }
      console.error(`Proxy error [${instanceId}]:`, error);
      res.statusCode = 500;
      res.end("Internal Server Error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.host, () => {
      resolve();
    });
    server.on("error", reject);
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
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    servers.delete(id);
    statuses.delete(id);
  }

  removeInstanceFromRegistry(id);
  emitInstanceStop(id);
  console.log(`Proxy [${id}] stopped`);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/proxy/server.ts
git commit -m "refactor(proxy): replace Bun.serve with http.createServer"
```

---

### Task 6: Delete bun-http-bridge.ts

**Files:**
- Delete: `src/server/bun-http-bridge.ts`

- [ ] **Step 1: Verify no other files import bun-http-bridge**

Run: `grep -r "bun-http-bridge" src/`

Expected: Only matches in `src/server/bun-http-bridge.ts` itself (since `src/server/index.ts` was already rewritten without the import).

- [ ] **Step 2: Delete the file**

```bash
rm src/server/bun-http-bridge.ts
git add src/server/bun-http-bridge.ts
git commit -m "refactor(server): remove bun-http-bridge (no longer needed)"
```

---

### Task 7: Build and test verification

**Files:**
- Verify: all modified files compile correctly

- [ ] **Step 1: Run TypeScript/build check**

Run: `bun run build`

Expected: Build succeeds without errors. No `Bun is not defined` or Bun-related type errors.

- [ ] **Step 2: Run unit tests**

Run: `bun test`

Expected: All existing tests pass. No new test failures introduced.

- [ ] **Step 3: Test swixter ui in Node.js**

Run: `node dist/cli/index.js ui --port 3142`

Expected: Server starts successfully on `http://127.0.0.1:3142`. No `ReferenceError: Bun is not defined`. Browser opens. WebSocket connects. API endpoints respond.

- [ ] **Step 4: Test swixter proxy in Node.js**

Run (in another terminal): `node dist/cli/index.js proxy start`

Expected: Proxy starts successfully. No `ReferenceError: Bun is not defined`. Can make HTTP requests through the proxy.

- [ ] **Step 5: Final commit**

```bash
git add -A  # if any remaining changes
git commit -m "chore: verify build and tests pass after Bun-to-Node migration"
```

---

## Self-Review

### Spec Coverage Check

| Spec Section | Plan Task | Status |
|-------------|-----------|--------|
| `Bun.serve()` → `http.createServer()` (Web UI) | Task 4 | ✅ |
| `Bun.serve()` → `http.createServer()` (Proxy) | Task 5 | ✅ |
| `Bun.file()` → `node:fs.readFile()` | Task 2 | ✅ |
| `ServerWebSocket` → `ws.WebSocket` | Task 3 | ✅ |
| Delete `bun-http-bridge.ts` | Task 6 | ✅ |
| Add `ws` dependency | Task 1 | ✅ |
| Build target `--target node` | Task 1 | ✅ |
| Proxy req/res conversion | Task 5 helpers | ✅ |

### Placeholder Scan

- No "TBD", "TODO", "implement later", "fill in details" found.
- No vague steps like "add appropriate error handling" without code.
- Every code change step includes the actual replacement code.

### Type Consistency Check

- `WsManager.clients` uses `WebSocket` (from `ws`) consistently across Task 3.
- `serveStaticFile` signature uses `IncomingMessage`/`ServerResponse` consistently in Task 2 and Task 4.
- `servers` Map type changed from `ReturnType<typeof Bun.serve>` to `http.Server` consistently in Task 5.
- `stopProxyServer` return type changed from `void` to `Promise<void>` consistently (matches new async server close).

No inconsistencies found.
