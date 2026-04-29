import { useProxyWebSocket } from "./useProxyWebSocket";

/**
 * Backward-compatible hook wrapping useProxyWebSocket.
 * Keeps the same return shape so existing consumers don't break.
 */
export function useProxyStatus() {
  const {
    connected,
    instances,
    status,
    refresh,
    startProxy: wsStartProxy,
    stopProxy: wsStopProxy,
  } = useProxyWebSocket();

  const loading = connected === "connecting" || connected === "disconnected";
  const error = connected === "reconnecting" ? new Error("Reconnecting...") : null;

  const startProxy = async (options?: { host?: string; port?: number }) => {
    return wsStartProxy(options);
  };

  const stopProxy = async (instanceId?: string) => {
    return wsStopProxy(instanceId);
  };

  return {
    status,
    instances,
    loading,
    error,
    actionLoading: false,
    refresh,
    startProxy,
    stopProxy,
  };
}
