import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "../../src/constants/paths.js";
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

const SWIXTER_DIR = getConfigDir("swixter");
const PID_PATH = join(SWIXTER_DIR, "ui.pid");

describe("Daemon Utilities", () => {
  const testPidFile = getPidFilePath();

  beforeEach(async () => {
    // Simulate fresh install: remove the entire swixter config dir.
    // The auth test does the same — necessary because the daemon tests
    // call writePidFile(), which writes into SWIXTER_DIR. If the dir
    // was wiped before the auth test ran, writePidFile would previously
    // throw ENOENT on the freshly-empty dir.
    await rm(SWIXTER_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(SWIXTER_DIR, { recursive: true, force: true });
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

  test("should create parent dir when writing pid file on a fresh install", async () => {
    // Bug: on a fresh install, the swixter config dir does not exist,
    // and writePidFile() did not create it, so writeFile threw ENOENT.
    // Same latent bug as the auth token saveAuthState() fix (commit 601cdc8).
    expect(existsSync(SWIXTER_DIR)).toBe(false);
    expect(existsSync(PID_PATH)).toBe(false);

    await writePidFile(4242, 3141);

    expect(existsSync(SWIXTER_DIR)).toBe(true);
    expect(existsSync(PID_PATH)).toBe(true);
    const result = await readPidFile();
    expect(result).not.toBeNull();
    expect(result!.pid).toBe(4242);
    expect(result!.port).toBe(3141);
  });
});
