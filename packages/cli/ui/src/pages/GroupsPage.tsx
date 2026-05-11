import { useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useGroups } from "../hooks/useGroups";
import { useProfiles } from "../hooks/useProfiles";
import type { Group, ClaudeCodeProfile } from "../api/types";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function GroupsPage() {
  const { groups, loading, error, createGroup, updateGroup, deleteGroup } = useGroups();
  const { profiles } = useProfiles();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Group detail / profile ordering
  const [detailGroup, setDetailGroup] = useState<Group | null>(null);

  const handleCreate = async (data: { name: string; profiles: string[] }) => {
    setIsSubmitting(true);
    try {
      await createGroup(data);
      setIsModalOpen(false);
    } catch (err) {
      console.error("Failed to create group:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async (id: string, data: { name?: string; profiles?: string[]; isDefault?: boolean }) => {
    setIsSubmitting(true);
    try {
      await updateGroup(id, data);
      setEditingGroup(null);
      setIsModalOpen(false);
    } catch (err) {
      console.error("Failed to update group:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteGroup(id);
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete group:", err);
    }
  };

  const openEdit = (group: Group) => {
    setEditingGroup(group);
    setIsModalOpen(true);
  };

  const openCreate = () => {
    setEditingGroup(null);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingGroup(null);
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
          <h2 className="font-mono font-bold text-2xl tracking-tight text-zinc-100">GROUPS</h2>
          <p className="text-zinc-500 text-sm mt-1 font-mono">
            {groups.length} group{groups.length !== 1 ? "s" : ""} configured
          </p>
        </div>
        <Button variant="primary" onClick={openCreate}>+ NEW GROUP</Button>
      </div>

      {/* Groups table */}
      {groups.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-zinc-500 font-mono text-sm">No groups yet</p>
            <p className="text-zinc-600 font-mono text-xs mt-2">
              Create a group to organize profiles for proxy failover
            </p>
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
                  Profiles
                </th>
                <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Default
                </th>
                <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Updated
                </th>
                <th className="px-5 py-3 text-right text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {groups.map((group) => (
                <tr
                  key={group.id}
                  className="bg-zinc-900/30 hover:bg-zinc-900/60 transition-colors"
                >
                  <td className="px-5 py-4">
                    <button
                      onClick={() => setDetailGroup(group)}
                      className="font-mono font-medium text-amber-400 text-sm hover:text-amber-300 transition-colors"
                    >
                      {group.name}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    <Badge variant="neutral">
                      {group.profiles.length} profile{group.profiles.length !== 1 ? "s" : ""}
                    </Badge>
                  </td>
                  <td className="px-5 py-4">
                    {group.isDefault ? (
                      <Badge variant="primary">Default</Badge>
                    ) : (
                      <span className="text-zinc-600 text-xs font-mono">—</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-zinc-500 font-mono">
                      {new Date(group.updatedAt).toLocaleDateString()}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(group)}>
                        EDIT
                      </Button>
                      {deleteConfirm === group.id ? (
                        <div className="flex items-center gap-2">
                          <Button variant="destructive" size="sm" onClick={() => handleDelete(group.id)}>
                            CONFIRM
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>
                            CANCEL
                          </Button>
                        </div>
                      ) : (
                        <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(group.id)}>
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

      {/* Create/Edit Group Modal */}
      <GroupFormModal
        key={editingGroup?.id ?? "new"}
        isOpen={isModalOpen}
        onClose={closeModal}
        onSubmit={editingGroup
          ? (data) => handleUpdate(editingGroup.id, data)
          : handleCreate
        }
        isSubmitting={isSubmitting}
        group={editingGroup}
        profiles={profiles}
      />

      {/* Group Detail / Profile Ordering Modal */}
      {detailGroup && (
        <GroupDetailModal
          group={detailGroup}
          profiles={profiles}
          onClose={() => setDetailGroup(null)}
          onUpdate={async (id, profiles) => {
            await updateGroup(id, { profiles });
            // Refresh the detail group with updated data
            setDetailGroup((prev) => prev ? { ...prev, profiles } : null);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Form Modal (Create / Edit)
// ---------------------------------------------------------------------------

interface GroupFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { name: string; profiles: string[] }) => Promise<void>;
  isSubmitting: boolean;
  group: Group | null;
  profiles: ClaudeCodeProfile[];
}

function GroupFormModal({ isOpen, onClose, onSubmit, isSubmitting, group, profiles }: GroupFormModalProps) {
  const [name, setName] = useState(group?.name || "");
  const [selected, setSelected] = useState<string[]>(group?.profiles || []);
  const [nameError, setNameError] = useState("");

  if (!isOpen) return null;

  const validate = (): boolean => {
    if (!name.trim()) {
      setNameError("Name is required");
      return false;
    }
    setNameError("");
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit({ name: name.trim(), profiles: selected });
  };

  const toggleProfile = (profileName: string) => {
    setSelected((prev) =>
      prev.includes(profileName)
        ? prev.filter((p) => p !== profileName)
        : [...prev, profileName]
    );
  };

  const isEditing = !!group;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-md mx-4 shadow-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <h2 className="font-mono font-semibold text-zinc-100">
            {isEditing ? "EDIT GROUP" : "NEW GROUP"}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Group Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setNameError(""); }}
              placeholder="my-group"
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                nameError ? "border-red-500" : "border-zinc-700"
              }`}
            />
            {nameError && <p className="mt-1 text-xs text-red-400">{nameError}</p>}
          </div>

          {/* Profile selection */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Profiles (failover order)
            </label>
            {profiles.length === 0 ? (
              <p className="text-zinc-600 font-mono text-xs">No profiles available</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {profiles.map((profile) => (
                  <label
                    key={profile.name}
                    className="flex items-center gap-3 px-3 py-2 rounded hover:bg-zinc-800/50 cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selected.includes(profile.name)}
                      onChange={() => toggleProfile(profile.name)}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-950 text-amber-500 focus:ring-amber-500/50"
                    />
                    <span className="text-sm text-zinc-200 font-mono">{profile.name}</span>
                    <Badge variant="neutral">{profile.providerId}</Badge>
                  </label>
                ))}
              </div>
            )}
            {selected.length > 0 && (
              <p className="mt-2 text-xs text-zinc-500 font-mono">
                Selected: {selected.join(", ")}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4 shrink-0">
            <Button type="button" variant="ghost" onClick={onClose}>
              CANCEL
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "SAVING..." : isEditing ? "UPDATE" : "CREATE"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group Detail Modal with DnD Profile Ordering
// ---------------------------------------------------------------------------

interface GroupDetailModalProps {
  group: Group;
  profiles: ClaudeCodeProfile[];
  onClose: () => void;
  onUpdate: (id: string, profiles: string[]) => Promise<void>;
}

function SortableProfileItem({ id, label, providerId }: { id: string; label: string; providerId: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2.5 bg-zinc-900/50 border border-zinc-800 rounded group"
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-zinc-600 hover:text-zinc-300 cursor-grab active:cursor-grabbing transition-colors touch-none"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="5" cy="3" r="1.5" />
          <circle cx="11" cy="3" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="13" r="1.5" />
          <circle cx="11" cy="13" r="1.5" />
        </svg>
      </button>
      <span className="text-sm text-zinc-200 font-mono flex-1">{label}</span>
      <Badge variant="neutral">{providerId}</Badge>
    </div>
  );
}

function GroupDetailModal({ group, profiles, onClose, onUpdate }: GroupDetailModalProps) {
  const [items, setItems] = useState<string[]>(group.profiles);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const newItems = arrayMove(items, items.indexOf(String(active.id)), items.indexOf(String(over.id)));
    setItems(newItems);

    setSaving(true);
    try {
      await onUpdate(group.id, newItems);
    } catch (err) {
      console.error("Failed to reorder profiles:", err);
      setItems(group.profiles);
    } finally {
      setSaving(false);
    }
  };

  const getProfileMeta = (name: string) => {
    const p = profiles.find((pr) => pr.name === name);
    return { label: name, providerId: p?.providerId || "unknown" };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <div>
            <h2 className="font-mono font-semibold text-zinc-100">{group.name}</h2>
            <p className="text-zinc-500 text-xs font-mono mt-0.5">Drag to reorder failover priority</p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Sortable profile list */}
        <div className="p-6">
          {items.length === 0 ? (
            <p className="text-zinc-600 font-mono text-xs text-center py-4">No profiles in this group</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={items} strategy={verticalListSortingStrategy}>
                <div className="space-y-2">
                  {items.map((profileName) => {
                    const meta = getProfileMeta(profileName);
                    return (
                      <SortableProfileItem
                        key={profileName}
                        id={profileName}
                        label={meta.label}
                        providerId={meta.providerId}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {saving && (
            <p className="text-xs text-amber-400 font-mono mt-3 animate-pulse">Saving order...</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800">
          <Button variant="ghost" onClick={onClose} className="w-full">
            CLOSE
          </Button>
        </div>
      </div>
    </div>
  );
}
