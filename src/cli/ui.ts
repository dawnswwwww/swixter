/**
 * UI Command Handler
 * swixter ui [--port <port>] [--daemon | --stop | --status]
 */

import pc from "picocolors";
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { startServer, openBrowser, findAvailablePort } from "../server/index.js";
import {
  readPidFile,
  writePidFile,
  removePidFile,
  isSwixterUiRunning,
  cleanupStalePidFile,
  stopDaemon,
  getLogFilePath,
} from "../utils/daemon.js";

/**
 * Handle ui command
 */
export async function handleUiCommand(args?: string[]): Promise<void> {
  const flags = parseFlags(args);

  // --stop: stop running daemon
  if (flags.stop) {
    const result = await stopDaemon();
    console.log();
    console.log(
      result.success ? pc.green("✓") + " " + result.message : pc.yellow("⚠") + " " + result.message
    );
    console.log();
    process.exit(result.success ? 0 : 1);
  }

  // --status: show daemon status
  if (flags.status) {
    await showStatus();
    return;
  }

  // --daemon: start in background
  if (flags.daemon) {
    await startDaemon(flags.port);
    return;
  }

  // Default: foreground mode (or open browser if already running)
  await runForeground(flags.port);
}

/**
 * Show daemon status
 */
async function showStatus(): Promise<void> {
  await cleanupStalePidFile();
  const data = await readPidFile();

  console.log();
  if (!data) {
    console.log(pc.yellow("Swixter UI is not running."));
    console.log(pc.dim("Run 'swixter ui --daemon' to start in background."));
    console.log();
    return;
  }

  const isRunning = await isSwixterUiRunning(data.pid, data.port);
  if (isRunning) {
    console.log(pc.green("✓ Swixter UI is running"));
    console.log(`  PID:  ${pc.cyan(String(data.pid))}`);
    console.log(`  URL:  ${pc.cyan(`http://127.0.0.1:${data.port}`)}`);
    console.log(`  Started: ${pc.dim(data.startTime)}`);
  } else {
    console.log(pc.yellow("⚠ Swixter UI is not running (stale PID file removed)."));
  }
  console.log();
}

/**
 * Start daemon in background
 */
async function startDaemon(portArg?: number): Promise<void> {
  // Check if already running
  await cleanupStalePidFile();
  const existing = await readPidFile();
  if (existing && (await isSwixterUiRunning(existing.pid, existing.port))) {
    console.log();
    console.log(pc.yellow("Swixter UI is already running."));
    console.log(`  PID: ${pc.cyan(String(existing.pid))}`);
    console.log(`  URL: ${pc.cyan(`http://127.0.0.1:${existing.port}`)}`);
    console.log();
    openBrowser(`http://127.0.0.1:${existing.port}`);
    return;
  }

  // Determine port
  const port = portArg || await findAvailablePort(3141);

  // Build child args: filter out --daemon, --stop, --status, keep --port
  const childArgs = process.argv.slice(1).filter(
    (arg) => arg !== "--daemon" && arg !== "--stop" && arg !== "--status"
  );

  // Open log file
  const logPath = getLogFilePath();
  const logFile = await open(logPath, "a");

  // Spawn detached child process
  const child = spawn(process.argv0, childArgs, {
    detached: true,
    stdio: ["ignore", logFile.fd, logFile.fd],
    env: { ...process.env, SWIXTER_UI_DAEMON: "1" },
  });

  child.unref();

  // Poll for server startup (max 10 seconds)
  const url = `http://127.0.0.1:${port}`;
  const started = await waitForServer(url, 10000);

  if (!started) {
    try {
      process.kill(child.pid!, "SIGTERM");
    } catch {}
    console.log();
    console.log(pc.red("✗ Failed to start daemon (timed out waiting for server)."));
    console.log();
    process.exit(1);
  }

  // Write PID file
  await writePidFile(child.pid!, port);

  console.log();
  console.log(pc.green("✓ Swixter UI daemon started"));
  console.log(`  PID:  ${pc.cyan(String(child.pid))}`);
  console.log(`  URL:  ${pc.cyan(url)}`);
  console.log(`  Log:  ${pc.dim(logPath)}`);
  console.log();
  console.log(pc.dim("Run 'swixter ui --stop' to stop."));
  console.log();
}

/**
 * Run in foreground (existing behavior + auto browser open if already running)
 */
async function runForeground(portArg?: number): Promise<void> {
  // Check if already running
  await cleanupStalePidFile();
  const existing = await readPidFile();
  if (existing && (await isSwixterUiRunning(existing.pid, existing.port))) {
    const url = `http://127.0.0.1:${existing.port}`;
    console.log();
    console.log(pc.green("✓ Swixter UI is already running"));
    console.log(`  URL: ${pc.cyan(url)}`);
    console.log();
    openBrowser(url);
    return;
  }

  // Start server in foreground
  const port = portArg || await findAvailablePort(3141);
  const noBrowser = process.env.SWIXTER_UI_DAEMON === "1";
  const server = await startServer(port, { noBrowser });

  // Handle graceful shutdown
  process.on("SIGINT", () => {
    console.log();
    console.log(pc.dim("Shutting down..."));
    server.close(() => {
      process.exit(0);
    });
  });

  process.stdin.resume();
}

/**
 * Poll server until it responds or timeout
 */
async function waitForServer(url: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  const interval = 200;

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/version`);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  return false;
}

/**
 * Parse flags from args
 */
function parseFlags(args?: string[]): { daemon: boolean; stop: boolean; status: boolean; port?: number } {
  const result = { daemon: false, stop: false, status: false, port: undefined as number | undefined };

  if (!args) return result;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--daemon") {
      result.daemon = true;
    } else if (arg === "--stop") {
      result.stop = true;
    } else if (arg === "--status") {
      result.status = true;
    } else if ((arg === "--port" || arg === "-p") && args[i + 1]) {
      const port = parseInt(args[i + 1], 10);
      if (!isNaN(port) && port >= 1 && port <= 65535) {
        result.port = port;
      }
      i++;
    }
  }

  return result;
}
