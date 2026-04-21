import type { ProxyStatus } from "../proxy/types.js";
import type { ProxyLogEntry } from "../../ui/src/api/types.js";

export interface LogEvent {
  type: "log";
  instanceId: string;
  entry: ProxyLogEntry;
}

export interface StatusEvent {
  type: "status";
  status: ProxyStatus;
}

export interface InstanceStartEvent {
  type: "instance.start";
  status: ProxyStatus;
}

export interface InstanceStopEvent {
  type: "instance.stop";
  instanceId: string;
}

export interface GroupChangeEvent {
  type: "group.change";
  groupId: string;
  groupName: string;
}

export type ProxyEvent =
  | LogEvent
  | StatusEvent
  | InstanceStartEvent
  | InstanceStopEvent
  | GroupChangeEvent;

type EventHandler = (event: ProxyEvent) => void;

const handlers = new Set<EventHandler>();

export function subscribe(handler: EventHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

function emit(event: ProxyEvent): void {
  for (const handler of handlers) {
    try {
      handler(event);
    } catch {
      // Subscriber errors must never break the emitter.
    }
  }
}

export function emitLog(instanceId: string, entry: ProxyLogEntry): void {
  emit({ type: "log", instanceId, entry });
}

export function emitStatusUpdate(status: ProxyStatus): void {
  emit({ type: "status", status });
}

export function emitInstanceStart(status: ProxyStatus): void {
  emit({ type: "instance.start", status });
}

export function emitInstanceStop(instanceId: string): void {
  emit({ type: "instance.stop", instanceId });
}

export function emitGroupChange(groupId: string, groupName: string): void {
  emit({ type: "group.change", groupId, groupName });
}
