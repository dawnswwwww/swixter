// API types - mirrored from src/types.ts in main package

export type AuthType = "bearer" | "api-key" | "custom";

/**
 * Model family grouping for hierarchical model organization
 */
export interface ModelFamily {
  /** Family ID, e.g., "sonnet", "haiku", "opus" */
  id: string;
  /** Display name, e.g., "Sonnet", "Haiku", "Opus" */
  name: string;
  /** List of model IDs in this family */
  models: string[];
}

export interface ProviderPreset {
  id: string;
  name: string;
  displayName: string;
  baseURL: string;
  baseURLChat?: string;
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
  /** Optional model family hierarchy */
  modelFamilies?: ModelFamily[];
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
  wireApi: "chat" | "responses" | "both";
  supportsAuthToken: boolean;
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

export type ProxyInstanceType = "service" | "run";

export interface ProxyStatus {
  instanceId: string;
  type: ProxyInstanceType;
  running: boolean;
  host: string;
  port: number;
  groupName?: string;
  activeGroup?: string;
  activeGroupName?: string;
  pid?: number;
  requestCount: number;
  errorCount: number;
  startTime?: string;
}

export interface Group {
  id: string;
  name: string;
  profiles: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  profileDetails?: Array<{
    id: string;
    name: string;
    providerId: string;
  } | null>;
}

export interface ProxyLogEntry {
  ts: string;
  level: string;
  msg: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  error?: string;
  stack?: string;
}

export interface ProxyLogsResponse {
  lines: ProxyLogEntry[];
  total: number;
}

export interface LogEvent {
  type: "log";
  instanceId: string;
  entry: ProxyLogEntry;
}

export interface StatusEvent {
  type: "status";
  status: ProxyStatus;
}

export interface InstanceStartEvent {
  type: "instance.start";
  status: ProxyStatus;
}

export interface InstanceStopEvent {
  type: "instance.stop";
  instanceId: string;
}

export interface GroupChangeEvent {
  type: "group.change";
  groupId: string;
  groupName: string;
}

export interface SnapshotEvent {
  type: "snapshot";
  instances: ProxyStatus[];
  activeGroupId?: string;
  activeGroupName?: string;
}

export type ProxyWsEvent =
  | LogEvent
  | StatusEvent
  | InstanceStartEvent
  | InstanceStopEvent
  | GroupChangeEvent;

export type ProxyWsServerEvent = SnapshotEvent | ProxyWsEvent;

export type ProxyWsConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse {
  error?: ApiError;
}
