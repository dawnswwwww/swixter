/**
 * Coders API
 * GET /api/coders - List all coders
 * GET /api/coders/:coder/active - Get active profile for coder
 * PUT /api/coders/:coder/active - Set active profile for coder
 * POST /api/coders/:coder/apply - Apply active profile to coder
 * GET /api/coders/:coder/verify - Verify configuration
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { CODER_REGISTRY, getCoderConfig } from "../../constants/coders.js";
import { getActiveProfileForCoder, setActiveProfileForCoder } from "../../config/manager.js";
import { getAdapter } from "../../adapters/index.js";
import { sendError, sendJson } from "../middleware.js";
import { sanitizeProfile } from "./util.js";

/**
 * GET /api/coders - List all coders with their status
 */
export async function listCoders(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const result = [];

  for (const [coderId, coderConfig] of Object.entries(CODER_REGISTRY)) {
    const activeProfile = await getActiveProfileForCoder(coderId);

    result.push({
      id: coderId,
      displayName: coderConfig.displayName,
      executable: coderConfig.executable,
      activeProfile: activeProfile ? {
        name: activeProfile.name,
        providerId: activeProfile.providerId,
        baseURL: activeProfile.baseURL,
      } : null,
    });
  }

  sendJson(res, result);
}

/**
 * GET /api/coders/:coder/active - Get active profile for coder
 */
export async function getActiveProfile(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { coder } = params;

  if (!coder) {
    sendError(res, { code: "INVALID_PARAMS", message: "Coder ID is required" }, 400);
    return;
  }

  if (!CODER_REGISTRY[coder]) {
    sendError(res, { code: "UNKNOWN_CODER", message: `Coder "${coder}" not found` }, 404);
    return;
  }

  const profile = await getActiveProfileForCoder(coder);

  if (!profile) {
    sendJson(res, { activeProfile: null });
    return;
  }

  sendJson(res, { activeProfile: sanitizeProfile(profile) });
}

/**
 * PUT /api/coders/:coder/active - Set active profile for coder
 */
export async function setActiveProfile(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { coder } = params;
  const body = (req as any).body;

  if (!coder) {
    sendError(res, { code: "INVALID_PARAMS", message: "Coder ID is required" }, 400);
    return;
  }

  if (!CODER_REGISTRY[coder]) {
    sendError(res, { code: "UNKNOWN_CODER", message: `Coder "${coder}" not found` }, 404);
    return;
  }

  if (!body || !body.profileName) {
    sendError(res, { code: "INVALID_PARAMS", message: "profileName is required" }, 400);
    return;
  }

  try {
    await setActiveProfileForCoder(coder, body.profileName);

    const profile = await getActiveProfileForCoder(coder);
    sendJson(res, { activeProfile: profile ? sanitizeProfile(profile) : null });
  } catch (error) {
    sendError(res, { code: "SWITCH_FAILED", message: error instanceof Error ? error.message : "Failed to switch profile" }, 500);
  }
}

/**
 * POST /api/coders/:coder/apply - Apply active profile to coder
 */
export async function applyProfile(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { coder } = params;

  if (!coder) {
    sendError(res, { code: "INVALID_PARAMS", message: "Coder ID is required" }, 400);
    return;
  }

  if (!CODER_REGISTRY[coder]) {
    sendError(res, { code: "UNKNOWN_CODER", message: `Coder "${coder}" not found` }, 404);
    return;
  }

  // Get active profile for this coder
  const profile = await getActiveProfileForCoder(coder);

  if (!profile) {
    sendError(res, { code: "NO_ACTIVE_PROFILE", message: `No active profile for coder "${coder}"` }, 400);
    return;
  }

  try {
    const adapter = getAdapter(coder);
    await adapter.apply(profile);

    sendJson(res, { success: true, message: `Profile applied to ${coder}` });
  } catch (error) {
    sendError(res, { code: "APPLY_FAILED", message: error instanceof Error ? error.message : "Failed to apply profile" }, 500);
  }
}

/**
 * GET /api/coders/:coder/verify - Verify configuration
 */
export async function verifyConfig(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { coder } = params;

  if (!coder) {
    sendError(res, { code: "INVALID_PARAMS", message: "Coder ID is required" }, 400);
    return;
  }

  if (!CODER_REGISTRY[coder]) {
    sendError(res, { code: "UNKNOWN_CODER", message: `Coder "${coder}" not found` }, 404);
    return;
  }

  // Get active profile for this coder
  const profile = await getActiveProfileForCoder(coder);

  if (!profile) {
    sendJson(res, { verified: false, message: "No active profile" });
    return;
  }

  try {
    const adapter = getAdapter(coder);
    const verified = await adapter.verify(profile);

    sendJson(res, { verified, message: verified ? "Configuration verified" : "Verification failed" });
  } catch (error) {
    sendJson(res, { verified: false, message: error instanceof Error ? error.message : "Verification failed" });
  }
}
