import Button from "../components/ui/Button";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-muted-foreground">Manage your configuration</p>
      </div>

      <div className="space-y-6">
        <section className="border rounded-lg p-6 bg-card">
          <h3 className="text-lg font-semibold mb-4">Import/Export</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Export your profiles to a file for backup or import profiles from a file.
          </p>
          <div className="flex gap-4">
            <Button variant="outline">Export Configuration</Button>
            <Button variant="outline">Import Configuration</Button>
          </div>
        </section>

        <section className="border rounded-lg p-6 bg-card">
          <h3 className="text-lg font-semibold mb-4">About</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Version:</span>
              <span>0.0.9</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Config Path:</span>
              <span className="text-xs">~/.config/swixter/</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
