import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { getConfigPath } from "../config/manager.js";
import { emitLog } from "../server/events.js";

const MAX_PROXY_LOG_SIZE_BYTES = 100 * 1024 * 1024;

function formatMeta(meta?: Record<string, unknown>): Record<string, unknown> {
  return meta ? { ...meta } : {};
}

function rotateProxyLogIfNeeded(logPath: string): void {
  if (!existsSync(logPath)) {
    return;
  }

  const size = statSync(logPath).size;
  if (size < MAX_PROXY_LOG_SIZE_BYTES) {
    return;
  }

  const rotatedPath = `${logPath}.1`;
  rmSync(rotatedPath, { force: true });
  renameSync(logPath, rotatedPath);
}

function writeProxyLog(logPath: string, record: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    rotateProxyLogIfNeeded(logPath);
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, "utf-8");
  } catch {
    // Logging must never break proxy flow.
  }
}

/**
 * Get log file path for a specific proxy instance.
 * instanceId "default" → proxy-default.log
 * instanceId "run-15722" → proxy-run-15722.log
 */
export function getProxyLogPath(instanceId: string): string {
  return join(dirname(getConfigPath()), `proxy-${instanceId}.log`);
}

export interface ProxyLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, error?: Error, meta?: Record<string, unknown>): void;
  request(method: string, path: string, status: number, durationMs: number): void;
}

/**
 * Create a logger bound to a specific proxy instance.
 */
export function createProxyLogger(instanceId: string): ProxyLogger {
  const logPath = getProxyLogPath(instanceId);

  const write = (record: Record<string, unknown>) => {
    const entry = { ...record, instanceId };
    writeProxyLog(logPath, entry);
    try {
      emitLog(instanceId, entry as import("../../ui/src/api/types.js").ProxyLogEntry);
    } catch {
      // Event bus errors must never break proxy flow.
    }
  };

  return {
    info(msg: string, meta?: Record<string, unknown>): void {
      write({ ts: new Date().toISOString(), level: "info", msg, ...formatMeta(meta) });
    },

    warn(msg: string, meta?: Record<string, unknown>): void {
      write({ ts: new Date().toISOString(), level: "warn", msg, ...formatMeta(meta) });
    },

    error(msg: string, error?: Error, meta?: Record<string, unknown>): void {
      write({ ts: new Date().toISOString(), level: "error", msg, error: error?.message, stack: error?.stack, ...formatMeta(meta) });
    },

    request(method: string, path: string, status: number, durationMs: number): void {
      write({ ts: new Date().toISOString(), level: "access", method, path, status, durationMs });
    },
  };
}

/**
 * Legacy default logger — writes to proxy-default.log.
 * Kept for backward compatibility during migration.
 */
export const proxyLogger = createProxyLogger("default");
