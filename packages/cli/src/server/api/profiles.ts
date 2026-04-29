/**
 * Profiles API
 * GET /api/profiles - List all profiles
 * GET /api/profiles/:name - Get single profile
 * POST /api/profiles - Create profile
 * PUT /api/profiles/:name - Update profile
 * DELETE /api/profiles/:name - Delete profile
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ClaudeCodeProfile } from "../../types.js";
import * as manager from "../../config/manager.js";
import { sendError, sendJson } from "../middleware.js";
import { sanitizeProfile, fullProfile } from "./util.js";
import { getAllPresets } from "../../providers/presets.js";

/**
 * GET /api/profiles - List all profiles
 */
export async function listProfiles(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const profiles = await manager.listProfiles();
  sendJson(res, profiles.map(sanitizeProfile));
}

/**
 * GET /api/profiles/:name - Get single profile
 */
export async function getProfile(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { name } = params;

  if (!name) {
    sendError(res, { code: "INVALID_PARAMS", message: "Profile name is required" }, 400);
    return;
  }

  const profile = await manager.getProfile(name);

  if (!profile) {
    sendError(res, { code: "PROFILE_NOT_FOUND", message: `Profile "${name}" does not exist` }, 404);
    return;
  }

  sendJson(res, sanitizeProfile(profile));
}

/**
 * POST /api/profiles - Create profile
 */
export async function createProfile(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (req as any).body;

  if (!body || !body.name || !body.providerId) {
    sendError(res, { code: "INVALID_PARAMS", message: "name and providerId are required" }, 400);
    return;
  }

  // Verify provider exists
  const providers = await getAllPresets();
  const provider = providers.find(p => p.id === body.providerId);

  if (!provider) {
    sendError(res, { code: "UNKNOWN_PROVIDER", message: `Provider "${body.providerId}" not found` }, 400);
    return;
  }

  // Check if profile already exists
  const existing = await manager.getProfile(body.name);
  if (existing) {
    sendError(res, { code: "PROFILE_EXISTS", message: `Profile "${body.name}" already exists` }, 409);
    return;
  }

  try {
    const now = new Date().toISOString();
    const profile: ClaudeCodeProfile = {
      name: body.name,
      providerId: body.providerId,
      apiKey: body.apiKey || "",
      authToken: body.authToken || "",
      baseURL: body.baseURL || provider.baseURL,
      model: body.model,
      openaiModel: body.openaiModel,
      models: body.models,
      envKey: body.envKey,
      headers: body.headers,
      createdAt: now,
      updatedAt: now,
    };

    await manager.upsertProfile(profile, body.coder);

    sendJson(res, sanitizeProfile(profile), 201);
  } catch (error) {
    sendError(res, { code: "CREATE_FAILED", message: error instanceof Error ? error.message : "Failed to create profile" }, 500);
  }
}

/**
 * PUT /api/profiles/:name - Update profile
 */
export async function updateProfile(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { name } = params;
  const body = (req as any).body;

  if (!name) {
    sendError(res, { code: "INVALID_PARAMS", message: "Profile name is required" }, 400);
    return;
  }

  // Check if profile exists
  const existing = await manager.getProfile(name);
  if (!existing) {
    sendError(res, { code: "PROFILE_NOT_FOUND", message: `Profile "${name}" does not exist` }, 404);
    return;
  }

  try {
    const now = new Date().toISOString();
    const profile: ClaudeCodeProfile = {
      ...existing,
      ...body,
      name, // Ensure name stays consistent with URL param
      updatedAt: now,
    };

    await manager.upsertProfile(profile);

    sendJson(res, sanitizeProfile(profile));
  } catch (error) {
    sendError(res, { code: "UPDATE_FAILED", message: error instanceof Error ? error.message : "Failed to update profile" }, 500);
  }
}

/**
 * DELETE /api/profiles/:name - Delete profile
 */
export async function deleteProfile(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { name } = params;

  if (!name) {
    sendError(res, { code: "INVALID_PARAMS", message: "Profile name is required" }, 400);
    return;
  }

  try {
    await manager.deleteProfile(name);
    sendJson(res, { success: true, message: `Profile "${name}" deleted` });
  } catch (error) {
    sendError(res, { code: "DELETE_FAILED", message: error instanceof Error ? error.message : "Failed to delete profile" }, 500);
  }
}
