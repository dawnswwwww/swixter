import type WebSocket from "ws";
import { subscribe, type ProxyEvent } from "./events.js";
import { listProxyInstances } from "../proxy/server.js";
import { getActiveGroup } from "../groups/manager.js";

export interface SnapshotPayload {
  type: "snapshot";
  instances: ReturnType<typeof listProxyInstances>;
  activeGroupId?: string;
  activeGroupName?: string;
}

export class WsManager {
  private clients = new Set<WebSocket>();
  private unsubscribe: (() => void) | null = null;

  start(): void {
    this.unsubscribe = subscribe((event: ProxyEvent) => {
      this.broadcast(event);
    });
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const client of this.clients) {
      try {
        client.close();
      } catch {
        // Already closed.
      }
    }
    this.clients.clear();
  }

  async addClient(ws: WebSocket): Promise<void> {
    this.clients.add(ws);
    await this.sendSnapshot(ws);
  }

  removeClient(ws: WebSocket): void {
    this.clients.delete(ws);
  }

  private async sendSnapshot(ws: WebSocket): Promise<void> {
    const instances = listProxyInstances();

    let activeGroupId: string | undefined;
    let activeGroupName: string | undefined;
    try {
      const active = await getActiveGroup();
      if (active) {
        activeGroupId = active.id;
        activeGroupName = active.name;
      }
    } catch {
      // Active group may not be available yet.
    }

    const snapshot: SnapshotPayload = {
      type: "snapshot",
      instances,
      activeGroupId,
      activeGroupName,
    };

    this.sendTo(ws, snapshot);
  }

  private broadcast(event: ProxyEvent): void {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        client.send(data);
      } catch {
        // Send failed; remove stale client.
        this.clients.delete(client);
      }
    }
  }

  private sendTo(ws: WebSocket, payload: SnapshotPayload): void {
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // Client already gone.
    }
  }
}
