/**
 * Formatting and display-related constant configurations
 */

/**
 * API Key processing constants
 */
export const API_KEY_FORMAT = {
  /** Number of characters to keep when exporting */
  sanitizeLength: 8,
  /** Number of characters to preview when displaying */
  previewLength: 10,
  /** Prefix length (for export) */
  prefixLength: 4,
  /** Suffix length (for export) */
  suffixLength: 4,
} as const;

/**
 * Display column width configuration
 */
export const DISPLAY_PADDING = {
  /** Configuration name column width */
  name: 20,
  /** Provider column width */
  provider: 25,
  /** URL column width */
  url: 30,
} as const;

/**
 * Serialization format configuration
 */
export const SERIALIZATION = {
  /** JSON indentation spaces */
  jsonIndent: 2,
  /** YAML indentation spaces */
  yamlIndent: 2,
} as const;

/**
 * Validation rules configuration
 */
export const VALIDATION_RULES = {
  /** Minimum profile name length */
  minProfileNameLength: 2,
  /** Allowed characters pattern for profile names */
  profileNamePattern: /^[a-zA-Z0-9_-]+$/,
} as const;

/**
 * UI marker symbols
 */
export const MARKERS = {
  /** Active status marker */
  active: "●",
  /** Inactive status marker */
  inactive: "○",
  /** Success marker */
  success: "✓",
  /** Error marker */
  error: "✗",
  /** Warning marker */
  warning: "⚠️",
  /** Info marker */
  info: "ℹ",
} as const;

/**
 * Exit codes
 */
export const EXIT_CODES = {
  /** Success */
  success: 0,
  /** General error */
  generalError: 1,
  /** Invalid argument */
  invalidArgument: 2,
  /** Not found */
  notFound: 3,
  /** Cancelled by user */
  cancelled: 130,
} as const;
