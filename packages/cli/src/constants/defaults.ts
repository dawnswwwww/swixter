/**
 * Default value configuration
 */

/**
 * Export-related defaults
 */
export const EXPORT_DEFAULTS = {
  /** Default export filename */
  fileName: "swixter-config.json",
  /** Whether to sanitize API Keys by default */
  sanitizeKeys: true,
} as const;

/**
 * Placeholder texts
 */
export const DEFAULT_PLACEHOLDERS = {
  /** Default configuration name */
  configName: "my-config",
  /** Claude configuration name example */
  configNameClaude: "my-claude-config",
  /** Qwen configuration name example */
  configNameQwen: "my-qwen-config",
  /** API Key example */
  apiKeyExample: "sk-ant-...",
  /** Generic API Key prompt */
  apiKeyPrompt: "Enter your API Key",
  /** Base URL example */
  baseUrlExample: "https://api.example.com",
} as const;

/**
 * Miscellaneous defaults
 */
export const MISC_DEFAULTS = {
  /** Base URL fallback value */
  baseUrlFallback: "default",
} as const;

/**
 * Display-related defaults
 */
export const DISPLAY_DEFAULTS = {
  /** Empty value placeholder */
  emptyValue: "-",
  /** Not set indicator */
  notSet: "Not set",
  /** Optional field indicator */
  optional: "Optional",
} as const;

