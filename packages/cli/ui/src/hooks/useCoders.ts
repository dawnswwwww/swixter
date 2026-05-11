import { useState, useEffect } from "react";
import type { CoderStatus } from "../api/types";
import * as api from "../api/client";

export function useCoders() {
  const [coders, setCoders] = useState<CoderStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchCoders = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listCoders();
      setCoders(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoders();
  }, []);

  const setActiveProfile = async (coder: string, profileName: string) => {
    const result = await api.setActiveProfile(coder, profileName);
    await fetchCoders(); // Refresh
    return result;
  };

  const applyProfile = async (coder: string) => {
    return await api.applyProfile(coder);
  };

  const verifyConfig = async (coder: string) => {
    return await api.verifyConfig(coder);
  };

  return {
    coders,
    loading,
    error,
    refresh: fetchCoders,
    setActiveProfile,
    applyProfile,
    verifyConfig,
  };
}
