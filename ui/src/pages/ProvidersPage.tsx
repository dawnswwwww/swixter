import { useProviders } from "../hooks/useProviders";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";

export default function ProvidersPage() {
  const { providers, loading, error } = useProviders();

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Providers</h2>
          <p className="text-muted-foreground">Manage API providers</p>
        </div>
        <Button variant="primary">Add Provider</Button>
      </div>

      <div className="border rounded-lg bg-card">
        <table className="w-full">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium">Name</th>
              <th className="px-6 py-3 text-left text-sm font-medium">Display Name</th>
              <th className="px-6 py-3 text-left text-sm font-medium">Type</th>
              <th className="px-6 py-3 text-left text-sm font-medium">Base URL</th>
            </tr>
          </thead>
          <tbody>
            {providers.map((provider) => (
              <tr key={provider.id} className="border-b hover:bg-muted/30">
                <td className="px-6 py-4 font-medium">{provider.name}</td>
                <td className="px-6 py-4">{provider.displayName}</td>
                <td className="px-6 py-4">
                  {provider.isUser ? (
                    <Badge variant="success">User-defined</Badge>
                  ) : (
                    <Badge variant="default">Built-in</Badge>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-muted-foreground truncate max-w-[300px]">
                  {provider.baseURL || "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
