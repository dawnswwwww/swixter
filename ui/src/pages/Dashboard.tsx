import { useCoders } from "../hooks/useCoders";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";

export default function Dashboard() {
  const { coders, loading, error, applyProfile } = useCoders();

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-destructive">Error: {error.message}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Dashboard</h2>
        <p className="text-muted-foreground">Manage your AI coder configurations</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {coders.map((coder) => (
          <Card key={coder.id} className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold">{coder.displayName}</h3>
              <p className="text-sm text-muted-foreground">
                {coder.activeProfile ? (
                  <>Active: {coder.activeProfile.name}</>
                ) : (
                  <>No active profile</>
                )}
              </p>
            </div>

            {coder.activeProfile && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Provider:</span>
                  <Badge variant="primary">{coder.activeProfile.providerId}</Badge>
                </div>
                {coder.activeProfile.baseURL && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Base URL:</span>
                    <span className="font-medium text-xs truncate max-w-[200px]">
                      {coder.activeProfile.baseURL}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => applyProfile(coder.id)}
                disabled={!coder.activeProfile}
                variant="primary"
              >
                Apply
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
