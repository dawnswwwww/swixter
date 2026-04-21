import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as claudeCli from "../../src/cli/claude.js";
import * as childProcess from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import * as groupManager from "../../src/groups/manager.js";
import * as proxyServer from "../../src/proxy/server.js";
import * as configManager from "../../src/config/manager.js";
import {
  buildClaudeProxyEnv,
  buildCoderProxyEnv,
  handleProxyCommand,
  resolveProxyRuntimeBinding,
  waitForProxyHealth,
  waitForProxyRuntime,
} from "../../src/cli/proxy.js";
import {
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  SWIXTER_CLAUDE_HAIKU_MODEL,
  SWIXTER_CLAUDE_MODEL,
  SWIXTER_CLAUDE_SONNET_MODEL,
  SWIXTER_PROXY_AUTH_TOKEN,
} from "../../src/constants/proxy.js";
import { EXIT_CODES } from "../../src/constants/formatting.js";
import type { ProxyConfig, ProxyStatus } from "../../src/proxy/types.js";

describe("proxy constants", () => {
  test("should export the default local proxy constants", () => {
    expect(DEFAULT_PROXY_HOST).toBe("127.0.0.1");
    expect(DEFAULT_PROXY_PORT).toBe(15721);
    expect(SWIXTER_PROXY_AUTH_TOKEN).toBe("swixter-local-proxy");
  });

  test("should support proxy config values built from the default constants", () => {
    const config: ProxyConfig = {
      instanceId: "default",
      type: "service",
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      timeout: 3000000,
    };

    expect(config).toEqual({
      instanceId: "default",
      type: "service",
      host: "127.0.0.1",
      port: 15721,
      timeout: 3000000,
    });
  });

  test("should keep both proxy status group fields aligned for compatibility", () => {
    const status: ProxyStatus = {
      instanceId: "default",
      type: "service",
      running: true,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      activeGroup: "default-group",
      groupName: "default-group",
      requestCount: 0,
      errorCount: 0,
    };

    expect(status.groupName).toBe("default-group");
    expect(status.activeGroup).toBe(status.groupName);
  });
});

describe("resolveProxyRuntimeBinding", () => {
  test("allocates the default port when there is no existing runtime and no explicit port", () => {
    const binding = resolveProxyRuntimeBinding({
      groupName: "minimax",
      requestedPort: undefined,
      allInstances: [],
    });

    expect(binding).toEqual({
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      reuseExisting: false,
    });
  });

  test("reuses the same group runtime when no explicit port is provided", () => {
    const binding = resolveProxyRuntimeBinding({
      groupName: "minimax",
      requestedPort: undefined,
      allInstances: [{
        instanceId: "run-18001",
        type: "run",
        running: true,
        host: DEFAULT_PROXY_HOST,
        port: 18001,
        groupName: "minimax",
        requestCount: 0,
        errorCount: 0,
      }],
    });

    expect(binding).toEqual({
      host: DEFAULT_PROXY_HOST,
      port: 18001,
      reuseExisting: true,
      reuseInstanceId: "run-18001",
    });
  });

  test("uses the requested port when provided", () => {
    const binding = resolveProxyRuntimeBinding({
      groupName: "minimax",
      requestedPort: 19000,
      allInstances: [{
        instanceId: "run-18001",
        type: "run",
        running: true,
        host: DEFAULT_PROXY_HOST,
        port: 18001,
        groupName: "other-group",
        requestCount: 0,
        errorCount: 0,
      }],
    });

    expect(binding).toEqual({
      host: DEFAULT_PROXY_HOST,
      port: 19000,
      reuseExisting: false,
    });
  });

  test("chooses the next port when another group is already running and no explicit port is provided", () => {
    const binding = resolveProxyRuntimeBinding({
      groupName: "minimax",
      requestedPort: undefined,
      allInstances: [
        {
          instanceId: "default",
          type: "service",
          running: true,
          host: DEFAULT_PROXY_HOST,
          port: DEFAULT_PROXY_PORT,
          groupName: "other-group",
          requestCount: 0,
          errorCount: 0,
        },
      ],
    });

    expect(binding).toEqual({
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT + 1,
      reuseExisting: false,
    });
  });
});

describe("buildCoderProxyEnv", () => {
  test("uses Claude proxy auth token flow", () => {
    const env = buildCoderProxyEnv("claude", { ANTHROPIC_API_KEY: "stale" }, 18001);

    expect(env.ANTHROPIC_API_BASE).toBe("http://127.0.0.1:18001");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(SWIXTER_PROXY_AUTH_TOKEN);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("keeps qwen on api key flow", () => {
    const env = buildCoderProxyEnv("qwen", {}, 18001);

    expect(env.ANTHROPIC_API_BASE).toBe("http://127.0.0.1:18001");
    expect(env.ANTHROPIC_API_KEY).toBe("dummy");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  test("keeps codex on openai proxy env", () => {
    const env = buildCoderProxyEnv("codex", {}, 18001);

    expect(env.OPENAI_API_BASE).toBe("http://127.0.0.1:18001");
    expect(env.OPENAI_API_KEY).toBe("dummy");
  });
});

describe("handleProxyCommand start --daemon", () => {
  const originalExit = process.exit;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(groupManager, "getGroup").mockImplementation(async (name) => ({
      id: `${name}-id`,
      name,
      profiles: ["profile-1"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  });

  afterEach(() => {
    process.exit = originalExit;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  test("fails daemon startup before spawning when the requested group does not exist", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "default",
      type: "service",
      running: false,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(groupManager, "getGroup").mockResolvedValue(null);
    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      unref: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exitSpy = vi.fn() as typeof process.exit;
    process.exit = exitSpy;

    await handleProxyCommand(["start", "--group", "missing-group", "--daemon"]);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Group \"missing-group\" not found"));
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.notFound);
  });

  test("validates an explicit missing group before reporting an existing running proxy", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "default",
      type: "service",
      running: true,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(groupManager, "getGroup").mockResolvedValue(null);
    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      unref: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exitSpy = vi.fn() as typeof process.exit;
    process.exit = exitSpy;

    await handleProxyCommand(["start", "--group", "missing-group", "--daemon"]);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Group \"missing-group\" not found"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Proxy already running"));
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.notFound);
  });

  test("fails daemon startup when health responds but shared runtime metadata is still missing", async () => {
    vi.spyOn(proxyServer, "getProxyStatus")
      .mockReturnValueOnce({
        instanceId: "default",
        type: "service",
        running: false,
        host: DEFAULT_PROXY_HOST,
        port: DEFAULT_PROXY_PORT,
        requestCount: 0,
        errorCount: 0,
      })
      .mockReturnValue({
        instanceId: "default",
        type: "service",
        running: false,
        host: DEFAULT_PROXY_HOST,
        port: DEFAULT_PROXY_PORT,
        requestCount: 0,
        errorCount: 0,
      });

    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      unref: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    const healthSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));

    const exitSpy = vi.fn() as typeof process.exit;
    process.exit = exitSpy;

    await handleProxyCommand(["start", "--group", "minimax", "--port", "18731", "--daemon"]);

    expect(spawnSpy).toHaveBeenCalled();
    expect(healthSpy).toHaveBeenCalledWith("http://127.0.0.1:18731/health");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("waitForProxyRuntime only succeeds when shared runtime status matches the requested binding", async () => {
    const listSpy = vi.spyOn(proxyServer, "listProxyInstances")
      .mockReturnValueOnce([])
      .mockReturnValueOnce([{
        instanceId: "default",
        type: "service",
        running: true,
        host: DEFAULT_PROXY_HOST,
        port: 19999,
        requestCount: 0,
        errorCount: 0,
      }])
      .mockReturnValue([{
        instanceId: "default",
        type: "service",
        running: true,
        host: DEFAULT_PROXY_HOST,
        port: 18731,
        requestCount: 0,
        errorCount: 0,
      }]);

    expect(await waitForProxyRuntime(DEFAULT_PROXY_HOST, 18731, 3)).toBe(true);
    expect(listSpy).toHaveBeenCalledTimes(3);
  });
});

describe("handleProxyCommand run", () => {
  const originalExit = process.exit;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(groupManager, "getGroup").mockImplementation(async (name) => ({
      id: `${name}-id`,
      name,
      profiles: ["profile-1"],
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  test("fails clearly when proxy run uses a missing group", async () => {
    vi.spyOn(groupManager, "getGroup").mockResolvedValue(null);
    const startSpy = vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined);
    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exitSpy = vi.fn() as typeof process.exit;
    process.exit = exitSpy;

    await handleProxyCommand(["run", "--group", "missing-group", "--", "claude"]);

    expect(startSpy).not.toHaveBeenCalled();
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Group \"missing-group\" not found"));
    expect(exitSpy).toHaveBeenCalledWith(EXIT_CODES.notFound);
  });

  test("passes groupName when starting a new proxy runtime", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "default",
      type: "service",
      running: false,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(proxyServer, "listProxyInstances").mockReturnValue([]);

    const startSpy = vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined as any);
    vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    await handleProxyCommand(["run", "--group", "minimax", "--", "claude"]);

    expect(startSpy).toHaveBeenCalledWith({
      instanceId: "run-15721",
      type: "run",
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      groupName: "minimax",
    });
  });

  test("uses explicit port for proxy run", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "run-18001",
      type: "run",
      running: true,
      host: DEFAULT_PROXY_HOST,
      port: 18001,
      groupName: "other-group",
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(proxyServer, "listProxyInstances").mockReturnValue([{
      instanceId: "run-18001",
      type: "run",
      running: true,
      host: DEFAULT_PROXY_HOST,
      port: 18001,
      groupName: "other-group",
      requestCount: 0,
      errorCount: 0,
    }]);

    const startSpy = vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined as any);
    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    await handleProxyCommand(["run", "--group", "minimax", "--port", "19000", "--", "claude"]);

    expect(startSpy).toHaveBeenCalledWith({
      instanceId: "run-19000",
      type: "run",
      host: DEFAULT_PROXY_HOST,
      port: 19000,
      groupName: "minimax",
    });

    const env = spawnSpy.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv;
    expect(env.ANTHROPIC_API_BASE).toBe("http://127.0.0.1:19000");
  });

  test("writes Claude proxy settings through the Claude apply path before launch", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "default",
      type: "service",
      running: false,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(proxyServer, "listProxyInstances").mockReturnValue([]);

    vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined);
    const applySpy = vi.spyOn(claudeCli, "applyClaudeProfile").mockResolvedValue(undefined);

    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    await handleProxyCommand(["run", "--group", "minimax", "--", "claude"]);

    expect(applySpy).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "anthropic",
      baseURL: "http://127.0.0.1:15721",
      authToken: SWIXTER_PROXY_AUTH_TOKEN,
      apiKey: "",
    }));
    expect(spawnSpy).toHaveBeenCalled();
  });

  test("writes Claude proxy marker models from the first group profile before launch", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "default",
      type: "service",
      running: false,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(proxyServer, "listProxyInstances").mockReturnValue([]);

    vi.spyOn(configManager, "getProfile").mockResolvedValue({
      name: "profile-1",
      providerId: "anthropic",
      apiKey: "test-key",
      model: "fallback-model",
      models: {
        defaultHaikuModel: "claude-haiku-4-20250506",
        defaultSonnetModel: "claude-sonnet-4-20250514",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined);
    const applySpy = vi.spyOn(claudeCli, "applyClaudeProfile").mockResolvedValue(undefined);
    vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    await handleProxyCommand(["run", "--group", "minimax", "--", "claude"]);

    expect(applySpy).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "anthropic",
      baseURL: "http://127.0.0.1:15721",
      authToken: SWIXTER_PROXY_AUTH_TOKEN,
      apiKey: "",
      models: {
        anthropicModel: SWIXTER_CLAUDE_MODEL,
        defaultHaikuModel: SWIXTER_CLAUDE_HAIKU_MODEL,
        defaultSonnetModel: SWIXTER_CLAUDE_SONNET_MODEL,
      },
    }));
  });

  test("delegates claude runs to the existing claude command flow with proxy settings", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "default",
      type: "service",
      running: false,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(proxyServer, "listProxyInstances").mockReturnValue([]);

    vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined);

    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    await handleProxyCommand(["run", "--group", "minimax", "--", "claude", "--print", "hi"]);

    expect(spawnSpy).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--print", "hi", "--settings"]),
      expect.objectContaining({
        stdio: "inherit",
        shell: true,
        env: expect.objectContaining({
          ANTHROPIC_API_BASE: "http://127.0.0.1:15721",
          ANTHROPIC_AUTH_TOKEN: SWIXTER_PROXY_AUTH_TOKEN,
        }),
      })
    );

    const spawnArgs = spawnSpy.mock.calls[0]?.[1] as string[];
    const settingsIndex = spawnArgs.indexOf("--settings");
    expect(settingsIndex).toBeGreaterThanOrEqual(0);

    const settingsPath = spawnArgs[settingsIndex + 1];
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as { env: NodeJS.ProcessEnv };
    expect(settings.env.ANTHROPIC_API_BASE).toBe("http://127.0.0.1:15721");
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe(SWIXTER_PROXY_AUTH_TOKEN);
    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();

    rmSync(settingsPath, { force: true });
  });

  test("reuses the running group port and injects Claude auth env", async () => {
    vi.spyOn(groupManager, "getActiveGroup").mockResolvedValue({
      name: "minimax",
      profiles: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "run-18001",
      type: "run",
      running: true,
      host: DEFAULT_PROXY_HOST,
      port: 18001,
      groupName: "minimax",
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(proxyServer, "listProxyInstances").mockReturnValue([{
      instanceId: "run-18001",
      type: "run",
      running: true,
      host: DEFAULT_PROXY_HOST,
      port: 18001,
      groupName: "minimax",
      requestCount: 0,
      errorCount: 0,
    }]);
    const startSpy = vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined);
    const stopSpy = vi.spyOn(proxyServer, "stopProxyServer").mockResolvedValue(undefined);
    const onSpy = vi.fn();
    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: onSpy,
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    await handleProxyCommand(["run", "--", "claude"]);

    expect(startSpy).not.toHaveBeenCalled();
    expect(spawnSpy).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["--settings"]),
      expect.objectContaining({
        stdio: "inherit",
        shell: true,
        env: expect.objectContaining({
          ANTHROPIC_API_BASE: "http://127.0.0.1:18001",
          ANTHROPIC_AUTH_TOKEN: SWIXTER_PROXY_AUTH_TOKEN,
        }),
      })
    );
    const spawnEnv = spawnSpy.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv;
    const spawnArgs = spawnSpy.mock.calls[0]?.[1] as string[];
    const settingsIndex = spawnArgs.indexOf("--settings");
    expect(settingsIndex).toBeGreaterThanOrEqual(0);

    const settingsPath = spawnArgs[settingsIndex + 1];
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as { env: NodeJS.ProcessEnv };
    expect(settings.env.ANTHROPIC_API_BASE).toBe("http://127.0.0.1:18001");
    expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe(SWIXTER_PROXY_AUTH_TOKEN);
    expect(settings.env.ANTHROPIC_API_KEY).toBeUndefined();

    rmSync(settingsPath, { force: true });
    expect(spawnEnv.ANTHROPIC_AUTH_TOKEN).toBe(SWIXTER_PROXY_AUTH_TOKEN);
    expect(stopSpy).not.toHaveBeenCalled();
  });

  test("starts a new runtime on the next port when another group is already running", async () => {
    vi.spyOn(proxyServer, "getProxyStatus").mockReturnValue({
      instanceId: "default",
      type: "service",
      running: true,
      host: DEFAULT_PROXY_HOST,
      port: DEFAULT_PROXY_PORT,
      groupName: "other-group",
      requestCount: 0,
      errorCount: 0,
    });
    vi.spyOn(proxyServer, "listProxyInstances").mockReturnValue([
      {
        instanceId: "default",
        type: "service",
        running: true,
        host: DEFAULT_PROXY_HOST,
        port: DEFAULT_PROXY_PORT,
        groupName: "other-group",
        requestCount: 0,
        errorCount: 0,
      },
      {
        instanceId: "run-18001",
        type: "run",
        running: true,
        host: DEFAULT_PROXY_HOST,
        port: 18001,
        groupName: "yet-another-group",
        requestCount: 0,
        errorCount: 0,
      },
    ]);
    const startSpy = vi.spyOn(proxyServer, "startProxyServer").mockResolvedValue(undefined);
    vi.spyOn(proxyServer, "stopProxyServer").mockResolvedValue(undefined);
    const spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      kill: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);

    await handleProxyCommand(["run", "--group", "minimax", "--", "claude"]);

    expect(startSpy).toHaveBeenCalledWith({
      instanceId: "run-15722",
      type: "run",
      host: DEFAULT_PROXY_HOST,
      port: 15722,
      groupName: "minimax",
    });
    const spawnEnv = spawnSpy.mock.calls[0]?.[2]?.env as NodeJS.ProcessEnv;
    expect(spawnEnv.ANTHROPIC_API_BASE).toBe("http://127.0.0.1:15722");
    expect(spawnEnv.ANTHROPIC_AUTH_TOKEN).toBe(SWIXTER_PROXY_AUTH_TOKEN);
  });
});
