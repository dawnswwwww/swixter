import { useState, useEffect, useRef, useCallback } from "react";
import { useProxyWebSocket } from "../hooks/useProxyWebSocket";
import { useGroups } from "../hooks/useGroups";
import * as api from "../api/client";
import { mergeLogHistory } from "../hooks/proxy-websocket-state";
import type { ProxyLogEntry, ProxyInstanceType } from "../api/types";
import Card, { CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";

export default function ProxyPage() {
  const {
    connected,
    instances,
    status,
    liveLogsByInstance,
    startProxy,
    stopProxy,
  } = useProxyWebSocket();
  const { groups, setActiveGroup } = useGroups();
  const loading = connected === "connecting" || connected === "disconnected";
  const error = connected === "reconnecting" ? new Error("Reconnecting...") : null;
  const [actionLoading, setActionLoading] = useState(false);
  const [toast, setToast] = useState<{ type: "ok" | "err"; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const showToast = (type: "ok" | "err", message: string) => {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  };

  const handleStart = async () => {
    setActionLoading(true);
    try {
      await startProxy();
      showToast("ok", "Proxy server started");
    } catch (err: any) {
      showToast("err", err?.message || "Failed to start proxy");
    } finally {
      setActionLoading(false);
    }
  };

  const handleStop = async (instanceId?: string) => {
    setActionLoading(true);
    try {
      await stopProxy(instanceId);
      showToast("ok", instanceId ? `Instance "${instanceId}" stopped` : "Proxy server stopped");
    } catch (err: any) {
      showToast("err", err?.message || "Failed to stop proxy");
    } finally {
      setActionLoading(false);
    }
  };

  const handleGroupChange = async (groupId: string) => {
    try {
      await setActiveGroup(groupId);
      showToast("ok", "Active group updated");
    } catch (err: any) {
      showToast("err", err?.message || "Failed to set active group");
    }
  };

  if (error && !status) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center surface-error border border-red-500/20 rounded p-8 max-w-md">
          <p className="text-red-400 font-mono text-sm mb-2">ERROR</p>
          <p className="text-zinc-400">{error.message}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-zinc-500 mt-4 font-mono text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  const isRunning = status?.running ?? false;
  const runningInstances = instances.filter((i) => i.running);
  const currentActiveGroupId = groups.find(
    (g) => g.name === status?.activeGroupName || g.id === status?.activeGroup
  )?.id;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div className="border-b border-zinc-800 pb-6">
        <h2 className="font-mono font-bold text-2xl tracking-tight text-zinc-100">PROXY</h2>
        <p className="text-zinc-500 text-sm mt-1 font-mono">
          Manage the local proxy server
        </p>
        <span className={`mt-2 inline-flex items-center gap-1.5 font-mono text-xs ${
          connected === "connected" ? "text-emerald-400" :
          connected === "reconnecting" ? "text-amber-400" :
          "text-zinc-500"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            connected === "connected" ? "bg-emerald-400" :
            connected === "reconnecting" ? "bg-amber-400 animate-pulse" :
            "bg-zinc-600"
          }`}></span>
          WS: {connected === "connected" ? "CONNECTED" : connected === "reconnecting" ? "RECONNECTING" : "DISCONNECTED"}
        </span>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`p-4 rounded border ${
            toast.type === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}
        >
          <p className="font-mono text-sm">
            {toast.type === "ok" ? "✓" : "✗"} {toast.message}
          </p>
        </div>
      )}

      {/* Default service controls */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Service (default)</CardTitle>
          <Badge variant={isRunning ? "success" : "neutral"}>
            {isRunning ? "RUNNING" : "STOPPED"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {isRunning ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">ADDRESS</p>
                  <p className="text-zinc-100 font-mono text-sm mt-1">
                    {status!.host}:{status!.port}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">GROUP</p>
                  <p className="text-zinc-100 font-mono text-sm mt-1">
                    {status!.groupName || status!.activeGroupName || "none"}
                  </p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">PID</p>
                  <p className="text-zinc-100 font-mono text-sm mt-1">{status!.pid ?? "—"}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">STARTED</p>
                  <p className="text-zinc-100 font-mono text-sm mt-1">
                    {status!.startTime ? new Date(status!.startTime).toLocaleTimeString() : "—"}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-3 border-t border-zinc-800">
                <div>
                  <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">REQUESTS</p>
                  <p className="text-3xl font-mono font-bold text-zinc-100 mt-1">{status!.requestCount}</p>
                </div>
                <div>
                  <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">ERRORS</p>
                  <p className={`text-3xl font-mono font-bold mt-1 ${status!.errorCount > 0 ? "text-red-400" : "text-zinc-100"}`}>
                    {status!.errorCount}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 surface-warm rounded border border-dashed border-zinc-700">
              <p className="text-zinc-500 font-mono text-xs">Proxy service is not running</p>
            </div>
          )}
          <div className="flex gap-3 pt-3 border-t border-zinc-800">
            <Button
              variant="primary"
              onClick={handleStart}
              disabled={isRunning || actionLoading}
            >
              {actionLoading && !isRunning ? (
                <span className="flex items-center gap-2">
                  <span className="w-3 h-3 border border-zinc-100/30 border-t-zinc-100 rounded-full animate-spin"></span>
                  STARTING
                </span>
              ) : "START"}
            </Button>
            <Button
              variant="destructive"
              onClick={() => handleStop("default")}
              disabled={!isRunning || actionLoading}
            >
              STOP
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Run instances */}
      {runningInstances.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Run Instances</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-zinc-800">
              {runningInstances
                .filter((i) => i.instanceId !== "default")
                .map((inst) => (
                  <div key={inst.instanceId} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-4">
                      <Badge variant={inst.type === "service" ? "primary" : "warning"}>
                        {inst.type}
                      </Badge>
                      <div>
                        <p className="text-zinc-200 font-mono text-sm">{inst.instanceId}</p>
                        <p className="text-zinc-500 font-mono text-xs">
                          {inst.host}:{inst.port} | Group: {inst.groupName || "none"} | {inst.requestCount} req | {inst.errorCount} err
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => handleStop(inst.instanceId)}
                      disabled={actionLoading}
                    >
                      STOP
                    </Button>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Group Selector */}
      {groups.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Active Group</CardTitle>
          </CardHeader>
          <CardContent>
            <select
              value={currentActiveGroupId || ""}
              onChange={(e) => handleGroupChange(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="">Select group...</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.profiles.length} profiles){g.isDefault ? " [default]" : ""}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}

      {/* Proxy Logs */}
      <ProxyLogViewer instances={runningInstances} liveLogsByInstance={liveLogsByInstance} />

      {/* Endpoints reference */}
      {isRunning && (
        <Card>
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {[
                { path: "/v1/chat/completions", desc: "OpenAI Chat" },
                { path: "/v1/messages", desc: "Anthropic Messages" },
                { path: "/v1/responses", desc: "Anthropic Responses" },
                { path: "/anthropic/*", desc: "Anthropic Compatible" },
                { path: "/health", desc: "Health Check" },
              ].map((ep) => (
                <div key={ep.path} className="flex items-center justify-between py-1.5">
                  <span className="text-zinc-100 font-mono text-sm">{ep.path}</span>
                  <span className="text-zinc-500 font-mono text-xs">{ep.desc}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proxy Log Viewer with instance selector
// ---------------------------------------------------------------------------

function ProxyLogViewer({ instances, liveLogsByInstance }: {
    instances: { instanceId: string; type: ProxyInstanceType }[];
    liveLogsByInstance: Record<string, ProxyLogEntry[]>;
  }) {
  const [historyLogs, setHistoryLogs] = useState<ProxyLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [logsLoading, setLogsLoading] = useState(false);
  const [linesCount, setLinesCount] = useState(200);
  const [selectedInstance, setSelectedInstance] = useState<string>("default");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHistory = useCallback(async () => {
    try {
      const res = await api.fetchProxyLogs(linesCount, selectedInstance);
      setHistoryLogs(res.lines);
      setTotal(res.total);
    } catch {
      // Silently fail
    }
  }, [linesCount, selectedInstance]);

  // Fetch on param change
  useEffect(() => {
    setLogsLoading(true);
    fetchHistory().finally(() => setLogsLoading(false));
  }, [fetchHistory]);

  // Auto-refresh history every 3s as fallback for cross-process proxy instances
  // (WS events only work for proxies started within the Web UI process)
  useEffect(() => {
    pollRef.current = setInterval(fetchHistory, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [fetchHistory]);

  // Merge REST history with live WS logs
  const liveLogs = liveLogsByInstance[selectedInstance] ?? [];
  const logs = mergeLogHistory(historyLogs, liveLogs);

  const levelColor = (level: string) => {
    switch (level) {
      case "error": return "text-red-400";
      case "warn": return "text-yellow-400";
      case "access": return "text-blue-400";
      default: return "text-zinc-300";
    }
  };

  const formatTime = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString(); } catch { return ts; }
  };

  const formatEntry = (entry: ProxyLogEntry) => {
    if (entry.level === "access") {
      return `${entry.method} ${entry.path} ${entry.status} (${entry.durationMs}ms)`;
    }
    return entry.msg;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Proxy Logs</CardTitle>
        <div className="flex items-center gap-3">
          {/* Instance selector */}
          {instances.length > 1 && (
            <select
              value={selectedInstance}
              onChange={(e) => setSelectedInstance(e.target.value)}
              className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs font-mono text-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              {instances.map((inst) => (
                <option key={inst.instanceId} value={inst.instanceId}>
                  {inst.instanceId} ({inst.type})
                </option>
              ))}
            </select>
          )}
          <select
            value={linesCount}
            onChange={(e) => setLinesCount(Number(e.target.value))}
            className="px-2 py-1 bg-zinc-950 border border-zinc-700 rounded text-xs font-mono text-zinc-300 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
          >
            <option value={50}>50 lines</option>
            <option value={100}>100 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
          </select>
          <Button variant="ghost" size="sm" onClick={fetchHistory} disabled={logsLoading}>
            {logsLoading ? "..." : "REFRESH"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <div className="text-center py-8 border border-dashed border-zinc-700 rounded">
            <p className="text-zinc-600 font-mono text-xs">
              {total === 0 ? "No logs yet" : "No logs matching filter"}
            </p>
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-0.5 font-mono text-xs">
            {logs.map((entry, i) => (
              <div key={i} className={`flex gap-3 py-1 ${levelColor(entry.level)}`}>
                <span className="text-zinc-600 shrink-0">{formatTime(entry.ts)}</span>
                <span className={`shrink-0 uppercase w-14 ${
                  entry.level === "error" ? "text-red-500" :
                  entry.level === "warn" ? "text-yellow-500" :
                  entry.level === "access" ? "text-blue-500" :
                  "text-zinc-600"
                }`}>
                  {entry.level}
                </span>
                <span className="break-all">{formatEntry(entry)}</span>
              </div>
            ))}
          </div>
        )}
        {total > 0 && (
          <p className="text-zinc-600 font-mono text-xs mt-3">
            Showing {logs.length} of {total} total log entries [{selectedInstance}]
          </p>
        )}
      </CardContent>
    </Card>
  );
}
