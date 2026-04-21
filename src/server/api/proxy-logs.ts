/**
 * Proxy Logs API
 * GET /api/proxy/logs?instanceId=default&lines=N - Read proxy log entries
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { getProxyLogPath } from "../../proxy/logger.js";
import { sendError, sendJson } from "../middleware.js";

const DEFAULT_LINES = 200;
const MAX_LINES = 1000;

/**
 * GET /api/proxy/logs?instanceId=default&lines=N
 */
export async function handleGetProxyLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || "", "http://localhost");
    const instanceId = url.searchParams.get("instanceId") || "default";
    const requestedLines = parseInt(url.searchParams.get("lines") || String(DEFAULT_LINES), 10);
    const lines = Math.min(Math.max(requestedLines, 1), MAX_LINES);

    const logPath = getProxyLogPath(instanceId);

    if (!existsSync(logPath)) {
      sendJson(res, { lines: [], total: 0, instanceId });
      return;
    }

    const content = readFileSync(logPath, "utf-8");
    const allLines = content.trim().split("\n").filter(Boolean);
    const total = allLines.length;
    const tail = allLines.slice(-lines);

    const parsed = tail
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    // Newest first
    parsed.reverse();

    sendJson(res, { lines: parsed, total, instanceId });
  } catch (error) {
    sendError(res, { code: "GET_PROXY_LOGS_FAILED", message: error instanceof Error ? error.message : "Failed to read proxy logs" }, 500);
  }
}
