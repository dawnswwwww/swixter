import { useState, useEffect } from "react";
import type { Group } from "../api/types";
import * as api from "../api/client";

export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchGroups = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.listGroups();
      setGroups(data);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGroups();
  }, []);

  const createGroup = async (data: Parameters<typeof api.createGroup>[0]) => {
    const result = await api.createGroup(data);
    await fetchGroups();
    return result;
  };

  const updateGroup = async (id: string, data: Parameters<typeof api.updateGroup>[1]) => {
    const result = await api.updateGroup(id, data);
    await fetchGroups();
    return result;
  };

  const deleteGroup = async (id: string) => {
    await api.deleteGroup(id);
    await fetchGroups();
  };

  const setActiveGroup = async (id: string) => {
    await api.setActiveGroup(id);
    await fetchGroups();
  };

  return {
    groups,
    loading,
    error,
    refresh: fetchGroups,
    createGroup,
    updateGroup,
    deleteGroup,
    setActiveGroup,
  };
}
