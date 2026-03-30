// API types - mirrored from src/types.ts in main package

export type AuthType = "bearer" | "api-key" | "custom";

export interface ProviderPreset {
  id: string;
  name: string;
  displayName: string;
  baseURL: string;
  defaultModels: string[];
  authType: AuthType;
  headers?: Record<string, string>;
  rateLimit?: {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
  };
  docs?: string;
  isChinese?: boolean;
  wire_api?: "chat" | "responses";
  env_key?: string;
  isUser?: boolean; // Added by API
}

export interface ClaudeCodeProfile {
  name: string;
  providerId: string;
  apiKey: string;
  authToken?: string;
  baseURL?: string;
  model?: string;
  openaiModel?: string;
  models?: {
    anthropicModel?: string;
    defaultHaikuModel?: string;
    defaultOpusModel?: string;
    defaultSonnetModel?: string;
  };
  envKey?: string;
  headers?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface CoderConfig {
  id: string;
  displayName: string;
  executable: string;
  adapter: string;
  envVarMapping: {
    apiKey: string;
    authToken?: string;
    baseURL: string;
    anthropicModel?: string;
    defaultHaikuModel?: string;
    defaultOpusModel?: string;
    defaultSonnetModel?: string;
    openaiModel?: string;
  };
  configPath: {
    dir: string;
    file: string;
  };
  supportsAuthToken: boolean;
}

export interface CoderStatus {
  id: string;
  displayName: string;
  executable: string;
  activeProfile: {
    name: string;
    providerId: string;
    baseURL?: string;
  } | null;
}

export interface ConfigMeta {
  exists: boolean;
  profiles: Array<{
    name: string;
    providerId: string;
    updatedAt: string;
  }>;
  mtime: string | null;
  size: number;
  etag?: string;
}

export interface VersionInfo {
  appVersion: string;
  configVersion: string;
  exportVersion: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse {
  error?: ApiError;
}
