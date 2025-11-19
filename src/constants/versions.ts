/**
 * Version management configuration
 */

/**
 * Config file version number
 */
export const CONFIG_VERSION = "2.0.0" as const;

/**
 * Export file version number
 */
export const EXPORT_VERSION = "1.0.0" as const;

/**
 * Version migration configuration
 */
export const MIGRATIONS = {
  "1.0.0-to-2.0.0": {
    from: "1.0.0",
    to: "2.0.0",
    description: "Add multi-coder support, migrate from single activeProfile to coders object",
  },
} as const;
