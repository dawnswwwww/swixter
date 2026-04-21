/**
 * Proxy Status API
 * GET /api/proxy/status - Get proxy status (backward compat, returns default instance)
 * GET /api/proxy/instances - List all proxy instances
 * POST /api/proxy/start - Start default proxy server
 * POST /api/proxy/stop - Stop proxy instance (default or specified)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  getProxyStatus,
  startProxyServer,
  stopProxyServer,
  listProxyInstances,
} from "../../proxy/server.js";
import { getActiveGroup } from "../../groups/manager.js";
import { sendError, sendJson } from "../middleware.js";

/**
 * GET /api/proxy/status - Get proxy status (backward compat)
 */
export async function handleGetProxyStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const status = getProxyStatus("default");
    const activeGroup = await getActiveGroup();

    sendJson(res, {
      ...status,
      activeGroupName: activeGroup?.name,
    });
  } catch (error) {
    sendError(res, { code: "GET_PROXY_STATUS_FAILED", message: error instanceof Error ? error.message : "Failed to get proxy status" }, 500);
  }
}

/**
 * GET /api/proxy/instances - List all proxy instances
 */
export async function handleListInstances(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const instances = listProxyInstances();
    const activeGroup = await getActiveGroup();
    const enriched = instances.map((s) => ({
      ...s,
      activeGroupName: s.groupName || activeGroup?.name,
    }));
    sendJson(res, enriched);
  } catch (error) {
    sendError(res, { code: "LIST_INSTANCES_FAILED", message: error instanceof Error ? error.message : "Failed to list instances" }, 500);
  }
}

/**
 * POST /api/proxy/start - Start proxy server (default instance)
 */
export async function handleStartProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (req as any).body;
  const requestedHost = body?.host || "127.0.0.1";
  const requestedPort = body?.port;

  try {
    // If no explicit port, find the next available one
    let port = requestedPort || 15721;
    if (!requestedPort) {
      const allInstances = listProxyInstances();
      const occupiedPorts = new Set(
        allInstances.filter((s) => s.running).map((s) => s.port)
      );
      while (occupiedPorts.has(port)) {
        port++;
      }
    }

    const status = await startProxyServer({
      instanceId: "default",
      type: "service",
      host: requestedHost,
      port,
    });
    sendJson(res, status);
  } catch (error) {
    sendError(res, { code: "START_PROXY_FAILED", message: error instanceof Error ? error.message : "Failed to start proxy" }, 400);
  }
}

/**
 * POST /api/proxy/stop - Stop proxy instance
 */
export async function handleStopProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const body = (req as any).body;
    const instanceId = body?.instanceId || "default";
    await stopProxyServer(instanceId);
    sendJson(res, { success: true, message: `Proxy instance "${instanceId}" stopped` });
  } catch (error) {
    sendError(res, { code: "STOP_PROXY_FAILED", message: error instanceof Error ? error.message : "Failed to stop proxy" }, 500);
  }
}
