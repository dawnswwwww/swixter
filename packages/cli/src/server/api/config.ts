/**
 * Config API
 * GET /api/version - Get version information
 * GET /api/config - Get config metadata
 * GET /api/config/export - Export configuration
 * POST /api/config/import - Import configuration
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, statSync } from "node:fs";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { join, dirname } from "node:path";
import { APP_VERSION } from "../../constants/meta.js";
import { CONFIG_VERSION, EXPORT_VERSION } from "../../constants/versions.js";
import { getConfigPath, getConfigDir } from "../../constants/paths.js";
import { exportConfig, importConfig } from "../../config/export.js";
import { sendError, sendJson } from "../middleware.js";
import { generateETag, setETagHeaders, parseIfNoneMatch } from "./util.js";

/**
 * GET /api/version - Get version information
 */
export async function getVersion(req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJson(res, {
    appVersion: APP_VERSION,
    configVersion: CONFIG_VERSION,
    exportVersion: EXPORT_VERSION,
  });
}

/**
 * GET /api/config - Get config metadata
 * Supports ETag-based caching for efficient polling
 */
export async function getConfigMeta(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const configPath = getConfigPath("swixter");

  if (!existsSync(configPath)) {
    sendJson(res, {
      exists: false,
      profiles: [],
      mtime: null,
      size: 0,
    });
    return;
  }

  try {
    const stats = statSync(configPath);
    const etag = generateETag(stats.mtime, stats.size);

    // Check If-None-Match header
    const ifNoneMatch = parseIfNoneMatch(req.headers["if-none-match"]);

    if (ifNoneMatch === etag) {
      res.statusCode = 304;
      res.end();
      return;
    }

    setETagHeaders(res, stats.mtime, stats.size);

    // Load config to get profile count
    const { listProfiles } = await import("../../config/manager.js");
    const profiles = await listProfiles();

    sendJson(res, {
      exists: true,
      profiles: profiles.map((p: any) => ({
        name: p.name,
        providerId: p.providerId,
        updatedAt: p.updatedAt,
      })),
      mtime: stats.mtime.toISOString(),
      size: stats.size,
      etag,
    });
  } catch (error) {
    sendError(res, { code: "STAT_FAILED", message: "Failed to read config metadata" }, 500);
  }
}

/**
 * GET /api/config/export - Export configuration
 * Query params: ?sanitize=true to mask API keys
 */
export async function exportConfigFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const sanitize = url.searchParams.get("sanitize") === "true";

    // Use the export config function with sanitization support
    const { exportConfig } = await import("../../config/export.js");
    const tempDir = getConfigDir("swixter");
    const tempPath = join(tempDir, `.export-${Date.now()}.json`);

    try {
      await exportConfig(tempPath, { sanitizeKeys: sanitize });

      const content = await readFile(tempPath, "utf-8");

      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Disposition", 'attachment; filename="swixter-config.json"');
      res.statusCode = 200;
      res.end(content);
    } finally {
      // Clean up temp file
      try { await unlink(tempPath); } catch {}
    }
  } catch (error) {
    sendError(res, { code: "EXPORT_FAILED", message: "Failed to export configuration" }, 500);
  }
}

/**
 * POST /api/config/import - Import configuration
 */
export async function importConfigFile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (req as any).body;

  if (!body || !body.config) {
    sendError(res, { code: "INVALID_PARAMS", message: "config is required" }, 400);
    return;
  }

  try {
    // Create temporary file for import
    const tempDir = getConfigDir("swixter");
    const tempPath = join(tempDir, `.import-${Date.now()}.json`);

    // Write the config data to the temp file
    await writeFile(tempPath, JSON.stringify(body.config), "utf-8");

    try {
      const result = await importConfig(tempPath, { overwrite: body.overwrite !== false });
      sendJson(res, { success: true, ...result });
    } finally {
      // Clean up temp file
      try { await unlink(tempPath); } catch {}
    }
  } catch (error) {
    sendError(res, { code: "IMPORT_FAILED", message: error instanceof Error ? error.message : "Failed to import configuration" }, 500);
  }
}

/**
 * POST /api/config/reset - Reset all data
 */
export async function resetConfig(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { resetAllData } = await import("../../config/manager.js");
    await resetAllData();
    sendJson(res, { success: true, message: "All data has been reset" });
  } catch (error) {
    sendError(res, { code: "RESET_FAILED", message: error instanceof Error ? error.message : "Failed to reset configuration" }, 500);
  }
}
