# Swixter UI Daemon Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `--daemon`, `--stop`, and `--status` flags to `swixter ui`, with automatic browser-open when a running instance is detected.

**Architecture:** Extract PID file management and process detection into a reusable `daemon.ts` utility. `ui.ts` orchestrates foreground/background/stop/status flows by delegating to this utility and spawning detached child processes for daemon mode.

**Tech Stack:** Node.js/Bun, `node:child_process`, `node:fs/promises`, existing Swixter server (`http.createServer` + WebSocket)

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/utils/daemon.ts` | **Create** | PID file read/write, process alive detection (`kill(pid, 0)`), HTTP health check, daemon stop |
| `tests/utils/daemon.test.ts` | **Create** | Unit tests for PID file ops and process detection |
| `src/cli/ui.ts` | **Modify** | Parse `--daemon`/`--stop`/`--status`, orchestrate flows, spawn detached child |
| `src/server/index.ts` | **Modify** | Add optional `noBrowser` param to `startServer` so daemon child doesn't auto-open browser |
| `src/cli/help.ts` | **Modify** | Update help text for new flags |

---

### Task 1: Create Daemon Utility Module

**Files:**
- Create: `src/utils/daemon.ts`

**Dependencies:**
- `src/constants/paths.ts` for `getConfigDir('swixter')`

- [ ] **Step 1: Implement `src/utils/daemon.ts`**

```typescript
import { existsSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "../constants/paths.js";

export interface PidFileData {
  pid: number;
  port: number;
  startTime: string;
}

export function getPidFilePath(): string {
  return join(getConfigDir("swixter"), "ui.pid");
}

export function getLogFilePath(): string {
  return join(getConfigDir("swixter"), "ui.log");
}

export async function readPidFile(): Promise<PidFileData | null> {
  const path = getPidFilePath();
  if (!existsSync(path)) return null;
  try {
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as PidFileData;
  } catch {
    return null;
  }
}

export async function writePidFile(pid: number, port: number): Promise<void> {
  const path = getPidFilePath();
  const data: PidFileData = { pid, port, startTime: new Date().toISOString() };
  await writeFile(path, JSON.stringify(data, null, 2), "utf-8");
}

export async function removePidFile(): Promise<void> {
  const path = getPidFilePath();
  if (existsSync(path)) {
    await unlink(path).catch(() => {});
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function isSwixterUiRunning(pid: number, port: number): Promise<boolean> {
  if (!isProcessAlive(pid)) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/version`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function cleanupStalePidFile(): Promise<void> {
  const data = await readPidFile();
  if (data && !isProcessAlive(data.pid)) {
    await removePidFile();
  }
}

export async function stopDaemon(): Promise<{ success: boolean; message: string }> {
  const data = await readPidFile();
  if (!data) {
    return { success: false, message: "No daemon process is running." };
  }

  if (!isProcessAlive(data.pid)) {
    await removePidFile();
    return { success: false, message: "Daemon process is not running (stale PID file removed)." };
  }

  try {
    process.kill(data.pid, "SIGTERM");
    await removePidFile();
    return { success: true, message: `Daemon process ${data.pid} stopped.` };
  } catch {
    await removePidFile();
    return { success: false, message: "Failed to stop daemon process (PID file removed)." };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/daemon.ts
git commit -m "feat(daemon): add PID file and process detection utilities"
```

---

### Task 2: Write Unit Tests for Daemon Utility

**Files:**
- Create: `tests/utils/daemon.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import {
  getPidFilePath,
  getLogFilePath,
  readPidFile,
  writePidFile,
  removePidFile,
  isProcessAlive,
  cleanupStalePidFile,
  stopDaemon,
} from "../../src/utils/daemon.js";

describe("Daemon Utilities", () => {
  const testPidFile = getPidFilePath();

  beforeEach(async () => {
    if (existsSync(testPidFile)) {
      await unlink(testPidFile).catch(() => {});
    }
  });

  afterEach(async () => {
    if (existsSync(testPidFile)) {
      await unlink(testPidFile).catch(() => {});
    }
  });

  test("getPidFilePath should return path in swixter config dir", () => {
    const path = getPidFilePath();
    expect(path).toContain("ui.pid");
  });

  test("getLogFilePath should return path in swixter config dir", () => {
    const path = getLogFilePath();
    expect(path).toContain("ui.log");
  });

  test("readPidFile should return null when file does not exist", async () => {
    const result = await readPidFile();
    expect(result).toBeNull();
  });

  test("writePidFile and readPidFile roundtrip", async () => {
    await writePidFile(12345, 3141);
    const result = await readPidFile();
    expect(result).not.toBeNull();
    expect(result!.pid).toBe(12345);
    expect(result!.port).toBe(3141);
    expect(result!.startTime).toBeString();
  });

  test("removePidFile should delete the file", async () => {
    await writePidFile(12345, 3141);
    expect(existsSync(testPidFile)).toBe(true);
    await removePidFile();
    expect(existsSync(testPidFile)).toBe(false);
  });

  test("isProcessAlive should return true for current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  test("isProcessAlive should return false for non-existent PID", () => {
    // PID 99999 is unlikely to exist
    expect(isProcessAlive(99999)).toBe(false);
  });

  test("cleanupStalePidFile should remove file for dead process", async () => {
    await writePidFile(99999, 3141);
    expect(existsSync(testPidFile)).toBe(true);
    await cleanupStalePidFile();
    expect(existsSync(testPidFile)).toBe(false);
  });

  test("cleanupStalePidFile should keep file for alive process", async () => {
    await writePidFile(process.pid, 3141);
    await cleanupStalePidFile();
    expect(existsSync(testPidFile)).toBe(true);
  });

  test("stopDaemon should return false when no PID file exists", async () => {
    const result = await stopDaemon();
    expect(result.success).toBe(false);
    expect(result.message).toContain("No daemon");
  });

  test("stopDaemon should clean stale PID file", async () => {
    await writePidFile(99999, 3141);
    const result = await stopDaemon();
    expect(result.success).toBe(false);
    expect(result.message).toContain("not running");
    expect(existsSync(testPidFile)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
bun test tests/utils/daemon.test.ts
```

Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/utils/daemon.test.ts
git commit -m "test(daemon): add unit tests for PID file and process detection"
```

---

### Task 3: Update `startServer` to Support `noBrowser` Option

**Files:**
- Modify: `src/server/index.ts`

- [ ] **Step 1: Update `startServer` signature and logic**

In `src/server/index.ts`, change the `startServer` function:

```typescript
export async function startServer(
  portArg?: number,
  options?: { noBrowser?: boolean }
): Promise<WebUiServerHandle> {
  const port = portArg || await findAvailablePort(3141);
  const host = "127.0.0.1";
  // ... rest of setup stays the same ...

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

  // Auto-open browser (skip in daemon mode)
  if (!options?.noBrowser) {
    openBrowser(url);
  }

  // Return handle ...
}
```

- [ ] **Step 2: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(server): add noBrowser option to startServer for daemon mode"
```

---

### Task 4: Rewrite `src/cli/ui.ts` with Daemon/Stop/Status Support

**Files:**
- Modify: `src/cli/ui.ts`

**Dependencies:**
- `src/utils/daemon.ts` (from Task 1)
- `src/server/index.ts` (from Task 3)
- `src/constants/paths.ts` for config dir

- [ ] **Step 1: Rewrite `src/cli/ui.ts`**

```typescript
/**
 * UI Command Handler
 * swixter ui [--port <port>] [--daemon | --stop | --status]
 */

import pc from "picocolors";
import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { join } from "node:path";
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
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/ui.ts
git commit -m "feat(ui): add --daemon, --stop, --status flags with auto browser open"
```

---

### Task 5: Update Help Text

**Files:**
- Modify: `src/cli/help.ts` (lines 612-616)

- [ ] **Step 1: Update UI help section**

Replace lines 612-616 in `src/cli/help.ts`:

```typescript
  ${pc.bold("Web UI:")}
  ${pc.cyan("ui")}                    ${pc.dim("Launch local Web UI")}
    ${pc.dim("swixter ui [--port <port>]")}
    ${pc.dim("Start local HTTP server and open browser")}
    ${pc.dim("swixter ui --daemon [--port <port>]")}
    ${pc.dim("Start server in background")}
    ${pc.dim("swixter ui --stop")}
    ${pc.dim("Stop background server")}
    ${pc.dim("swixter ui --status")}
    ${pc.dim("Show background server status")}
```

- [ ] **Step 2: Commit**

```bash
git add src/cli/help.ts
git commit -m "docs(help): update ui command help for daemon/stop/status"
```

---

### Task 6: Run Full Test Suite

- [ ] **Step 1: Run all tests**

```bash
bun test
```

Expected: all tests pass (including new `tests/utils/daemon.test.ts`)

- [ ] **Step 2: Build and smoke test**

```bash
bun run build:cli
node dist/cli/index.js ui --status
```

Expected: "Swixter UI is not running."

- [ ] **Step 3: Commit (if any fixes needed)**

```bash
git add .
git commit -m "chore: verify daemon mode tests and build"
```

---

## Self-Review

### Spec Coverage Checklist

| Spec Requirement | Implementing Task |
|-----------------|-------------------|
| `swixter ui` detects existing instance, opens browser | Task 4 (`runForeground`) |
| `swixter ui --daemon` background start | Task 4 (`startDaemon`) |
| `swixter ui --stop` stops daemon | Task 4 + Task 1 (`stopDaemon`) |
| `swixter ui --status` shows status | Task 4 (`showStatus`) |
| PID file at `~/.config/swixter/ui.pid` | Task 1 (`getPidFilePath`) |
| Dual verification (PID + HTTP) | Task 1 (`isSwixterUiRunning`) |
| Logs to `~/.config/swixter/ui.log` | Task 4 (`getLogFilePath`) |
| Stale PID file cleanup | Task 1 (`cleanupStalePidFile`) |

### Placeholder Scan

No TBD/TODO/"implement later"/"add validation" found. All steps contain complete code.

### Type Consistency

- `PidFileData` interface used consistently across daemon.ts and tests
- `startServer` optional `options` param added in Task 3, consumed in Task 4
- Flag parsing in Task 4 matches the command interface from the spec
