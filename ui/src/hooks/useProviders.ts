import { useState, useEffect } from "react";
import type { ProviderPreset } from "../api/types";
import * as api from "../api/client";

export function useProviders() {
  const [providers, setProviders] = useState<ProviderPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProviders = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listProviders();
      setProviders(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProviders();
  }, []);

  const createProvider = async (provider: Parameters<typeof api.createProvider>[0]) => {
    const result = await api.createProvider(provider);
    await fetchProviders();
    return result;
  };

  const updateProvider = async (id: string, provider: Parameters<typeof api.updateProvider>[1]) => {
    const result = await api.updateProvider(id, provider);
    await fetchProviders();
    return result;
  };

  const deleteProvider = async (id: string) => {
    await api.deleteProvider(id);
    await fetchProviders();
  };

  return {
    providers,
    loading,
    error,
    refresh: fetchProviders,
    createProvider,
    updateProvider,
    deleteProvider,
  };
}
