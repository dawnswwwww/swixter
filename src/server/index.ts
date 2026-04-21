/**
 * Web UI Server
 * Local HTTP server for Swixter Web UI
 */

import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import pc from "picocolors";
import { Router } from "./router.js";
import { corsMiddleware, jsonBodyMiddleware, notFoundHandler } from "./middleware.js";
import { handleApiRequest } from "./bun-http-bridge.js";
import { serveStaticRequest } from "./bun-static.js";
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

  exec(`${command} ${url}`, (error) => {
    if (error) {
      console.warn(pc.yellow(`Could not open browser automatically: ${error.message}`));
    }
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
 * Start the Web UI server using Bun.serve with WebSocket support.
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

  // Create Bun.serve server
  const bunServer = Bun.serve({
    hostname: host,
    port,
    fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        server.upgrade(req);
        return;
      }

      // API routes
      if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
        return handleApiRequest(req, router);
      }

      // Static files / SPA
      return serveStaticRequest(req, staticOptions);
    },
    websocket: {
      open(ws) {
        wsManager.addClient(ws);
      },
      close(ws) {
        wsManager.removeClient(ws);
      },
      message(_ws, _message) {
        // No incoming messages expected; all events are server→client
      },
    },
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
      bunServer.stop();
      console.log();
      console.log(pc.dim("Server closed"));
      callback?.();
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
