import { useProfiles } from "../hooks/useProfiles";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";

export default function ProfilesPage() {
  const { profiles, loading, error } = useProfiles();

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
          <h2 className="text-2xl font-bold">Profiles</h2>
          <p className="text-muted-foreground">Manage your configuration profiles</p>
        </div>
        <Button variant="primary">Create Profile</Button>
      </div>

      <Card className="p-0 overflow-hidden">
        {profiles.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <p>No profiles yet. Create your first profile to get started.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium">Name</th>
                <th className="px-6 py-3 text-left text-sm font-medium">Provider</th>
                <th className="px-6 py-3 text-left text-sm font-medium">Base URL</th>
                <th className="px-6 py-3 text-left text-sm font-medium">Updated</th>
                <th className="px-6 py-3 text-right text-sm font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {profiles.map((profile) => (
                <tr key={profile.name} className="border-b hover:bg-muted/30">
                  <td className="px-6 py-4 font-medium">{profile.name}</td>
                  <td className="px-6 py-4">
                    <Badge variant="primary">{profile.providerId}</Badge>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground truncate max-w-[300px]">
                    {profile.baseURL || "-"}
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">
                    {new Date(profile.updatedAt).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button className="text-sm text-primary hover:underline mr-4">
                      Edit
                    </button>
                    <button className="text-sm text-destructive hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
