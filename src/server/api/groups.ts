/**
 * Groups API
 * GET /api/groups - List all groups
 * GET /api/groups/:id - Get single group
 * POST /api/groups - Create group
 * PUT /api/groups/:id - Update group
 * DELETE /api/groups/:id - Delete group
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  deleteGroup,
  setActiveGroup as setActiveGroupManager,
  getActiveGroup,
} from "../../groups/manager.js";
import { getProfile } from "../../config/manager.js";
import { sendError, sendJson } from "../middleware.js";
import { emitGroupChange } from "../events.js";

/**
 * GET /api/groups - List all groups
 */
export async function handleListGroups(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const groups = await listGroups();
    const groupsWithProfiles = await Promise.all(
      groups.map(async (g) => ({
        ...g,
        profileDetails: await Promise.all(
          g.profiles.map(async (pid) => {
            const profile = await getProfile(pid);
            return profile ? { id: pid, name: profile.name, providerId: profile.providerId } : null;
          })
        ),
      }))
    );

    sendJson(res, groupsWithProfiles);
  } catch (error) {
    sendError(res, { code: "LIST_GROUPS_FAILED", message: error instanceof Error ? error.message : "Failed to list groups" }, 500);
  }
}

/**
 * GET /api/groups/:id - Get single group
 */
export async function handleGetGroup(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { id } = params;

  if (!id) {
    sendError(res, { code: "INVALID_PARAMS", message: "Group ID is required" }, 400);
    return;
  }

  try {
    const group = await getGroup(id);
    if (!group) {
      sendError(res, { code: "GROUP_NOT_FOUND", message: `Group "${id}" not found` }, 404);
      return;
    }
    sendJson(res, group);
  } catch (error) {
    sendError(res, { code: "GET_GROUP_FAILED", message: error instanceof Error ? error.message : "Failed to get group" }, 500);
  }
}

/**
 * POST /api/groups - Create group
 */
export async function handleCreateGroup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = (req as any).body;

  if (!body || !body.name) {
    sendError(res, { code: "INVALID_PARAMS", message: "name is required" }, 400);
    return;
  }

  try {
    const group = await createGroup({
      name: body.name,
      profiles: body.profiles || [],
      isDefault: body.isDefault,
    });
    sendJson(res, group, 201);
  } catch (error) {
    sendError(res, { code: "CREATE_GROUP_FAILED", message: error instanceof Error ? error.message : "Failed to create group" }, 400);
  }
}

/**
 * PUT /api/groups/:id - Update group
 */
export async function handleUpdateGroup(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { id } = params;
  const body = (req as any).body;

  if (!id) {
    sendError(res, { code: "INVALID_PARAMS", message: "Group ID is required" }, 400);
    return;
  }

  try {
    const group = await updateGroup(id, body);
    if (!group) {
      sendError(res, { code: "GROUP_NOT_FOUND", message: `Group "${id}" not found` }, 404);
      return;
    }
    sendJson(res, group);
  } catch (error) {
    sendError(res, { code: "UPDATE_GROUP_FAILED", message: error instanceof Error ? error.message : "Failed to update group" }, 400);
  }
}

/**
 * DELETE /api/groups/:id - Delete group
 */
export async function handleDeleteGroup(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { id } = params;

  if (!id) {
    sendError(res, { code: "INVALID_PARAMS", message: "Group ID is required" }, 400);
    return;
  }

  try {
    const deleted = await deleteGroup(id);
    if (!deleted) {
      sendError(res, { code: "GROUP_NOT_FOUND", message: `Group "${id}" not found` }, 404);
      return;
    }
    sendJson(res, { success: true, message: `Group "${id}" deleted` });
  } catch (error) {
    sendError(res, { code: "DELETE_GROUP_FAILED", message: error instanceof Error ? error.message : "Failed to delete group" }, 400);
  }
}

/**
 * PUT /api/groups/:id/active - Set active group
 */
export async function handleSetActiveGroup(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Promise<void> {
  const { id } = params;

  if (!id) {
    sendError(res, { code: "INVALID_PARAMS", message: "Group ID is required" }, 400);
    return;
  }

  try {
    const group = await getGroup(id);
    if (!group) {
      sendError(res, { code: "GROUP_NOT_FOUND", message: `Group "${id}" not found` }, 404);
      return;
    }
    await setActiveGroupManager(id);
    const active = await getActiveGroup();
    if (active) {
      emitGroupChange(active.id, active.name);
    }
    sendJson(res, active);
  } catch (error) {
    sendError(res, { code: "SET_ACTIVE_GROUP_FAILED", message: error instanceof Error ? error.message : "Failed to set active group" }, 500);
  }
}
