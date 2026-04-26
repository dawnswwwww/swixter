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
