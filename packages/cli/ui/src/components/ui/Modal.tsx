import React, { useState, useEffect } from "react";
import Button from "./Button";
import type { ClaudeCodeProfile, ProviderPreset } from "../../api/types";
import { hasModelFamilies, getModelsByFamily, getFamilyForModel } from "../../utils/model-helper";
import type { ProviderWithModelFamilies } from "../../utils/model-helper";
import * as api from "../../api/client";

interface ProfileFormData {
  name: string;
  providerId: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

interface ProfileFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: ProfileFormData) => Promise<void>;
  profile?: ClaudeCodeProfile | null;
  mode: "create" | "edit";
  isSubmitting?: boolean;
}

export default function ProfileForm({
  isOpen,
  onClose,
  onSubmit,
  profile,
  mode,
  isSubmitting = false,
}: ProfileFormProps) {
  const [providers, setProviders] = useState<ProviderWithModelFamilies[]>([]);
  const [selectedFamily, setSelectedFamily] = useState<string>("");
  const [formData, setFormData] = useState<ProfileFormData>({
    name: "",
    providerId: "anthropic",
    apiKey: "",
    baseURL: "",
    model: "",
  });
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileFormData, string>>>({});

  // Fetch providers when modal opens
  useEffect(() => {
    if (isOpen) {
      api.listProviders().then((data: ProviderPreset[]) => {
        const options: ProviderWithModelFamilies[] = data.map(p => ({
          id: p.id,
          name: p.displayName || p.name,
          baseURL: p.baseURL || "",
          defaultModels: p.defaultModels || [],
          modelFamilies: p.modelFamilies,
        }));
        setProviders(options);
      }).catch(() => {
        // Fallback to basic providers if fetch fails
        setProviders([
          { id: "anthropic", name: "Anthropic", baseURL: "https://api.anthropic.com", defaultModels: [] },
          { id: "ollama", name: "Ollama", baseURL: "http://localhost:11434", defaultModels: [] },
        ]);
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (profile && mode === "edit") {
        setFormData({
          name: profile.name,
          providerId: profile.providerId,
          apiKey: profile.apiKey || "",
          baseURL: profile.baseURL || "",
          model: profile.model || "",
        });
        // Initialize family based on profile's model
        const provider = providers.find(p => p.id === profile.providerId);
        if (provider && profile.model) {
          const family = getFamilyForModel(provider, profile.model);
          setSelectedFamily(family?.id || "");
        }
      } else {
        setFormData({
          name: "",
          providerId: providers[0]?.id || "anthropic",
          apiKey: "",
          baseURL: "",
          model: "",
        });
        // Initialize family for the default provider
        const defaultProvider = providers[0];
        if (defaultProvider?.modelFamilies && defaultProvider.modelFamilies.length > 0) {
          setSelectedFamily(defaultProvider.modelFamilies[0].id);
        } else {
          setSelectedFamily("");
        }
      }
      setErrors({});
    }
  }, [isOpen, profile, mode, providers]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof ProfileFormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = "Name is required";
    } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.name)) {
      newErrors.name = "Only letters, numbers, underscores and hyphens";
    }

    if (!formData.providerId) {
      newErrors.providerId = "Provider is required";
    }

    if (!formData.apiKey.trim()) {
      newErrors.apiKey = "API key is required";
    }

    if (formData.baseURL && !isValidUrl(formData.baseURL)) {
      newErrors.baseURL = "Invalid URL";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isValidUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    await onSubmit(formData);
  };

  const handleProviderChange = (providerId: string) => {
    const provider = providers.find(p => p.id === providerId);
    const hasFamilies = provider ? hasModelFamilies(provider) : false;

    setFormData({
      ...formData,
      providerId,
      baseURL: provider?.baseURL || "",
      model: "",
    });
    // Reset family selection when provider changes
    setSelectedFamily(hasFamilies ? provider!.modelFamilies![0].id : "");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-md mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="font-mono font-semibold text-zinc-100">
            {mode === "create" ? "CREATE PROFILE" : "EDIT PROFILE"}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path
                d="M15 5L5 15M5 5l10 10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Profile Name
            </label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={mode === "edit"}
              placeholder="my-profile"
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                errors.name ? "border-red-500" : "border-zinc-700"
              } ${mode === "edit" ? "opacity-50 cursor-not-allowed" : ""}`}
            />
            {errors.name && (
              <p className="mt-1 text-xs text-red-400">{errors.name}</p>
            )}
          </div>

          {/* Provider */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Provider
            </label>
            <select
              value={formData.providerId}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={mode === "edit"}
              className={`w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${mode === "edit" ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {errors.providerId && (
              <p className="mt-1 text-xs text-red-400">{errors.providerId}</p>
            )}
            {mode === "edit" && (
              <p className="mt-1 text-xs text-zinc-500">Provider cannot be changed after creation</p>
            )}
          </div>

          {/* API Key */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              API Key
            </label>
            <input
              type="password"
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder="sk-..."
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                errors.apiKey ? "border-red-500" : "border-zinc-700"
              }`}
            />
            {errors.apiKey && (
              <p className="mt-1 text-xs text-red-400">{errors.apiKey}</p>
            )}
          </div>

          {/* Base URL */}
          <div>
            <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
              Base URL
            </label>
            <input
              type="text"
              value={formData.baseURL}
              onChange={(e) => setFormData({ ...formData, baseURL: e.target.value })}
              placeholder={providers.find(p => p.id === formData.providerId)?.baseURL || "https://..."}
              className={`w-full px-3 py-2 bg-zinc-950 border rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                errors.baseURL ? "border-red-500" : "border-zinc-700"
              }`}
            />
            {errors.baseURL && (
              <p className="mt-1 text-xs text-red-400">{errors.baseURL}</p>
            )}
          </div>

          {/* Model */}
          {(() => {
            const provider = providers.find(p => p.id === formData.providerId);
            if (!provider) return null;

            if (hasModelFamilies(provider)) {
              const families = provider.modelFamilies!;
              const familyModels = getModelsByFamily(provider, selectedFamily);

              return (
                <>
                  {/* Family selector */}
                  <div className="mb-2">
                    <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
                      Model Family
                    </label>
                    <select
                      value={selectedFamily}
                      onChange={(e) => {
                        setSelectedFamily(e.target.value);
                        // Auto-select first model in new family
                        const newFamily = families.find(f => f.id === e.target.value);
                        setFormData({ ...formData, model: newFamily?.models[0] || "" });
                      }}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    >
                      {families.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Model selector */}
                  <div>
                    <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
                      Model (optional)
                    </label>
                    <select
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                    >
                      <option value="">Select a model...</option>
                      {familyModels.map((m) => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </>
              );
            }

            // Flat model selection (no families)
            return (
              <div>
                <label className="block text-xs font-mono text-zinc-500 uppercase tracking-wider mb-1.5">
                  Model {provider?.defaultModels && provider.defaultModels.length ? "(optional)" : ""}
                </label>
                {provider?.defaultModels && provider.defaultModels.length ? (
                  <select
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  >
                    <option value="">Select a model...</option>
                    {provider.defaultModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    placeholder="model-id"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm font-mono text-zinc-100 placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  />
                )}
              </div>
            );
          })()}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              CANCEL
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? "SAVING..." : mode === "create" ? "CREATE" : "SAVE"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
