/**
 * Process-related utilities for spawning child processes
 */

import { spawn } from "node:child_process";
import os from "node:os";
import pc from "picocolors";

/**
 * Spawn options for CLI commands
 */
export interface SpawnOptions {
  /** Command to execute (e.g., "claude", "qwen", "codex") */
  command: string;
  /** Arguments to pass to the command */
  args: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Display name for error messages (e.g., "Claude Code", "Qwen Code") */
  displayName: string;
  /** Callback when child process exits (before this process exits) */
  onExit?: () => void | Promise<void>;
}

/**
 * Spawns a child process for a CLI command with proper error handling
 *
 * This function:
 * - Uses shell: true for Windows compatibility (.cmd/.bat/.exe resolution)
 * - Inherits stdio for interactive commands
 * - Handles exit codes and errors gracefully
 * - Shows user-friendly error messages
 *
 * @param options Spawn configuration options
 */
export function spawnCLI(options: SpawnOptions): void {
  const { command, args, env, displayName, onExit } = options;

  // Merge environment variables with process.env
  const finalEnv = env ? { ...process.env, ...env } : process.env;

  // On Windows, shell: true is needed to resolve .cmd/.bat/.exe extensions.
  // On Unix, avoid shell: true with args to prevent DEP0190 deprecation warning
  // and potential command injection from unescaped arguments.
  const isWin32 = os.platform() === "win32";
  const child = spawn(command, args, {
    env: finalEnv,
    stdio: "inherit",
    shell: isWin32,
  });

  // Handle normal exit
  child.on("exit", async (code) => {
    await onExit?.();
    process.exit(code || 0);
  });

  // Handle spawn errors (command not found, etc.)
  child.on("error", async (error) => {
    console.log();
    console.log(pc.red(`✗ Run failed: ${error.message}`));
    console.log(pc.dim(`Please ensure ${displayName} CLI is installed`));
    console.log();
    await onExit?.();
    process.exit(1);
  });
}
