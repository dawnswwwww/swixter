import type { Group } from "./types.js";
import { GroupSchema } from "./types.js";
import { loadConfig, saveConfig } from "../config/manager.js";

function generateId(): string {
  return `grp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createGroup(input: {
  name: string;
  profiles: string[];
  isDefault?: boolean;
}): Promise<Group> {
  const config = await loadConfig();

  const now = new Date().toISOString();
  const id = generateId();

  const group: Group = {
    id,
    name: input.name,
    profiles: input.profiles,
    isDefault: input.isDefault ?? false,
    createdAt: now,
    updatedAt: now,
  };

  GroupSchema.parse(group);

  if (group.isDefault) {
    for (const g of Object.values(config.groups)) {
      g.isDefault = false;
    }
  }

  config.groups[id] = group;

  if (!config.activeGroup) {
    config.activeGroup = id;
  }

  await saveConfig(config);
  return group;
}

export async function getGroup(idOrName: string): Promise<Group | null> {
  const config = await loadConfig();

  if (config.groups[idOrName]) {
    return config.groups[idOrName];
  }

  return Object.values(config.groups).find(g => g.name === idOrName) || null;
}

export async function listGroups(): Promise<Group[]> {
  const config = await loadConfig();
  return Object.values(config.groups);
}

export async function updateGroup(id: string, updates: Partial<Pick<Group, "name" | "profiles" | "isDefault">>): Promise<Group | null> {
  const config = await loadConfig();
  const group = config.groups[id];

  if (!group) return null;

  const updated: Group = {
    ...group,
    name: updates.name ?? group.name,
    profiles: updates.profiles ?? group.profiles,
    isDefault: updates.isDefault ?? group.isDefault,
    updatedAt: new Date().toISOString(),
  };

  if (updated.isDefault) {
    for (const g of Object.values(config.groups)) {
      if (g.id !== id) g.isDefault = false;
    }
  }

  config.groups[id] = updated;
  await saveConfig(config);
  return updated;
}

export async function deleteGroup(id: string): Promise<boolean> {
  const config = await loadConfig();

  if (!config.groups[id]) return false;

  delete config.groups[id];

  if (config.activeGroup === id) {
    const remaining = Object.values(config.groups);
    config.activeGroup = remaining.length > 0 ? remaining[0].id : undefined;
  }

  await saveConfig(config);
  return true;
}

export async function setDefaultGroup(idOrName: string): Promise<Group | null> {
  const group = await getGroup(idOrName);
  if (!group) return null;

  return updateGroup(group.id, { isDefault: true });
}

export async function getActiveGroup(): Promise<Group | null> {
  const config = await loadConfig();
  if (!config.activeGroup) return null;
  return config.groups[config.activeGroup] || null;
}

export async function setActiveGroup(id: string): Promise<boolean> {
  const config = await loadConfig();
  if (!config.groups[id]) return false;

  config.activeGroup = id;
  await saveConfig(config);
  return true;
}
