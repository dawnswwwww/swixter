import { useState } from "react";
import { useProviders } from "../hooks/useProviders";
import type { ProviderPreset } from "../api/types";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";

interface ProviderFormData {
  id: string;
  name: string;
  displayName: string;
  baseURL: string;
  wireApi: string;
}

export default function ProvidersPage() {
  const { providers, loading, error, createProvider, deleteProvider } = useProviders();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [detailProvider, setDetailProvider] = useState<ProviderPreset | null>(null);

  const handleSubmit = async (data: ProviderFormData) => {
    setIsSubmitting(true);
    try {
      await createProvider({
        id: data.id,
        name: data.name,
        displayName: data.displayName,
        baseURL: data.baseURL,
        wire_api: data.wireApi as "chat" | "responses",
      });
      setIsModalOpen(false);
    } catch (err) {
      console.error("Failed to create provider:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProvider(id);
      setDeleteConfirm(null);
    } catch (err) {
      console.error("Failed to delete provider:", err);
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
          <h2 className="font-mono font-bold text-2xl tracking-tight text-zinc-100">PROVIDERS</h2>
          <p className="text-zinc-500 text-sm mt-1 font-mono">
            {providers.length} provider{providers.length !== 1 ? "s" : ""} available
          </p>
        </div>
        <Button variant="primary" onClick={() => setIsModalOpen(true)}>+ ADD</Button>
      </div>

      {/* Provider table */}
      <Card variant="elevated" className="overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/50">
              <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                ID
              </th>
              <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                Name
              </th>
              <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                Type
              </th>
              <th className="px-5 py-3 text-left text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                API Endpoint
              </th>
              <th className="px-5 py-3 text-right text-xs font-mono font-semibold text-zinc-500 uppercase tracking-wider">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {providers.map((provider) => (
              <tr
                key={provider.id}
                className={`bg-zinc-900/30 transition-colors ${
                  provider.isUser
                    ? "hover:bg-zinc-900/60"
                    : "cursor-pointer hover:bg-zinc-800/60"
                }`}
                onClick={() => {
                  if (!provider.isUser) {
                    setDetailProvider(provider);
                  }
                }}
              >
                <td className="px-5 py-4">
                  <span className="font-mono font-medium text-amber-400 text-sm">
                    {provider.id}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <span className="text-zinc-200">{provider.displayName}</span>
                </td>
                <td className="px-5 py-4">
                  {provider.isUser ? (
                    <Badge variant="success">Custom</Badge>
                  ) : (
                    <Badge variant="neutral">Built-in</Badge>
                  )}
                </td>
                <td className="px-5 py-4">
                  <span className="text-sm text-zinc-500 font-mono truncate max-w-[300px] block">
                    {provider.baseURL || "—"}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  {provider.isUser && (
                    <div className="flex items-center justify-end gap-2">
                      {deleteConfirm === provider.id ? (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(provider.id)}
                          >
                            CONFIRM
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(null)}>
                            CANCEL
                          </Button>
                        </div>
                      ) : (
                        <Button variant="destructive" size="sm" onClick={() => setDeleteConfirm(provider.id)}>
                          DEL
                        </Button>
                      )}
                    </div>
                  )}
                  {!provider.isUser && (
                    <span className="text-zinc-600 text-xs font-mono">Click to view</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Create Provider Modal */}
      <ProviderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleSubmit}
        isSubmitting={isSubmitting}
      />

      {/* Built-in Provider Detail Modal */}
      {detailProvider && (
        <ProviderDetailModal
          provider={detailProvider}
          onClose={() => setDetailProvider(null)}
        />
      )}
    </div>
  );
}

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ProviderFormData) => Promise<void>;
  isSubmitting: boolean;
}

function ProviderModal({ isOpen, onClose, onSubmit, isSubmitting }: ProviderModalProps) {
  const [formData, setFormData] = useState<ProviderFormData>({
    id: "",
    name: "",
    displayName: "",
    baseURL: "",
    wireApi: "chat",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ProviderFormData | "wireApi", string>>>({});

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof ProviderFormData, string>> = {};

    if (!formData.id.trim()) {
      newErrors.id = "ID is required";
    } else if (!/^[a-z0-9-]+$/.test(formData.id)) {
      newErrors.id = "Lowercase letters, numbers and hyphens only";
    }

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    }

    if (!formData.displayName.trim()) {
      newErrors.displayName = "Display name is required";
    }

    if (!formData.baseURL.trim()) {
      newErrors.baseURL = "Base URL is required";
    } else {
      try {
        new URL(formData.baseURL);
      } catch {
        newErrors.baseURL = "Invalid URL";
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit(formData);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="font-mono font-semibold text-zinc-100">ADD PROVIDER</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* ID */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Provider ID
            </label>
            <input
              type="text"
              value={formData.id}
              onChange={(e) => setFormData({ ...formData, id: e.target.value.toLowerCase() })}
              placeholder="my-provider"
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                errors.id ? "border-red-500" : "border-zinc-700"
              }`}
            />
            {errors.id && <p className="mt-1 text-xs text-red-400">{errors.id}</p>}
          </div>

          {/* Name */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Internal Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="My Provider"
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                errors.name ? "border-red-500" : "border-zinc-700"
              }`}
            />
            {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
          </div>

          {/* Display Name */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Display Name
            </label>
            <input
              type="text"
              value={formData.displayName}
              onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
              placeholder="My Provider"
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                errors.displayName ? "border-red-500" : "border-zinc-700"
              }`}
            />
            {errors.displayName && <p className="mt-1 text-xs text-red-400">{errors.displayName}</p>}
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              API Base URL
            </label>
            <input
              type="text"
              value={formData.baseURL}
              onChange={(e) => setFormData({ ...formData, baseURL: e.target.value })}
              placeholder="https://api.example.com/v1"
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                errors.baseURL ? "border-red-500" : "border-zinc-700"
              }`}
            />
            {errors.baseURL && <p className="mt-1 text-xs text-red-400">{errors.baseURL}</p>}
          </div>

          {/* Wire API */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              API Type
            </label>
            <select
              value={formData.wireApi}
              onChange={(e) => setFormData({ ...formData, wireApi: e.target.value })}
              className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
            >
              <option value="chat">Chat (OpenAI-compatible)</option>
              <option value="responses">Responses (Anthropic)</option>
            </select>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              CANCEL
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "SAVING..." : "CREATE"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ProviderDetailModalProps {
  provider: ProviderPreset;
  onClose: () => void;
}

function ProviderDetailModal({ provider, onClose }: ProviderDetailModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="font-mono font-semibold text-zinc-100">PROVIDER DETAILS</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 transition-colors">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M15 5L5 15M5 5l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono text-zinc-500 uppercase">Provider</span>
            <Badge variant="neutral">Built-in</Badge>
          </div>

          <div>
            <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">ID</span>
            <span className="font-mono text-amber-400">{provider.id}</span>
          </div>

          <div>
            <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">Name</span>
            <span className="text-zinc-200">{provider.displayName || provider.name}</span>
          </div>

          <div>
            <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">API Endpoint</span>
            <span className="font-mono text-sm text-zinc-400 break-all">
              {provider.baseURL || "—"}
            </span>
          </div>

          <div>
            <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">API Type</span>
            <span className="text-zinc-200">
              {provider.wire_api === "responses" ? "Responses (Anthropic)" : "Chat (OpenAI-compatible)"}
            </span>
          </div>

          <div>
            <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">Environment Variable</span>
            <code className="text-sm text-emerald-400 font-mono">{provider.env_key || "—"}</code>
          </div>

          {provider.defaultModels && provider.defaultModels.length > 0 && (
            <div>
              <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">Default Models</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {provider.defaultModels.map((m) => (
                  <span key={m} className="px-2 py-0.5 bg-zinc-800 rounded text-xs font-mono text-zinc-400">
                    {m}
                  </span>
                ))}
              </div>
            </div>
          )}

          {provider.docs && (
            <div>
              <span className="text-xs font-mono text-zinc-500 uppercase block mb-1">Documentation</span>
              <a
                href={provider.docs}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-amber-400 hover:text-amber-300 font-mono underline"
              >
                {provider.docs}
              </a>
            </div>
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
