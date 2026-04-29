/**
 * Providers API
 * GET /api/providers - List all providers
 * POST /api/providers - Add custom provider
 * PUT /api/providers/:id - Update provider
 * DELETE /api/providers/:id - Delete provider
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ProviderPreset } from "../../types.js";
import { getAllPresets } from "../../providers/presets.js";
import { loadUserProviders, upsertUserProvider, deleteUserProvider } from "../../providers/user-providers.js";
import { sendError, sendJson } from "../middleware.js";

/**
 * GET /api/providers - List all providers
 */
export async function listProviders(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const providers = await getAllPresets();
  const userProviders = await loadUserProviders();
  const userIds = new Set(userProviders.map(p => p.id));

  // Add isUser flag to each provider
  const result = providers.map(p => ({
    ...p,
    isUser: userIds.has(p.id),
  }));

  sendJson(res, result);
}

/**
 * POST /api/providers - Add custom provider
 */
export async function createProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (req as any).body;

  if (!body || !body.id || !body.name || !body.displayName) {
    sendError(res, { code: "INVALID_PARAMS", message: "id, name, and displayName are required" }, 400);
    return;
  }

  // Check if provider already exists
  const providers = await getAllPresets();
  const existing = providers.find(p => p.id === body.id);

  if (existing) {
    sendError(res, { code: "PROVIDER_EXISTS", message: `Provider "${body.id}" already exists` }, 409);
    return;
  }

  try {
    const provider: ProviderPreset = {
      id: body.id,
      name: body.name,
      displayName: body.displayName,
      baseURL: body.baseURL || "",
      defaultModels: body.defaultModels || [],
      authType: body.authType || "api-key",
      headers: body.headers,
      rateLimit: body.rateLimit,
      docs: body.docs,
      isChinese: body.isChinese,
      wire_api: body.wire_api,
      env_key: body.env_key,
    };

    await upsertUserProvider(provider);

    sendJson(res, { ...provider, isUser: true }, 201);
  } catch (error) {
    sendError(res, { code: "CREATE_FAILED", message: error instanceof Error ? error.message : "Failed to create provider" }, 500);
  }
}

/**
 * PUT /api/providers/:id - Update provider
 */
export async function updateProvider(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { id } = params;
  const body = (req as any).body;

  if (!id) {
    sendError(res, { code: "INVALID_PARAMS", message: "Provider ID is required" }, 400);
    return;
  }

  // Check if it's a user provider
  const userProviders = await loadUserProviders();
  const existing = userProviders.find(p => p.id === id);

  if (!existing) {
    sendError(res, { code: "NOT_USER_PROVIDER", message: `Provider "${id}" is not a user-defined provider` }, 400);
    return;
  }

  try {
    const provider: ProviderPreset = {
      ...existing,
      ...body,
      id, // Ensure ID stays consistent with URL param
    };

    await upsertUserProvider(provider);

    sendJson(res, { ...provider, isUser: true });
  } catch (error) {
    sendError(res, { code: "UPDATE_FAILED", message: error instanceof Error ? error.message : "Failed to update provider" }, 500);
  }
}

/**
 * DELETE /api/providers/:id - Delete provider
 */
export async function deleteProvider(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { id } = params;

  if (!id) {
    sendError(res, { code: "INVALID_PARAMS", message: "Provider ID is required" }, 400);
    return;
  }

  // Check if it's a user provider
  const userProviders = await loadUserProviders();
  const existing = userProviders.find(p => p.id === id);

  if (!existing) {
    sendError(res, { code: "NOT_USER_PROVIDER", message: `Provider "${id}" is not a user-defined provider` }, 400);
    return;
  }

  try {
    const deleted = await deleteUserProvider(id);

    if (!deleted) {
      sendError(res, { code: "DELETE_FAILED", message: `Failed to delete provider "${id}"` }, 500);
      return;
    }

    sendJson(res, { success: true, message: `Provider "${id}" deleted` });
  } catch (error) {
    sendError(res, { code: "DELETE_FAILED", message: error instanceof Error ? error.message : "Failed to delete provider" }, 500);
  }
}
