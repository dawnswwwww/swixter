/**
 * Proxy server (saveRegistry) tests
 *
 * Focus: regression test for the fresh-install mkdir bug in saveRegistry.
 *
 * The other internal helpers (loadRegistry, updateInstanceInRegistry, etc.)
 * are not part of the proxy module's public API, so we expose one of them
 * (updateInstanceInRegistry) purely for testing purposes. Adding `export`
 * is a non-breaking additive change — the function's signature and
 * behavior are unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "../../src/constants/paths.js";
import { updateInstanceInRegistry } from "../../src/proxy/server.js";
import type { ProxyStatus } from "../../src/proxy/types.js";

const SWIXTER_DIR = getConfigDir("swixter");
const REGISTRY_PATH = join(SWIXTER_DIR, "proxy-instances.json");

// Minimal valid ProxyStatus fixture — only the fields required for the
// saveRegistry path matter; the rest are defaults.
const sampleStatus: ProxyStatus = {
  instanceId: "test-instance",
  type: "service",
  running: false,
  host: "127.0.0.1",
  port: 3141,
  requestCount: 0,
  errorCount: 0,
};

describe("Proxy Server — saveRegistry fresh install", () => {
  beforeEach(async () => {
    // Simulate fresh install: remove the entire swixter config dir.
    // Same pattern as the auth and daemon tests — without this, a previous
    // test could leave the dir in place and the mkdir would be a no-op,
    // hiding the bug we're testing for.
    await rm(SWIXTER_DIR, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(SWIXTER_DIR, { recursive: true, force: true });
  });

  it("should create the swixter config dir and registry file on a fresh install", () => {
    // Bug: on a fresh install, the swixter config dir does not exist,
    // and saveRegistry() did not create it before writeFileSync — so
    // writeFileSync threw ENOENT the first time any proxy lifecycle
    // function (startProxyServer, stopProxyServer, etc.) tried to
    // persist state. Same root cause as the auth + daemon mkdir fixes
    // (commits 601cdc8, 60fafaa).
    expect(existsSync(SWIXTER_DIR)).toBe(false);
    expect(existsSync(REGISTRY_PATH)).toBe(false);

    // This call exercises updateInstanceInRegistry → saveRegistry.
    // Without the mkdir fix, writeFileSync throws ENOENT and the test fails.
    updateInstanceInRegistry(sampleStatus);

    // Both the parent dir and the registry file should now exist.
    expect(existsSync(SWIXTER_DIR)).toBe(true);
    expect(existsSync(REGISTRY_PATH)).toBe(true);

    // And the persisted data should round-trip back as the same fixture.
    const raw = readFileSync(REGISTRY_PATH, "utf-8");
    const parsed = JSON.parse(raw) as { instances: Record<string, ProxyStatus> };
    expect(parsed.instances[sampleStatus.instanceId]).toEqual(sampleStatus);
  });
});
