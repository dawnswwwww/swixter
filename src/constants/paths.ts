import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Path configuration
 * Centralized management of all config file paths
 */
export const PATH_CONFIG = {
  swixter: {
    dir: ".config/swixter",
    file: "config.json",
  },
  claude: {
    dir: ".claude",
    file: "settings.json",
  },
  continue: {
    dir: ".continue",
    file: "config.yaml",
  },
} as const;

/**
 * Get full config file path
 */
export function getConfigPath(type: keyof typeof PATH_CONFIG): string {
  const config = PATH_CONFIG[type];
  return join(homedir(), config.dir, config.file);
}

/**
 * Get config directory path
 */
export function getConfigDir(type: keyof typeof PATH_CONFIG): string {
  const config = PATH_CONFIG[type];
  return join(homedir(), config.dir);
}
