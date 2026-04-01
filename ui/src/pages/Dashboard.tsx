import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useCoders } from "../hooks/useCoders";
import { useProfiles } from "../hooks/useProfiles";
import Card, { CardHeader, CardTitle, CardContent } from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";

export default function Dashboard() {
  const { coders, loading, error, applyProfile, setActiveProfile } = useCoders();
  const { profiles } = useProfiles();
  const navigate = useNavigate();

  // Track applying state per coder
  const [applying, setApplying] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ coder: string; success: boolean; warning?: boolean; message: string } | null>(null);

  // Track selected profile per coder (for dropdown)
  const [selectedProfiles, setSelectedProfiles] = useState<Record<string, string>>({});

  // Track timeout for clearing apply result toast
  const applyResultTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize selected profiles from coder active profiles
  useEffect(() => {
    const initial: Record<string, string> = {};
    coders.forEach((coder) => {
      if (coder.activeProfile) {
        initial[coder.id] = coder.activeProfile.name;
      }
    });
    setSelectedProfiles(initial);
  }, [coders]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (applyResultTimeoutRef.current) {
        clearTimeout(applyResultTimeoutRef.current);
      }
    };
  }, []);

  const handleProfileChange = async (coderId: string, profileName: string) => {
    setSelectedProfiles((prev) => ({ ...prev, [coderId]: profileName }));
    try {
      await setActiveProfile(coderId, profileName);
    } catch (err) {
      console.error("Failed to set active profile:", err);
    }
  };

  const handleApply = async (coderId: string) => {
    setApplying(coderId);
    setApplyResult(null);
    try {
      const result = await applyProfile(coderId);
      setApplyResult({ coder: coderId, success: result.success, warning: result.warning, message: result.message });
    } catch (err: any) {
      setApplyResult({ coder: coderId, success: false, message: err?.message || "Failed to apply" });
    } finally {
      setApplying(null);
      // Clear result after 5 seconds for warnings (longer to read), 3 seconds otherwise
      if (applyResultTimeoutRef.current) {
        clearTimeout(applyResultTimeoutRef.current);
      }
      applyResultTimeoutRef.current = setTimeout(() => setApplyResult(null), 3000);
    }
  };

  if (error) {
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

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page header */}
      <div className="border-b border-zinc-800 pb-6">
        <h2 className="font-mono font-bold text-2xl tracking-tight text-zinc-100">DASHBOARD</h2>
        <p className="text-zinc-500 text-sm mt-1 font-mono">
          Configure your AI coding assistants
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4 stagger-children">
        <div className="bg-zinc-900/50 border border-zinc-800 border-l-2 border-l-amber-500/50 p-4">
          <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">CODERS</p>
          <p className="text-3xl font-mono font-bold text-zinc-100 mt-1">{coders.length}</p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 border-l-2 border-l-emerald-500/50 p-4">
          <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">ACTIVE</p>
          <p className="text-3xl font-mono font-bold text-emerald-400 mt-1">
            {coders.filter((c) => c.activeProfile).length}
          </p>
        </div>
        <div className="bg-zinc-900/50 border border-zinc-800 border-l-2 border-l-yellow-500/50 p-4">
          <p className="text-zinc-500 text-xs font-mono uppercase tracking-wider">UNCONFIGURED</p>
          <p className="text-3xl font-mono font-bold text-yellow-400 mt-1">
            {coders.filter((c) => !c.activeProfile).length}
          </p>
        </div>
      </div>

      {/* Apply result toast */}
      {applyResult && (
        <div
          className={`p-4 rounded border ${
            applyResult.warning
              ? "bg-yellow-500/10 border-yellow-500/20 text-yellow-400"
              : applyResult.success
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
              : "bg-red-500/10 border-red-500/20 text-red-400"
          }`}
        >
          <p className="font-mono text-sm">
            {applyResult.warning ? "⚠" : applyResult.success ? "✓" : "✗"} {applyResult.message}
          </p>
        </div>
      )}

      {/* Coders grid */}
      <div>
        <h3 className="text-zinc-500 text-xs font-mono uppercase tracking-wider mb-4">
          INSTALLED CODERS
        </h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 stagger-children">
          {coders.map((coder) => {
            const currentProfileName = selectedProfiles[coder.id] || coder.activeProfile?.name;
            const isApplying = applying === coder.id;
            const resultForThisCoder = applyResult?.coder === coder.id ? applyResult : null;

            return (
              <Card key={coder.id} className="border-l-2 border-l-zinc-700 hover:border-l-amber-500/50 transition-colors">
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>{coder.displayName}</CardTitle>
                  <span
                    className={`status-dot ${
                      coder.activeProfile
                        ? "status-dot--active"
                        : "status-dot--inactive"
                    }`}
                  ></span>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Profile selector */}
                  <div>
                    <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
                      Active Profile
                    </label>
                    {profiles.length === 0 ? (
                      <button
                        onClick={() => navigate("/profiles")}
                        className="w-full px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded text-sm font-mono text-amber-400 hover:bg-amber-500/20 transition-colors text-left"
                      >
                        + Create your first profile
                      </button>
                    ) : (
                      <select
                        value={currentProfileName || ""}
                        onChange={(e) => handleProfileChange(coder.id, e.target.value)}
                        className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                      >
                        <option value="">Select profile...</option>
                        {profiles.map((profile) => (
                          <option key={profile.name} value={profile.name}>
                            {profile.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  {/* Current config preview */}
                  {coder.activeProfile ? (
                    <div className="space-y-3 pt-2 border-t border-zinc-800">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-500 font-mono text-xs">PROVIDER</span>
                        <Badge variant="primary">{coder.activeProfile.providerId}</Badge>
                      </div>
                      {coder.activeProfile.baseURL && (
                        <div className="flex items-center justify-between">
                          <span className="text-zinc-500 font-mono text-xs">ENDPOINT</span>
                          <span className="text-zinc-400 text-xs font-mono truncate max-w-[180px]">
                            {coder.activeProfile.baseURL}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-4 surface-warm rounded border border-dashed border-zinc-700">
                      <p className="text-zinc-500 font-mono text-xs">No profile selected</p>
                    </div>
                  )}

                  {/* Apply result feedback */}
                  {resultForThisCoder && (
                    <div
                      className={`text-xs font-mono p-2 rounded ${
                        resultForThisCoder.warning
                          ? "bg-yellow-500/10 text-yellow-400 border border-yellow-500/30"
                          : resultForThisCoder.success
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-red-500/10 text-red-400"
                      }`}
                    >
                      {resultForThisCoder.warning ? "⚠ " : resultForThisCoder.success ? "✓ " : "✗ "}
                      {resultForThisCoder.message}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="pt-3 border-t border-zinc-800 flex gap-2">
                    <Button
                      onClick={() => handleApply(coder.id)}
                      disabled={!coder.activeProfile || isApplying}
                      variant="primary"
                      size="sm"
                      className="flex-1"
                    >
                      {isApplying ? (
                        <span className="flex items-center gap-2">
                          <span className="w-3 h-3 border border-zinc-100/30 border-t-zinc-100 rounded-full animate-spin"></span>
                          APPLYING
                        </span>
                      ) : (
                        "APPLY"
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate("/profiles")}
                    >
                      PROFILES
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
