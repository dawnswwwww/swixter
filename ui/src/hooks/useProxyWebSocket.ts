import { useState, useEffect, useRef, useCallback } from "react";
import type {
  ProxyLogEntry,
  ProxyStatus,
  ProxyWsConnectionState,
  ProxyWsServerEvent,
} from "../api/types";
import {
  applyProxyWsEvent,
  type ProxyWebSocketState,
  EMPTY_PROXY_WS_STATE,
} from "./proxy-websocket-state";
import * as api from "../api/client";

const RECONNECT_DELAY_MS = 1000;

export interface UseProxyWebSocketResult {
  connected: ProxyWsConnectionState;
  instances: ProxyStatus[];
  status: ProxyStatus | null;
  activeGroupId?: string;
  activeGroupName?: string;
  liveLogsByInstance: Record<string, ProxyLogEntry[]>;
  refresh: () => Promise<void>;
  startProxy: (options?: { host?: string; port?: number }) => Promise<ProxyStatus>;
  stopProxy: (instanceId?: string) => Promise<void>;
}

export function useProxyWebSocket(): UseProxyWebSocketResult {
  const [wsState, setWsState] = useState<ProxyWebSocketState>(EMPTY_PROXY_WS_STATE);
  const [connected, setConnected] = useState<ProxyWsConnectionState>("disconnected");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    if (wsRef.current && wsRef.current.readyState === WebSocket.CONNECTING) return;

    setConnected("connecting");

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnected("connected");
    };

    ws.onmessage = (event) => {
      if (!mountedRef.current) return;
      try {
        const data = JSON.parse(event.data) as ProxyWsServerEvent;
        setWsState((prev) => applyProxyWsEvent(prev, data));
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setConnected("reconnecting");
      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) connect();
      }, RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }, []);

  // Bootstrap: REST fallback + WS connect
  const refresh = useCallback(async () => {
    try {
      const [, allInstances] = await Promise.all([
        api.fetchProxyStatus(),
        api.fetchProxyInstances(),
      ]);
      // Apply as a snapshot-like update
      setWsState((prev) => ({
        ...prev,
        instances: allInstances,
        status: allInstances.find((i) => i.instanceId === "default") ?? null,
      }));
    } catch {
      // REST fallback failure is OK if WS is connected
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, refresh]);

  // Re-bootstrap on reconnect
  useEffect(() => {
    if (connected === "connected") {
      refresh();
    }
  }, [connected, refresh]);

  const startProxy = useCallback(async (options?: { host?: string; port?: number }) => {
    return api.startProxy(options);
  }, []);

  const stopProxy = useCallback(async (instanceId?: string) => {
    await api.stopProxy(instanceId);
  }, []);

  return {
    connected,
    instances: wsState.instances,
    status: wsState.status,
    activeGroupId: wsState.activeGroupId,
    activeGroupName: wsState.activeGroupName,
    liveLogsByInstance: wsState.liveLogsByInstance,
    refresh,
    startProxy,
    stopProxy,
  };
}
