import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProxyLogger } from "../../src/proxy/logger.js";

describe("proxyLogger file output", () => {
  const originalConfigPath = process.env.SWIXTER_CONFIG_PATH;
  let testConfigDir: string;
  let testConfigPath: string;

  beforeEach(() => {
    testConfigDir = mkdtempSync(join(tmpdir(), "swixter-proxy-logger-"));
    testConfigPath = join(testConfigDir, "config.json");
    process.env.SWIXTER_CONFIG_PATH = testConfigPath;
    writeFileSync(testConfigPath, JSON.stringify({
      version: "2.0.0",
      profiles: {},
      coders: {},
      groups: {},
    }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(testConfigDir, { recursive: true, force: true });
    if (originalConfigPath === undefined) {
      delete process.env.SWIXTER_CONFIG_PATH;
    } else {
      process.env.SWIXTER_CONFIG_PATH = originalConfigPath;
    }
  });

  test("writes info records to proxy-default.log in the swixter config directory", () => {
    const logPath = join(testConfigDir, "proxy-default.log");
    const logger = createProxyLogger("default");

    logger.info("Incoming request", { method: "POST", path: "/v1/messages" });

    expect(existsSync(logPath)).toBe(true);
    const line = readFileSync(logPath, "utf-8").trim();
    expect(JSON.parse(line)).toEqual(expect.objectContaining({
      level: "info",
      msg: "Incoming request",
      method: "POST",
      path: "/v1/messages",
    }));
  });

  test("rotates proxy-default.log to proxy-default.log.1 when the active log reaches 100MB", () => {
    const logPath = join(testConfigDir, "proxy-default.log");
    const rotatedPath = join(testConfigDir, "proxy-default.log.1");
    const hundredMb = 100 * 1024 * 1024;

    writeFileSync(logPath, "x".repeat(hundredMb));
    const logger = createProxyLogger("default");

    logger.warn("No active group or profiles");

    expect(existsSync(rotatedPath)).toBe(true);
    const rotatedContent = readFileSync(rotatedPath, "utf-8");
    expect(rotatedContent.length).toBe(hundredMb);

    const currentLine = readFileSync(logPath, "utf-8").trim();
    expect(JSON.parse(currentLine)).toEqual(expect.objectContaining({
      level: "warn",
      msg: "No active group or profiles",
    }));
  });

  test("replaces the previous proxy-default.log.1 during a new rotation", () => {
    const logPath = join(testConfigDir, "proxy-default.log");
    const rotatedPath = join(testConfigDir, "proxy-default.log.1");
    const hundredMb = 100 * 1024 * 1024;

    writeFileSync(rotatedPath, "old-backup");
    writeFileSync(logPath, "x".repeat(hundredMb));
    const logger = createProxyLogger("default");

    logger.error("Forward failed", new Error("boom"));

    const rotatedContent = readFileSync(rotatedPath, "utf-8");
    expect(rotatedContent).not.toBe("old-backup");
    expect(rotatedContent.length).toBe(hundredMb);
  });

  test("swallows file write failures instead of throwing", () => {
    const logPath = join(testConfigDir, "proxy-default.log");
    mkdirSync(logPath);
    const logger = createProxyLogger("default");

    expect(() => {
      logger.request("POST", "/v1/messages", 503, 2);
    }).not.toThrow();
  });

  test("does not write proxy logger records to the terminal", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createProxyLogger("default");

    logger.info("Incoming request", { path: "/v1/messages" });
    logger.request("POST", "/v1/messages", 503, 2);
    logger.warn("No active group or profiles");
    logger.error("Forward failed", new Error("boom"));

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
