import type {
  GroupChangeEvent,
  ProxyLogEntry,
  ProxyStatus,
  ProxyWsServerEvent,
  SnapshotEvent,
} from "../api/types";

export const LIVE_LOG_LIMIT = 200;

export interface ProxyWebSocketState {
  instances: ProxyStatus[];
  status: ProxyStatus | null;
  activeGroupId?: string;
  activeGroupName?: string;
  liveLogsByInstance: Record<string, ProxyLogEntry[]>;
}

export const EMPTY_PROXY_WS_STATE: ProxyWebSocketState = {
  instances: [],
  status: null,
  activeGroupId: undefined,
  activeGroupName: undefined,
  liveLogsByInstance: {},
};

function getLogKey(entry: ProxyLogEntry): string {
  return JSON.stringify([
    entry.ts,
    entry.level,
    entry.msg,
    entry.method,
    entry.path,
    entry.status,
    entry.durationMs,
    entry.error,
    entry.stack,
  ]);
}

function dedupeStatuses(instances: ProxyStatus[]): ProxyStatus[] {
  const byId = new Map<string, ProxyStatus>();
  for (const instance of instances) {
    byId.set(instance.instanceId, instance);
  }
  return Array.from(byId.values());
}

function applyActiveGroupToInstance(
  instance: ProxyStatus,
  activeGroupId?: string,
  activeGroupName?: string,
): ProxyStatus {
  if (instance.groupName) {
    return {
      ...instance,
      activeGroup: instance.activeGroup,
      activeGroupName: instance.activeGroupName ?? instance.groupName,
    };
  }

  return {
    ...instance,
    activeGroup: activeGroupId ?? instance.activeGroup,
    activeGroupName: activeGroupName ?? instance.activeGroupName,
  };
}

function findDefaultStatus(instances: ProxyStatus[]): ProxyStatus | null {
  return instances.find((instance) => instance.instanceId === "default") ?? null;
}

function upsertInstance(instances: ProxyStatus[], nextInstance: ProxyStatus): ProxyStatus[] {
  const existingIndex = instances.findIndex((instance) => instance.instanceId === nextInstance.instanceId);
  if (existingIndex === -1) {
    return dedupeStatuses([...instances, nextInstance]);
  }

  const next = [...instances];
  next[existingIndex] = nextInstance;
  return dedupeStatuses(next);
}

function applySnapshot(
  state: ProxyWebSocketState,
  event: SnapshotEvent,
): ProxyWebSocketState {
  const instances = dedupeStatuses(
    event.instances.map((instance) => applyActiveGroupToInstance(instance, event.activeGroupId, event.activeGroupName)),
  );

  return {
    ...state,
    instances,
    status: findDefaultStatus(instances),
    activeGroupId: event.activeGroupId,
    activeGroupName: event.activeGroupName,
  };
}

function applyGroupChange(
  state: ProxyWebSocketState,
  event: GroupChangeEvent,
): ProxyWebSocketState {
  const instances = state.instances.map((instance) => {
    if (instance.groupName) {
      return instance;
    }

    return {
      ...instance,
      activeGroup: event.groupId,
      activeGroupName: event.groupName,
    };
  });

  return {
    ...state,
    instances,
    status: findDefaultStatus(instances),
    activeGroupId: event.groupId,
    activeGroupName: event.groupName,
  };
}

export function dedupeLogEntries(entries: ProxyLogEntry[]): ProxyLogEntry[] {
  const seen = new Set<string>();
  const deduped: ProxyLogEntry[] = [];

  for (const entry of entries) {
    const key = getLogKey(entry);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(entry);
  }

  return deduped;
}

export function mergeLogHistory(history: ProxyLogEntry[], live: ProxyLogEntry[]): ProxyLogEntry[] {
  return dedupeLogEntries([...history, ...live]);
}

export function applyProxyWsEvent(
  state: ProxyWebSocketState,
  event: ProxyWsServerEvent,
): ProxyWebSocketState {
  switch (event.type) {
    case "snapshot":
      return applySnapshot(state, event);
    case "status": {
      const nextInstance = applyActiveGroupToInstance(event.status, state.activeGroupId, state.activeGroupName);
      const instances = upsertInstance(state.instances, nextInstance);
      return {
        ...state,
        instances,
        status: findDefaultStatus(instances),
      };
    }
    case "instance.start": {
      const nextInstance = applyActiveGroupToInstance(event.status, state.activeGroupId, state.activeGroupName);
      const instances = upsertInstance(state.instances, nextInstance);
      return {
        ...state,
        instances,
        status: findDefaultStatus(instances),
      };
    }
    case "instance.stop": {
      const instances = state.instances.filter((instance) => instance.instanceId !== event.instanceId);
      const { [event.instanceId]: _removed, ...liveLogsByInstance } = state.liveLogsByInstance;
      return {
        ...state,
        instances,
        status: findDefaultStatus(instances),
        liveLogsByInstance,
      };
    }
    case "group.change":
      return applyGroupChange(state, event);
    case "log": {
      const nextEntries = dedupeLogEntries([
        ...(state.liveLogsByInstance[event.instanceId] ?? []),
        event.entry,
      ]).slice(-LIVE_LOG_LIMIT);

      return {
        ...state,
        liveLogsByInstance: {
          ...state.liveLogsByInstance,
          [event.instanceId]: nextEntries,
        },
      };
    }
  }
}
