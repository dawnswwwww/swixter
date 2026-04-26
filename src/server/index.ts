/**
 * Web UI Server
 * Local HTTP server for Swixter Web UI
 */

import http from "node:http";
import { existsSync } from "node:fs";
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
 * Get UI directory path.
 *
 * Resolves the location of the built Web UI assets across both runtime modes:
 * - Bundled CLI (`dist/cli/index.js`): UI lives at `dist/ui` (sibling to `dist/cli`).
 * - Source/dev mode (`src/server/index.ts` via `bun src/cli/index.ts`):
 *   UI is built to `ui/dist` at the repo root.
 *
 * NODE_ENV is intentionally NOT used here — Bun's bundler can statically
 * substitute `process.env.NODE_ENV` at build time, which previously caused
 * `isDev` to be hardcoded to `true` and broke the path in published packages.
 */
export function getUiDir(): string {
  // Bundled CLI: __dirname = <pkg>/dist/cli, UI is at <pkg>/dist/ui
  const bundledUiDir = join(__dirname, "..", "ui");
  if (existsSync(join(bundledUiDir, "index.html"))) {
    return bundledUiDir;
  }

  // Dev/source: __dirname = <repo>/src/server, UI is at <repo>/ui/dist
  return join(__dirname, "..", "..", "ui", "dist");
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
