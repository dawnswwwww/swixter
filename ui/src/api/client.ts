import type {
  ClaudeCodeProfile,
  ConfigMeta,
  CoderStatus,
  Group,
  ProviderPreset,
  ProxyLogsResponse,
  ProxyStatus,
  VersionInfo,
} from "./types";

const API_BASE = "/api";

// Helper for fetch with error handling
async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ code: "UNKNOWN_ERROR", message: response.statusText }));
    throw error;
  }

  return response.json();
}

// Profiles API
export async function listProfiles(): Promise<ClaudeCodeProfile[]> {
  return fetchJson<ClaudeCodeProfile[]>(`${API_BASE}/profiles`);
}

export async function getProfile(name: string): Promise<ClaudeCodeProfile> {
  return fetchJson<ClaudeCodeProfile>(`${API_BASE}/profiles/${encodeURIComponent(name)}`);
}

export async function createProfile(profile: Partial<ClaudeCodeProfile> & { name: string; providerId: string }): Promise<ClaudeCodeProfile> {
  return fetchJson<ClaudeCodeProfile>(`${API_BASE}/profiles`, {
    method: "POST",
    body: JSON.stringify(profile),
  });
}

export async function updateProfile(name: string, profile: Partial<ClaudeCodeProfile>): Promise<ClaudeCodeProfile> {
  return fetchJson<ClaudeCodeProfile>(`${API_BASE}/profiles/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify(profile),
  });
}

export async function deleteProfile(name: string): Promise<{ success: boolean; message: string }> {
  return fetchJson<{ success: boolean; message: string }>(`${API_BASE}/profiles/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

// Providers API
export async function listProviders(): Promise<ProviderPreset[]> {
  return fetchJson<ProviderPreset[]>(`${API_BASE}/providers`);
}

export async function createProvider(provider: Partial<ProviderPreset> & { id: string; name: string; displayName: string }): Promise<ProviderPreset> {
  return fetchJson<ProviderPreset>(`${API_BASE}/providers`, {
    method: "POST",
    body: JSON.stringify(provider),
  });
}

export async function updateProvider(id: string, provider: Partial<ProviderPreset>): Promise<ProviderPreset> {
  return fetchJson<ProviderPreset>(`${API_BASE}/providers/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(provider),
  });
}

export async function deleteProvider(id: string): Promise<{ success: boolean; message: string }> {
  return fetchJson<{ success: boolean; message: string }>(`${API_BASE}/providers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// Coders API
export async function listCoders(): Promise<CoderStatus[]> {
  return fetchJson<CoderStatus[]>(`${API_BASE}/coders`);
}

export async function getActiveProfile(coder: string): Promise<{ activeProfile: ClaudeCodeProfile | null }> {
  return fetchJson<{ activeProfile: ClaudeCodeProfile | null }>(`${API_BASE}/coders/${coder}/active`);
}

export async function setActiveProfile(coder: string, profileName: string): Promise<{ activeProfile: ClaudeCodeProfile | null }> {
  return fetchJson<{ activeProfile: ClaudeCodeProfile | null }>(`${API_BASE}/coders/${coder}/active`, {
    method: "PUT",
    body: JSON.stringify({ profileName }),
  });
}

export async function applyProfile(coder: string): Promise<{ success: boolean; warning?: boolean; message: string }> {
  return fetchJson<{ success: boolean; warning?: boolean; message: string }>(`${API_BASE}/coders/${coder}/apply`, {
    method: "POST",
  });
}

export async function verifyConfig(coder: string): Promise<{ verified: boolean; message: string }> {
  return fetchJson<{ verified: boolean; message: string }>(`${API_BASE}/coders/${coder}/verify`);
}

// Config API
export async function getVersion(): Promise<VersionInfo> {
  return fetchJson<VersionInfo>(`${API_BASE}/version`);
}

export async function getConfigMeta(): Promise<ConfigMeta> {
  const response = await fetch(`${API_BASE}/config`);
  if (response.status === 304) {
    // Not modified
    throw new Error("NOT_MODIFIED");
  }
  return response.json();
}

export async function exportConfig(sanitize?: boolean): Promise<string> {
  const url = sanitize ? `${API_BASE}/config/export?sanitize=true` : `${API_BASE}/config/export`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to export config");
  }
  return response.text();
}

export async function importConfig(config: string, overwrite?: boolean): Promise<{ success: boolean; message: string }> {
  return fetchJson<{ success: boolean; message: string }>(`${API_BASE}/config/import`, {
    method: "POST",
    body: JSON.stringify({ config, overwrite }),
  });
}

export async function resetConfig(): Promise<{ success: boolean; message: string }> {
  return fetchJson<{ success: boolean; message: string }>(`${API_BASE}/config/reset`, {
    method: "POST",
  });
}

// Proxy API
export async function fetchProxyStatus(): Promise<ProxyStatus> {
  return fetchJson<ProxyStatus>(`${API_BASE}/proxy/status`);
}

export async function startProxy(options?: { host?: string; port?: number }): Promise<ProxyStatus> {
  return fetchJson<ProxyStatus>(`${API_BASE}/proxy/start`, {
    method: "POST",
    body: JSON.stringify(options || {}),
  });
}

export async function stopProxy(instanceId?: string): Promise<{ success: boolean; message: string }> {
  return fetchJson<{ success: boolean; message: string }>(`${API_BASE}/proxy/stop`, {
    method: "POST",
    body: JSON.stringify(instanceId ? { instanceId } : {}),
  });
}

export async function fetchProxyInstances(): Promise<ProxyStatus[]> {
  return fetchJson<ProxyStatus[]>(`${API_BASE}/proxy/instances`);
}

export async function fetchProxyLogs(lines?: number, instanceId?: string): Promise<ProxyLogsResponse> {
  const params = new URLSearchParams();
  if (lines) params.set("lines", String(lines));
  if (instanceId) params.set("instanceId", instanceId);
  const qs = params.toString();
  return fetchJson<ProxyLogsResponse>(`${API_BASE}/proxy/logs${qs ? `?${qs}` : ""}`);
}

// Groups API
export async function listGroups(): Promise<Group[]> {
  return fetchJson<Group[]>(`${API_BASE}/groups`);
}

export async function getGroup(id: string): Promise<Group> {
  return fetchJson<Group>(`${API_BASE}/groups/${encodeURIComponent(id)}`);
}

export async function createGroup(data: { name: string; profiles: string[]; isDefault?: boolean }): Promise<Group> {
  return fetchJson<Group>(`${API_BASE}/groups`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateGroup(id: string, data: Partial<Pick<Group, "name" | "profiles" | "isDefault">>): Promise<Group> {
  return fetchJson<Group>(`${API_BASE}/groups/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(id: string): Promise<{ success: boolean; message: string }> {
  return fetchJson<{ success: boolean; message: string }>(`${API_BASE}/groups/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function setActiveGroup(id: string): Promise<Group> {
  return fetchJson<Group>(`${API_BASE}/groups/${encodeURIComponent(id)}/active`, {
    method: "PUT",
  });
}
