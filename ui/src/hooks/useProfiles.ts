import { useState, useEffect } from "react";
import type { ClaudeCodeProfile } from "../api/types";
import * as api from "../api/client";

export function useProfiles() {
  const [profiles, setProfiles] = useState<ClaudeCodeProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchProfiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listProfiles();
      setProfiles(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfiles();
  }, []);

  const createProfile = async (profile: Parameters<typeof api.createProfile>[0]) => {
    const result = await api.createProfile(profile);
    await fetchProfiles(); // Refresh list
    return result;
  };

  const updateProfile = async (name: string, profile: Parameters<typeof api.updateProfile>[1]) => {
    const result = await api.updateProfile(name, profile);
    await fetchProfiles(); // Refresh list
    return result;
  };

  const deleteProfile = async (name: string) => {
    await api.deleteProfile(name);
    await fetchProfiles(); // Refresh list
  };

  return {
    profiles,
    loading,
    error,
    refresh: fetchProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
  };
}
