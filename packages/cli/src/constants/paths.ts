import { homedir, platform } from "node:os";
import { join } from "node:path";

/**
 * Get platform-specific Swixter config directory
 *
 * - Windows: ~/swixter (e.g., C:\Users\username\swixter)
 * - Unix/Linux/macOS: ~/.config/swixter
 *
 * Note: Claude Code, Codex, and Continue all use ~/.tool-name format
 * which works cross-platform via Node.js homedir(), so only Swixter
 * needs special handling to follow platform conventions.
 */
function getSwixterConfigDir(): string {
  if (platform() === "win32") {
    // Windows: Use simple ~/swixter for consistency with AI coder tools
    return "swixter";
  }
  // Unix/Linux/macOS: Follow XDG Base Directory specification
  return ".config/swixter";
}

/**
 * Path configuration
 * Centralized management of all config file paths
 *
 * All paths are relative to homedir() and will be resolved by getConfigPath()
 */
export const PATH_CONFIG = {
  swixter: {
    dir: getSwixterConfigDir(),
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
