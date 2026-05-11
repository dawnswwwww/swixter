/**
 * CLI command utilities for common command patterns
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { parseFlags } from "../cli/commands/parsers.js";

/**
 * Options for handling apply prompt after switch
 */
export interface ApplyPromptOptions {
  /** Arguments passed to the switch command */
  args: string[];
  /** Callback function to execute apply */
  applyFn: () => Promise<void>;
  /** Display name of the coder (e.g., "Claude Code", "Codex") */
  coderDisplayName: string;
  /** Coder name for tip message (e.g., "claude", "codex") */
  coderName: string;
}

/**
 * Handles the apply prompt logic after switching profiles
 *
 * This function implements three modes:
 * 1. --apply flag: Auto-apply without prompting
 * 2. --no-apply flag: Skip prompt, show tip message
 * 3. Interactive: Prompt user to apply (default: true)
 *
 * @param options Apply prompt configuration
 */
export async function handleApplyPrompt(options: ApplyPromptOptions): Promise<void> {
  const { args, applyFn, coderDisplayName, coderName } = options;

  // Parse args to check for --apply or --no-apply flags
  const params = parseFlags(args);
  const shouldApply = params.apply;
  const noApply = params["no-apply"];

  // If --apply flag is set, apply immediately
  if (shouldApply) {
    await applyFn();
    return;
  }

  // If --no-apply flag is set, skip prompt
  if (noApply) {
    console.log(pc.dim(`Tip: Run 'swixter ${coderName} apply' to apply profile to ${coderDisplayName}`));
    return;
  }

  // Interactive mode: prompt user
  const apply = await p.confirm({
    message: `Apply this profile to ${coderDisplayName} now?`,
    initialValue: true,
  });

  if (p.isCancel(apply)) {
    return; // User cancelled, exit gracefully
  }

  if (apply) {
    await applyFn();
  } else {
    console.log();
    console.log(pc.dim(`Tip: Run 'swixter ${coderName} apply' to apply profile to ${coderDisplayName}`));
  }
}
