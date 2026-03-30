/**
 * Web UI Server
 * Local HTTP server for Swixter Web UI
 */

import { createServer, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import pc from "picocolors";
import { Router } from "./router.js";
import { corsMiddleware, jsonBodyMiddleware, notFoundHandler } from "./middleware.js";
import { createStaticServe } from "./static.js";
import * as profilesApi from "./api/profiles.js";
import * as providersApi from "./api/providers.js";
import * as codersApi from "./api/coders.js";
import * as configApi from "./api/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  // In development, look for ui/dist relative to project root
  // In production, look for dist/ui relative to the CLI directory
  const isDev = process.env.NODE_ENV === "development";

  if (isDev) {
    // Development: assume we're in src/server, go to project root then ui/dist
    return join(__dirname, "..", "..", "ui", "dist");
  }

  // Production: check if dist/ui exists (built UI), otherwise look relative to dist/cli
  // When using bun build on src/cli/index.ts, __dirname is dist/cli
  // We need to go up two levels to reach dist, then into ui
  return join(__dirname, "..", "..", "ui");
}

/**
 * Start the Web UI server
 */
export async function startServer(portArg?: number): Promise<Server> {
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

  // Create static file server
  const uiDir = getUiDir();
  const serveStatic = createStaticServe({ root: uiDir, index: "index.html", spa: true });

  // Create HTTP server
  const server = createServer(async (req, res) => {
    const url = req.url || "";

    // API routes go through the router
    if (url.startsWith("/api/") || url === "/api") {
      await router.handle(req, res);
    } else {
      // Everything else: static files (SPA)
      await serveStatic(req, res);
    }
  });

  // Start listening
  server.listen(port, host, () => {
    const url = `http://${host}:${port}`;

    console.log();
    console.log(pc.bold(pc.cyan("Swixter Web UI")));
    console.log();
    console.log(`  Server: ${pc.cyan(url)}`);
    console.log(`  Press ${pc.bold("Ctrl+C")} to stop`);
    console.log();

    // Auto-open browser
    openBrowser(url);
  });

  // Handle errors
  server.on("error", (error: any) => {
    if (error.code === "EADDRINUSE") {
      console.error(pc.red(`Error: Port ${port} is already in use`));
      console.log(pc.dim("Try specifying a different port with --port"));
      process.exit(1);
    } else {
      console.error(pc.red(`Server error: ${error.message}`));
      process.exit(1);
    }
  });

  // Graceful shutdown
  server.on("close", () => {
    console.log();
    console.log(pc.dim("Server closed"));
  });

  return server;
}

/**
 * Stop the server gracefully
 */
export function stopServer(server: Server): void {
  server.close();
}
