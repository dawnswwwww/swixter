import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as childProcess from "node:child_process";
import { spawnClaudeWithEnv } from "../../src/cli/claude.js";

const baseEnv = { ANTHROPIC_API_KEY: "sk-test" };

function getSpawnArgs(spawnSpy: ReturnType<typeof vi.spyOn>): string[] {
  const calls = spawnSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  // spawn(command, args, options) -> args is index 1
  return calls[calls.length - 1][1] as string[];
}

describe("spawnClaudeWithEnv yolo flag", () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.fn>;
  const originalExit = process.exit;

  beforeEach(() => {
    // Mock spawn to return a fake child that never actually runs
    spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      unref: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);
    // Silence console output
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Mock process.exit so tests don't terminate
    exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  test("yolo=true adds --dangerously-skip-permissions to spawn args", async () => {
    await spawnClaudeWithEnv([], baseEnv, { yolo: true });
    const args = getSpawnArgs(spawnSpy);
    expect(args).toContain("--dangerously-skip-permissions");
  });

  test("yolo=false does not add --dangerously-skip-permissions", async () => {
    await spawnClaudeWithEnv([], baseEnv, { yolo: false });
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  test("yolo=undefined does not add --dangerously-skip-permissions", async () => {
    await spawnClaudeWithEnv([], baseEnv, {});
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  test("yolo=true is strictly boolean (string 'true' is ignored)", async () => {
    await spawnClaudeWithEnv([], baseEnv, { yolo: "true" as unknown as boolean });
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  test("--dangerously-skip-permissions in args + yolo=true does not duplicate", async () => {
    await spawnClaudeWithEnv(["--dangerously-skip-permissions"], baseEnv, { yolo: true });
    const args = getSpawnArgs(spawnSpy);
    const occurrences = args.filter((a) => a === "--dangerously-skip-permissions").length;
    expect(occurrences).toBe(1);
  });

  test("--yolo in args is filtered out (not passed to claude)", async () => {
    await spawnClaudeWithEnv(["--yolo", "--print", "hello"], baseEnv, { yolo: true });
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--yolo");
    expect(args).toContain("--print");
    expect(args[args.indexOf("--print") + 1]).toBe("hello");
  });
});
