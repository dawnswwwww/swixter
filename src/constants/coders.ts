import type { ClaudeCodeProfile } from "../types.js";

/**
 * Run command configuration
 */
export interface RunCommandConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Coder configuration interface
 */
export interface CoderConfig {
  /** Coder ID */
  id: string;
  /** Display name */
  displayName: string;
  /** CLI executable name */
  executable: string;
  /** Adapter type */
  adapter: string;
  /** Environment variable mapping */
  envVarMapping: {
    apiKey: string;
    authToken?: string;
    baseURL: string;
    // Model environment variables for Claude Code
    anthropicModel?: string;
    defaultHaikuModel?: string;
    defaultOpusModel?: string;
    defaultSonnetModel?: string;
    // OpenAI model environment variable for Qwen and Codex
    openaiModel?: string;
  };
  /** Configuration file path */
  configPath: {
    dir: string;
    file: string;
  };
  /** Whether Auth Token is supported */
  supportsAuthToken: boolean;
}

/**
 * Coder registry
 * All supported Coder configurations are centralized here
 */
export const CODER_REGISTRY: Record<string, CoderConfig> = {
  claude: {
    id: "claude",
    displayName: "Claude Code",
    executable: "claude",
    adapter: "claude",
    envVarMapping: {
      apiKey: "ANTHROPIC_API_KEY",
      authToken: "ANTHROPIC_AUTH_TOKEN",
      baseURL: "ANTHROPIC_BASE_URL",
      // Model environment variables
      anthropicModel: "ANTHROPIC_MODEL",
      defaultHaikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      defaultOpusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
      defaultSonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
    },
    configPath: {
      dir: ".claude",
      file: "settings.json",
    },
    supportsAuthToken: true,
  },
  qwen: {
    id: "qwen",
    displayName: "Continue/Qwen",
    executable: "qwen",
    adapter: "continue",
    envVarMapping: {
      apiKey: "OPENAI_API_KEY",
      baseURL: "OPENAI_BASE_URL",
      openaiModel: "OPENAI_MODEL",
    },
    configPath: {
      dir: ".continue",
      file: "config.yaml",
    },
    supportsAuthToken: false,
  },
  codex: {
    id: "codex",
    displayName: "Codex",
    executable: "codex",
    adapter: "codex",
    envVarMapping: {
      apiKey: "OPENAI_API_KEY",
      baseURL: "OPENAI_BASE_URL",
      openaiModel: "OPENAI_MODEL",
    },
    configPath: {
      dir: ".codex",
      file: "config.toml",
    },
    supportsAuthToken: false,
  },
} as const;

/**
 * Get Coder configuration
 */
export function getCoderConfig(coder: string): CoderConfig {
  const config = CODER_REGISTRY[coder];
  if (!config) {
    throw new Error(`Unknown coder: ${coder}`);
  }
  return config;
}
