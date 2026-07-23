/**
 * Codex proxy-bridge helpers
 *
 * When the active Codex profile's provider only speaks the OpenAI Chat
 * Completions API (`openai_chat`), Codex — which drives `/v1/responses` —
 * cannot talk to it directly. The local swixter proxy bridges this gap: it
 * accepts Codex's `/v1/responses` call and translates it to the provider's
 * chat-completions format using the registered `openai_responses ↔ openai_chat`
 * transformer pair.
 *
 * To wire Codex through the proxy, the Codex provider table is rewritten so
 * that:
 *   - `base_url` points at the proxy (`http://127.0.0.1:<port>/v1`)
 *   - `env_key` is `SWIXTER_PROXY_KEY` (Codex then sends `swixter-local-proxy`
 *     as its bearer; the proxy authenticates this and re-attaches the real
 *     upstream credential when forwarding).
 *
 * This module is deliberately split into a PURE decision function
 * (`resolveProviderEndpoints`) and small side-effect functions
 * (`ensureProxyRunning`, `setProxyAuthEnvForGUI`) so unit tests can exercise
 * the decision logic and stub the side-effects.
 */

import { spawn } from "node:child_process";
import pc from "picocolors";
import type { ClaudeCodeProfile, ProviderPreset } from "../types.js";
import {
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  SWIXTER_PROXY_AUTH_TOKEN,
  SWIXTER_PROXY_ENV_KEY,
} from "../constants/proxy.js";
import { inferTargetApiFormat } from "../proxy/transform/index.js";
import { listProxyInstances } from "../proxy/server.js";
import { getEnvKey } from "./env-key-helper.js";

export interface ProviderEndpoints {
  /** base_url to write into the Codex provider table */
  base_url: string;
  /** env_key to write into the Codex provider table */
  env_key: string;
  /** True when bridging through the local proxy (chat-only provider). */
  bridged: boolean;
}

/**
 * Pure decision function: given a profile and its preset, decide what
 * `base_url` and `env_key` to write into the Codex provider table.
 *
 * - Chat-only providers (inferTargetApiFormat === "openai_chat") route
 *   through the local proxy and use the proxy auth env var.
 * - Anything else (a provider that natively serves /v1/responses) keeps the
 *   real base_url and the real env_key — no bridge.
 *
 * This function performs NO process side-effects; tests can call it directly.
 */
export function resolveProviderEndpoints(
  profile: ClaudeCodeProfile,
  preset: ProviderPreset | undefined | null,
): ProviderEndpoints {
  const targetFormat = inferTargetApiFormat(profile, (preset ?? {}) as ProviderPreset);

  if (targetFormat === "openai_chat") {
    return {
      base_url: `http://${DEFAULT_PROXY_HOST}:${DEFAULT_PROXY_PORT}/v1`,
      env_key: SWIXTER_PROXY_ENV_KEY,
      bridged: true,
    };
  }

  // Non-bridged: keep current behavior. The env_key resolution mirrors
  // env-key-helper.getEnvKey but synchronously (preset.env_key is available
  // here; profile.envKey wins as usual).
  const realBaseUrl = profile.baseURL || preset?.baseURLChat || preset?.baseURL || "";
  // getEnvKey is async only because it (re)loads the preset; here we already
  // have one, so replicate its priority inline to keep this function sync.
  const realEnvKey =
    profile.envKey || preset?.env_key || "OPENAI_API_KEY";
  return {
    base_url: realBaseUrl,
    env_key: realEnvKey,
    bridged: false,
  };
}

/**
 * Check whether a proxy instance is already running for this profile name.
 *
 * `swixter codex apply` does NOT auto-start the proxy daemon — that would
 * couple apply's config-write responsibility to process lifecycle. Instead,
 * apply just verifies whether a proxy is already up (e.g. the user started
 * one earlier via `swixter proxy start --profile <name>`) and prints a
 * manual-instruction warning if not. The user is in control of when the
 * daemon runs.
 *
 * Returns true if a running instance already serves this profile, false otherwise.
 * Never throws.
 */
export async function ensureProxyRunning(profileName: string): Promise<boolean> {
  try {
    const instances = listProxyInstances();
    const existing = instances.find(
      (s) => s.running && s.profileName === profileName,
    );
    if (existing) {
      return true;
    }
  } catch {
    // ignore registry read errors and report "not running"
  }

  console.warn(
    pc.yellow(
      `Proxy bridge is not running for profile "${profileName}".`,
    ),
  );
  console.warn(
    pc.dim(
      `Start it in another terminal:  swixter proxy start --profile ${profileName}`,
    ),
  );
  return false;
}

/**
 * Make the proxy auth token available to Codex.app (the GUI) so Codex can
 * send it as its bearer when talking to the local proxy.
 *
 * On macOS, GUI-launched apps do not inherit shell exports, so we use
 * `launchctl setenv`. On other platforms we print the export instruction.
 *
 * This is best-effort and never throws.
 */
export function setProxyAuthEnvForGUI(): void {
  try {
    if (process.platform === "darwin") {
      const child = spawn(
        "launchctl",
        ["setenv", SWIXTER_PROXY_ENV_KEY, SWIXTER_PROXY_AUTH_TOKEN],
        { stdio: "ignore" },
      );
      child.unref();
      console.log(
        pc.dim(
          `Set SWIXTER_PROXY_KEY via launchctl — restart Codex.app to pick it up.`,
        ),
      );
    } else {
      console.log(
        pc.dim(
          `Export the proxy token in your shell:  export ${SWIXTER_PROXY_ENV_KEY}=${SWIXTER_PROXY_AUTH_TOKEN}`,
        ),
      );
    }
  } catch (error) {
    console.warn(
      pc.yellow(
        `Could not set ${SWIXTER_PROXY_ENV_KEY}: ${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    console.warn(
      pc.dim(
        `Set it manually:  export ${SWIXTER_PROXY_ENV_KEY}=${SWIXTER_PROXY_AUTH_TOKEN}`,
      ),
    );
  }
}

// Re-exported for tests/CLI so they don't need to know the env-key helper's
// async shape just to feed a preset into resolveProviderEndpoints.
export { getEnvKey };
