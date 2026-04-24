import pc from "picocolors";
import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import type { ClaudeCodeProfile } from "../types.js";
import { getProfile } from "../config/manager.js";
import { spawnClaudeWithEnv, applyClaudeProfile } from "./claude.js";
import {
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  SWIXTER_PROXY_AUTH_TOKEN,
} from "../constants/proxy.js";
import { buildClaudeProxyMarkerModels } from "../utils/model-helper.js";
import { EXIT_CODES } from "../constants/formatting.js";
import {
  startProxyServer,
  stopProxyServer,
  getProxyStatus,
  listProxyInstances,
} from "../proxy/server.js";
import { getActiveGroup, getGroup } from "../groups/manager.js";

export function resolveProxyRuntimeBinding(input: {
  groupName: string;
  requestedPort?: number;
  allInstances: ReturnType<typeof listProxyInstances>;
}): { host: string; port: number; reuseExisting: boolean; reuseInstanceId?: string } {
  const occupiedPorts = new Set(
    input.allInstances.filter((s) => s.running).map((s) => s.port)
  );

  // Explicit port requested
  if (input.requestedPort) {
    return {
      host: DEFAULT_PROXY_HOST,
      port: input.requestedPort,
      reuseExisting: false,
    };
  }

  // Check if any existing instance already serves this group
  const existing = input.allInstances.find(
    (s) => s.running && s.groupName === input.groupName
  );
  if (existing) {
    return {
      host: existing.host,
      port: existing.port,
      reuseExisting: true,
      reuseInstanceId: existing.instanceId,
    };
  }

  // Find next available port starting from default
  let port = DEFAULT_PROXY_PORT;
  while (occupiedPorts.has(port)) {
    port++;
  }

  return {
    host: DEFAULT_PROXY_HOST,
    port,
    reuseExisting: false,
  };
}

export function buildClaudeProxyEnv(
  env: NodeJS.ProcessEnv,
  port: number
): NodeJS.ProcessEnv {
  const nextEnv = { ...env };
  nextEnv.ANTHROPIC_API_BASE = `http://${DEFAULT_PROXY_HOST}:${port}`;
  nextEnv.ANTHROPIC_AUTH_TOKEN = SWIXTER_PROXY_AUTH_TOKEN;
  delete nextEnv.ANTHROPIC_API_KEY;
  return nextEnv;
}

export function buildCoderProxyEnv(
  coder: string,
  baseEnv: NodeJS.ProcessEnv,
  port: number
): NodeJS.ProcessEnv {
  if (coder === "claude") {
    return buildClaudeProxyEnv(baseEnv, port);
  }

  const env = { ...baseEnv };

  if (coder === "qwen") {
    env.ANTHROPIC_API_BASE = `http://${DEFAULT_PROXY_HOST}:${port}`;
    env.ANTHROPIC_API_KEY = "dummy";
    delete env.ANTHROPIC_AUTH_TOKEN;
  } else if (coder === "codex") {
    env.OPENAI_API_BASE = `http://${DEFAULT_PROXY_HOST}:${port}`;
    env.OPENAI_API_KEY = "dummy";
  }

  return env;
}

export async function waitForProxyHealth(host: string, port: number, attempts = 10): Promise<boolean> {
  const url = `http://${host}:${port}/health`;

  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return true;
      }
    } catch {
      // Continue polling until attempts are exhausted.
    }

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}

export async function waitForProxyRuntime(host: string, port: number, attempts = 10): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const instances = listProxyInstances();
    const match = instances.find((s) => s.running && s.host === host && s.port === port);
    if (match) return true;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return false;
}

export async function handleProxyCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "start":
      await cmdStart(args.slice(1));
      break;
    case "stop":
      await cmdStop(args.slice(1));
      break;
    case "run":
      await cmdRun(args.slice(1));
      break;
    case "status":
      await cmdStatus();
      break;
    default:
      if (!subcommand || subcommand === "status") {
        await cmdStatus();
      } else {
        console.log(pc.red(`Unknown subcommand: ${subcommand}`));
        console.log(proxyHelp());
        process.exit(1);
      }
  }
}

async function cmdStart(args: string[]): Promise<void> {
  let groupName: string | undefined;
  let port: number | undefined;
  let host = "127.0.0.1";
  let timeout = 3000000;
  let daemon = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--group" && args[i + 1]) {
      groupName = args[i + 1];
      i++;
    } else if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--host" && args[i + 1]) {
      host = args[i + 1];
      i++;
    } else if (args[i] === "--timeout" && args[i + 1]) {
      timeout = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--daemon") {
      daemon = true;
    }
  }

  if (groupName) {
    const group = await getGroup(groupName);
    if (!group) {
      console.log(pc.red(`Group "${groupName}" not found`));
      process.exit(EXIT_CODES.notFound);
      return;
    }
  }

  // Check if default instance is already running
  const defaultStatus = getProxyStatus("default");
  if (defaultStatus.running) {
    console.log(pc.yellow(`Default proxy already running on ${defaultStatus.host}:${defaultStatus.port}`));
    return;
  }

  if (!groupName) {
    const activeGroup = await getActiveGroup();
    if (activeGroup) {
      groupName = activeGroup.name;
      console.log(pc.dim(`Using default group: ${groupName}`));
    }
  }

  const resolvedPort = port || DEFAULT_PROXY_PORT;

  if (daemon) {
    await cmdStartDaemon({ host, port: resolvedPort, timeout, groupName });
  } else {
    await cmdStartBlocking({ host, port: resolvedPort, timeout, groupName });
  }
}

async function cmdStartBlocking(config: { host: string; port: number; timeout: number; groupName?: string }): Promise<void> {
  console.log(pc.cyan("Starting proxy server..."));

  await startProxyServer({
    instanceId: "default",
    type: "service",
    host: config.host,
    port: config.port,
    timeout: config.timeout,
    groupName: config.groupName,
  });

  console.log();
  console.log(pc.green("✓ Proxy server started"));
  console.log(`  Instance: default (service)`);
  console.log(`  Address: ${config.host}:${config.port}`);
  console.log(`  Timeout: ${config.timeout}ms`);
  console.log(pc.dim(`  Group: ${config.groupName || "none"}`));
  console.log(pc.dim(`  Endpoints:`));
  console.log(pc.dim(`    - /v1/chat/completions (OpenAI)`));
  console.log(pc.dim(`    - /v1/messages (Anthropic)`));
  console.log(pc.dim(`    - /v1/responses (Anthropic)`));
  console.log(pc.dim(`    - /anthropic/* (Anthropic)`));
  console.log(pc.dim(`    - /health (Health check)`));
  console.log();
  console.log(pc.dim("Press Ctrl+C to stop"));
}

async function cmdStartDaemon(config: { host: string; port: number; timeout: number; groupName?: string }): Promise<void> {
  const defaultStatus = getProxyStatus("default");
  if (defaultStatus.running) {
    console.log(pc.yellow(`Default proxy already running on ${defaultStatus.host}:${defaultStatus.port}`));
    return;
  }

  console.log(pc.cyan("Starting proxy server in background..."));

  const args = [
    "proxy",
    "start",
    "--host", config.host,
    "--port", config.port.toString(),
    "--timeout", config.timeout.toString(),
  ];

  if (config.groupName) {
    args.push("--group", config.groupName);
  }

  const child = spawn(process.execPath, [process.argv[1], ...args], {
    detached: true,
    stdio: "ignore",
  });

  child.unref();

  const isHealthy = await waitForProxyHealth(config.host, config.port);
  const hasRuntime = isHealthy
    ? await waitForProxyRuntime(config.host, config.port)
    : false;

  if (isHealthy && hasRuntime) {
    console.log(pc.green("✓ Proxy server started in background"));
    console.log(`  Instance: default (service)`);
    console.log(`  Address: ${config.host}:${config.port}`);
    console.log(pc.dim(`  Use "swixter proxy status" to check status`));
    console.log(pc.dim(`  Use "swixter proxy stop" to stop`));
  } else {
    console.log(pc.red("✗ Failed to start proxy server in background"));
    process.exit(1);
  }
}

async function cmdStop(args: string[]): Promise<void> {
  // Support: swixter proxy stop [instanceId]
  const instanceId = args[0] || "default";
  const status = getProxyStatus(instanceId);

  if (!status.running) {
    console.log(pc.yellow(`Proxy instance "${instanceId}" is not running`));
    return;
  }

  await stopProxyServer(instanceId);
  console.log(pc.green(`✓ Proxy instance "${instanceId}" stopped`));
}

async function cmdRun(args: string[]): Promise<void> {
  const doubleDash = args.indexOf("--");
  let groupArgs: string[] = [];
  let coderArgs: string[] = [];

  if (doubleDash >= 0) {
    groupArgs = args.slice(0, doubleDash);
    coderArgs = args.slice(doubleDash + 1);
  } else {
    groupArgs = args;
  }

  let groupName: string | undefined;
  let requestedPort: number | undefined;
  for (let i = 0; i < groupArgs.length; i++) {
    if (groupArgs[i] === "--group" && groupArgs[i + 1]) {
      groupName = groupArgs[i + 1];
      i++;
    } else if (groupArgs[i] === "--port" && groupArgs[i + 1]) {
      requestedPort = parseInt(groupArgs[i + 1], 10);
      i++;
    }
  }

  if (!groupName) {
    const activeGroup = await getActiveGroup();
    groupName = activeGroup?.name;
  }

  if (!groupName) {
    console.log(pc.red("No group specified and no default group set"));
    console.log(pc.dim("Use --group or create a default group first"));
    return;
  }

  const group = await getGroup(groupName);
  if (!group) {
    console.log(pc.red(`Group "${groupName}" not found`));
    process.exit(EXIT_CODES.notFound);
    return;
  }

  console.log(pc.cyan("Starting proxy server..."));
  const allInstances = listProxyInstances();
  const runtimeBinding = resolveProxyRuntimeBinding({
    groupName,
    requestedPort,
    allInstances,
  });

  const instanceId = `run-${runtimeBinding.port}`;

  if (!runtimeBinding.reuseExisting) {
    await startProxyServer({
      instanceId,
      type: "run",
      host: runtimeBinding.host,
      port: runtimeBinding.port,
      groupName,
    });
  }

  const coder = coderArgs[0];
  if (!coder) {
    console.log(pc.red("Coder command required after --"));
    console.log(pc.dim("Example: swixter proxy run -- claude"));
    await stopProxyServer(instanceId);
    return;
  }

  const env = buildCoderProxyEnv(coder, process.env, runtimeBinding.port);

  console.log(pc.green(`✓ Running: ${coder} ${coderArgs.slice(1).join(" ")}`));
  console.log(pc.dim(`  Instance: ${instanceId} (run)`));
  console.log(pc.dim(`  Proxy: ${runtimeBinding.host}:${runtimeBinding.port}`));

  if (coder === "claude") {
    const firstProfile = group.profiles[0] ? await getProfile(group.profiles[0]) : null;
    const proxyProfile: ClaudeCodeProfile = {
      name: `proxy-${groupName}`,
      providerId: "anthropic",
      apiKey: "",
      authToken: SWIXTER_PROXY_AUTH_TOKEN,
      baseURL: `http://${runtimeBinding.host}:${runtimeBinding.port}`,
      models: firstProfile ? buildClaudeProxyMarkerModels(firstProfile) : undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await applyClaudeProfile(proxyProfile);
    await spawnClaudeWithEnv(coderArgs.slice(1), env as Record<string, string>, {
      onExit: async () => {
        await stopProxyServer(instanceId);
      },
    });
    return;
  }

  const child = spawn(coder, coderArgs.slice(1), {
    env,
    stdio: "inherit",
  });

  child.on("exit", async (code) => {
    await stopProxyServer(instanceId);
    process.exit(code || 0);
  });

  process.on("SIGINT", async () => {
    child.kill("SIGINT");
    await stopProxyServer(instanceId);
    process.exit(1);
  });
}

async function cmdStatus(): Promise<void> {
  const instances = listProxyInstances();

  console.log();
  console.log(pc.bold("Proxy Status:"));
  console.log();

  const running = instances.filter((s) => s.running);

  if (running.length === 0) {
    console.log(`  ${pc.red("●")} No proxy instances running`);
    console.log();
    console.log(pc.dim("  Start with: swixter proxy start"));
    return;
  }

  for (const status of running) {
    const typeLabel = status.type === "service" ? pc.cyan("service") : pc.yellow("run");
    console.log(`  ${pc.green("●")} ${pc.bold(status.instanceId)} (${typeLabel})`);
    console.log(`    Address: ${status.host}:${status.port}`);
    console.log(`    Group: ${status.groupName || "none"}`);
    console.log(`    Requests: ${status.requestCount} | Errors: ${status.errorCount}`);
    if (status.startTime) {
      console.log(`    Started: ${status.startTime}`);
    }
    console.log();
  }
}

function proxyHelp(): string {
  return `
${pc.bold("Swixter Proxy Commands")}

${pc.bold("Usage:")}
  ${pc.green("swixter proxy <command> [options]")}

${pc.bold("Commands:")}
  ${pc.cyan("start")}              Start proxy server (default instance)
  ${pc.cyan("stop")} [instanceId]  Stop proxy instance (default: "default")
  ${pc.cyan("run")}                Start proxy and run coder with env vars
  ${pc.cyan("status")}             Show all proxy instances

${pc.bold("Options:")}
  ${pc.dim("--group <name>")}      Use specified group
  ${pc.dim("--port <port>")}       Proxy port (default: 15721)
  ${pc.dim("--host <host>")}       Proxy host (default: 127.0.0.1)
  ${pc.dim("--timeout <ms>")}      Request timeout in ms (default: 3000000)
  ${pc.dim("--daemon")}             Run in background (detached)

${pc.bold("Examples:")}
  ${pc.green("swixter proxy start")}
  ${pc.green("swixter proxy start --daemon")}
  ${pc.green("swixter proxy start --group my-group")}
  ${pc.green("swixter proxy run --group my-group -- claude")}
  ${pc.green("swixter proxy stop")}
  ${pc.green("swixter proxy stop run-15722")}
  ${pc.dim("  # Stop a specific run instance")}
`;
}
