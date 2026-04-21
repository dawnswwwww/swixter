export type ProxyInstanceType = "service" | "run";

export interface ProxyConfig {
  instanceId: string; // "default" for service, "run-{port}" for run instances
  type: ProxyInstanceType;
  host: string;
  port: number;
  timeout?: number; // ms, default 3000000
  groupName?: string;
}

export interface ProxyStatus {
  instanceId: string;
  type: ProxyInstanceType;
  running: boolean;
  host: string;
  port: number;
  /**
   * Backward-compatible alias for the active proxy group name.
   * Keep this aligned with `groupName` for Task 1 compatibility.
   */
  activeGroup?: string;
  /**
   * Preferred runtime field for the active proxy group name.
   * Mirrors `activeGroup` while both fields are required for compatibility.
   */
  groupName?: string;
  pid?: number;
  requestCount: number;
  errorCount: number;
  startTime?: string;
}

export type CircuitStateType = "closed" | "open" | "half_open";

export interface CircuitState {
  profileId: string;
  consecutiveFailures: number;
  lastFailure?: string;
  lastSuccess?: string;
  isOpen: boolean;
  state: CircuitStateType;
}

export interface ForwardResponse {
  status: number;
  headers: Record<string, string>;
  body: string | ReadableStream;
  isStream: boolean;
}