import { useState } from "react";
import { useProfiles } from "../hooks/useProfiles";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Modal from "../components/ui/Modal";
import type { ClaudeCodeProfile } from "../api/types";

export default function ProfilesPage() {
  const { profiles, loading, error, createProfile, updateProfile, deleteProfile } = useProfiles();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [editingProfile, setEditingProfile] = useState<ClaudeCodeProfile | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const handleOpenCreate = () => {
    setModalMode("create");
    setEditingProfile(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (profile: ClaudeCodeProfile) => {
    setModalMode("edit");
    setEditingProfile(profile);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingProfile(null);
  };

  const handleSubmit = async (data: {
    name: string;
    providerId: string;
    apiKey: string;
    baseURL: string;
    model: string;
  }) => {
    setIsSubmitting(true);
    try {
      if (modalMode === "create") {
        await createProfile({
          name: data.name,
          providerId: data.providerId,
          apiKey: data.apiKey,
          baseURL: data.baseURL || undefined,
          model: data.model || undefined,
        });
      } else if (editingProfile) {
        await updateProfile(editingProfile.name, {
          apiKey: data.apiKey,
          baseURL: data.baseURL || undefined,
          model: data.model || undefined,
        });
      }
      handleCloseModal();
    } catch (err) {
      console.error("Failed to save profile:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      await deleteProfile(name);
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete profile:", err);
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
      <div className="flex items-center justify-between border-b border-zinc-800 pb-6">
        <div>
          <h2 className="font-mono font-bold text-2xl tracking-tight text-zinc-100">PROFILES</h2>
          <p className="text-zinc-500 text-sm mt-1 font-mono">
            {profiles.length} configuration{profiles.length !== 1 ? "s" : ""} stored
          </p>
        </div>
        <Button variant="primary" onClick={handleOpenCreate}>+ NEW PROFILE</Button>
      </div>

      {/* Table */}
      {profiles.length === 0 ? (
        <Card className="p-16 text-center border-amber-500/20 border-dashed">
          <div className="max-w-sm mx-auto">
            <div className="w-16 h-16 rounded-lg bg-amber-500/10 border border-amber-500/20 mx-auto mb-6 flex items-center justify-center">
              <span className="text-amber-500 font-mono text-2xl">[]</span>
            </div>
            <h3 className="font-mono font-semibold text-zinc-200 mb-2">No Profiles</h3>
            <p className="text-zinc-500 text-sm font-mono mb-6">
              Create your first profile to start managing AI coder configurations
            </p>
            <Button variant="primary" onClick={handleOpenCreate}>CREATE PROFILE</Button>
          </div>
        </Card>
      ) : (
        <Card variant="elevated" className="overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900/50">
                <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Provider
                </th>
                <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Endpoint
                </th>
                <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Last Modified
                </th>
                <th className="px-5 py-3 text-right text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {profiles.map((profile) => (
                <tr
                  key={profile.name}
                  className="bg-zinc-900/30 hover:bg-zinc-900/60 transition-colors"
                >
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <span className="status-dot status-dot--active"></span>
                      <span className="font-mono font-medium text-zinc-200">
                        {profile.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant="primary">{profile.providerId}</Badge>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-zinc-400 font-mono truncate max-w-[250px] block">
                      {profile.baseURL || "—"}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-zinc-500 font-mono">
                      {new Date(profile.updatedAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(profile)}>
                        EDIT
                      </Button>
                      {deleteConfirm === profile.name ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(profile.name)}
                          >
                            CONFIRM
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>
                            CANCEL
                          </Button>
                        </div>
                      ) : (
                        <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(profile.name)}>
                          DEL
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        profile={editingProfile}
        mode={modalMode}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
