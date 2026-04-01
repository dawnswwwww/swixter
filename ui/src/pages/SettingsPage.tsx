import { useState } from "react";
import Card, { CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import Button from "../components/ui/Button";
import * as api from "../api/client";

export default function SettingsPage() {
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleExport = async (sanitize: boolean) => {
    setIsExporting(true);
    setMessage(null);
    try {
      const config = await api.exportConfig(sanitize);
      const blob = new Blob([config], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `swixter-config-${new Date().toISOString().split("T")[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setMessage({ type: "success", text: "Configuration exported successfully" });
    } catch (err) {
      setMessage({ type: "error", text: "Failed to export configuration" });
    } finally {
      setIsExporting(false);
    }
  };

  const handleReset = async () => {
    setIsResetting(true);
    setMessage(null);
    try {
      await api.resetConfig();
      setMessage({ type: "success", text: "All data has been reset" });
      setShowResetConfirm(false);
      window.location.reload();
    } catch (err) {
      setMessage({ type: "error", text: "Failed to reset data" });
    } finally {
      setIsResetting(false);
    }
  };

  const handleImport = async (overwrite: boolean) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setIsImporting(true);
      setMessage(null);
      try {
        const text = await file.text();
        const result = await api.importConfig(text, overwrite);
        if (result.success) {
          setMessage({ type: "success", text: `Imported ${result.message || "successfully"}` });
          window.location.reload();
        } else {
          setMessage({ type: "error", text: result.message || "Import failed" });
        }
      } catch (err: any) {
        setMessage({ type: "error", text: err?.message || "Failed to import configuration" });
      } finally {
        setIsImporting(false);
      }
    };
    input.click();
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div className="border-b border-zinc-800 pb-6">
        <h2 className="font-mono font-bold text-2xl tracking-tight text-zinc-100">SETTINGS</h2>
        <p className="text-zinc-500 text-sm mt-1 font-mono">
          Manage application configuration
        </p>
      </div>

      {/* Message */}
      {message && (
        <div
          className={`p-4 rounded border ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}
        >
          <p className="font-mono text-sm">{message.text}</p>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        {/* Import/Export */}
        <Card className="border-l-2 border-l-amber-500/50">
          <CardHeader>
            <CardTitle>Import / Export</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-zinc-400">
              Export your profiles to a file for backup, or import profiles from a previously exported file.
            </p>
            <div className="space-y-3 pt-2">
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => handleExport(false)} disabled={isExporting}>
                  {isExporting ? "..." : "EXPORT"}
                </Button>
                <Button variant="secondary" onClick={() => handleExport(true)} disabled={isExporting} title="API keys will be masked">
                  {isExporting ? "..." : "EXPORT (SANITIZED)"}
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                Sanitized export masks API keys (sk-***xyz) for safe sharing
              </p>
              <div className="flex gap-3 pt-2 border-t border-zinc-800">
                <Button variant="secondary" onClick={() => handleImport(false)} disabled={isImporting}>
                  {isImporting ? "..." : "IMPORT (MERGE)"}
                </Button>
                <Button variant="secondary" onClick={() => handleImport(true)} disabled={isImporting}>
                  {isImporting ? "..." : "IMPORT (OVERWRITE)"}
                </Button>
              </div>
              <p className="text-xs text-zinc-500">
                Merge: keep existing profiles. Overwrite: replace all with imported profiles.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* About */}
        <Card className="border-l-2 border-l-emerald-500/50">
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-mono">Version</span>
                <span className="text-zinc-200 font-mono">v0.0.11</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-mono">Platform</span>
                <span className="text-zinc-200 font-mono">macOS</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-zinc-500 font-mono">Config</span>
                <span className="text-zinc-400 font-mono text-xs">~/.config/swixter/</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Danger zone */}
      <Card className="border-red-500/30 border-dashed">
        <CardHeader>
          <CardTitle className="text-red-400">Danger Zone</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-zinc-400 mb-4">
            These actions are irreversible. Proceed with caution.
          </p>
          {showResetConfirm ? (
            <div className="flex items-center gap-3">
              <p className="text-sm text-red-400 font-mono">Are you sure? This will delete all profiles.</p>
              <Button
                variant="destructive"
                onClick={handleReset}
                disabled={isResetting}
              >
                {isResetting ? "RESETTING..." : "CONFIRM RESET"}
              </Button>
              <Button variant="ghost" onClick={() => setShowResetConfirm(false)}>
                CANCEL
              </Button>
            </div>
          ) : (
            <Button variant="destructive" onClick={() => setShowResetConfirm(true)}>
              RESET ALL DATA
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
