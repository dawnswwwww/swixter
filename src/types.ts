import { z } from "zod";

/**
 * Authentication type
 */
export type AuthType = "bearer" | "api-key" | "custom";

/**
 * API Key environment variable type
 */
export type ApiKeyEnvVar = "ANTHROPIC_API_KEY" | "ANTHROPIC_AUTH_TOKEN";

/**
 * Provider preset configuration
 */
export interface ProviderPreset {
  /** Provider unique ID */
  id: string;
  /** Provider name */
  name: string;
  /** Provider display name */
  displayName: string;
  /** API base URL */
  baseURL: string;
  /** Default supported model list */
  defaultModels: string[];
  /** Authentication type */
  authType: AuthType;
  /** Custom request headers */
  headers?: Record<string, string>;
  /** Rate limit configuration */
  rateLimit?: {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
  };
  /** Documentation link */
  docs?: string;
  /** Whether it's a Chinese domestic service */
  isChinese?: boolean;
  /** API wire protocol type (for Codex) */
  wire_api?: "chat" | "responses";
  /** Environment variable name for API key (for Codex) */
  env_key?: string;
}

/**
 * Claude Code Profile
 */
export interface ClaudeCodeProfile {
  /** Profile name */
  name: string;
  /** Provider ID */
  providerId: string;
  /** API Key (corresponds to ANTHROPIC_API_KEY) */
  apiKey: string;
  /** Auth Token (corresponds to ANTHROPIC_AUTH_TOKEN) */
  authToken?: string;
  /** API base URL (can override preset) */
  baseURL?: string;
  /** Model name (for providers that support multiple models) */
  model?: string;
  /** Custom environment variable name for API key (Codex only) */
  envKey?: string;
  /** Custom request headers (can extend preset) */
  headers?: Record<string, string>;
  /** Creation time */
  createdAt: string;
  /** Update time */
  updatedAt: string;
}

/**
 * Coder configuration
 */
export interface CoderConfig {
  /** Current active profile */
  activeProfile: string;
}

/**
 * Configuration file structure
 */
export interface ConfigFile {
  /** All profiles */
  profiles: Record<string, ClaudeCodeProfile>;
  /** Configuration for each coder */
  coders: Record<string, CoderConfig>;
  /** Configuration version */
  version: string;
}

/**
 * Export configuration structure
 */
export interface ExportConfig {
  /** Exported profiles */
  profiles: ClaudeCodeProfile[];
  /** Export time */
  exportedAt: string;
  /** Configuration version */
  version: string;
  /** Whether API Key is sanitized */
  sanitized?: boolean;
}

// Zod Schemas for validation

export const ProviderPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  baseURL: z.string().url(),
  defaultModels: z.array(z.string()),
  authType: z.enum(["bearer", "api-key", "custom"]),
  headers: z.record(z.string(), z.string()).optional(),
  rateLimit: z.object({
    requestsPerMinute: z.number().optional(),
    tokensPerMinute: z.number().optional(),
  }).optional(),
  docs: z.string().url().optional(),
  isChinese: z.boolean().optional(),
});

export const ClaudeCodeProfileSchema = z.object({
  name: z.string().min(1),
  providerId: z.string(),
  apiKey: z.string(), // Allow empty string (local models like Ollama don't need key)
  authToken: z.string().optional(),
  baseURL: z.string().url().optional(),
  model: z.string().optional(),
  envKey: z.string().optional(), // Custom env var name for Codex (no validation)
  headers: z.record(z.string(), z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const CoderConfigSchema = z.object({
  activeProfile: z.string(),
});

export const ConfigFileSchema = z.object({
  profiles: z.record(z.string(), ClaudeCodeProfileSchema),
  coders: z.record(z.string(), CoderConfigSchema),
  version: z.string(),
});

export const ExportConfigSchema = z.object({
  profiles: z.array(ClaudeCodeProfileSchema),
  exportedAt: z.string(),
  version: z.string(),
  sanitized: z.boolean().optional(),
});
