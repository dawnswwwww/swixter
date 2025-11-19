import type { CoderAdapter } from "./base.js";
import { ClaudeCodeAdapter } from "./claude.js";
import { ContinueAdapter } from "./continue.js";

/**
 * Get adapter for specified coder
 */
export function getAdapter(coder: string): CoderAdapter {
  switch (coder) {
    case "claude":
      return new ClaudeCodeAdapter();
    case "qwen":
      return new ContinueAdapter();
    default:
      throw new Error(`Unknown coder: ${coder}`);
  }
}

/**
 * Export all adapters
 */
export { ClaudeCodeAdapter, ContinueAdapter };
export type { CoderAdapter };
