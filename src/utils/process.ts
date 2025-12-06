/**
 * Process-related utilities for spawning child processes
 */

import { spawn } from "node:child_process";
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
  const { command, args, env, displayName } = options;

  // Merge environment variables with process.env
  const finalEnv = env ? { ...process.env, ...env } : process.env;

  // Spawn the process with shell: true for Windows compatibility
  const child = spawn(command, args, {
    env: finalEnv,
    stdio: "inherit", // Inherit stdio for interactive CLI
    shell: true, // Required for Windows to resolve .cmd/.bat/.exe extensions
  });

  // Handle normal exit
  child.on("exit", (code) => {
    process.exit(code || 0);
  });

  // Handle spawn errors (command not found, etc.)
  child.on("error", (error) => {
    console.log();
    console.log(pc.red(`✗ Run failed: ${error.message}`));
    console.log(pc.dim(`Please ensure ${displayName} CLI is installed`));
    console.log();
    process.exit(1);
  });
}
