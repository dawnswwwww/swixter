import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import {
  loadTestConfig,
  saveTestConfig,
  upsertTestProfile,
  setActiveTestProfile,
  getActiveTestProfile,
  deleteTestProfile,
  listTestProfiles,
} from "./test-config-manager.js";
import type { ClaudeCodeProfile } from "../src/types.js";
import { existsSync, rmSync } from "node:fs";

const TEST_CONFIG_PATH = "/tmp/swixter-test-config.json";

describe("配置管理器", () => {
  // 每个测试前清理
  beforeEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }
  });

  // 每个测试后清理
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }
  });

  test("应该能够创建默认配置", async () => {
    const config = await loadTestConfig();
    expect(config.version).toBeDefined();
    expect(config.profiles).toEqual({});
    expect(config.activeProfile).toBe("");
  });

  test("应该能够保存和加载配置", async () => {
    const testProfile: ClaudeCodeProfile = {
      name: "test-profile",
      providerId: "anthropic",
      apiKey: "test-api-key",
      model: "claude-3-5-sonnet-20241022",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertTestProfile(testProfile);

    const loaded = await getActiveTestProfile();
    expect(loaded?.name).toBe("test-profile");
    expect(loaded?.providerId).toBe("anthropic");
    expect(loaded?.apiKey).toBe("test-api-key");
  });

  test("应该能够切换活跃配置", async () => {
    const profile1: ClaudeCodeProfile = {
      name: "profile-1",
      providerId: "anthropic",
      apiKey: "key-1",
      model: "claude-3-5-sonnet",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const profile2: ClaudeCodeProfile = {
      name: "profile-2",
      providerId: "openrouter",
      apiKey: "key-2",
      model: "claude-3-opus",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertTestProfile(profile1);
    await setActiveTestProfile("profile-1");

    let active = await getActiveTestProfile();
    expect(active?.name).toBe("profile-1");

    await upsertTestProfile(profile2);
    await setActiveTestProfile("profile-2");

    active = await getActiveTestProfile();
    expect(active?.name).toBe("profile-2");
  });

  test("应该能够删除配置", async () => {
    const profile: ClaudeCodeProfile = {
      name: "to-delete",
      providerId: "minimax",
      apiKey: "key",
      model: "abab6.5s-chat",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertTestProfile(profile);
    let profiles = await listTestProfiles();
    expect(profiles.length).toBeGreaterThan(0);

    await deleteTestProfile("to-delete");
    profiles = await listTestProfiles();

    const deleted = profiles.find(p => p.name === "to-delete");
    expect(deleted).toBeUndefined();
  });

  test("应该能够列出所有配置", async () => {
    const profile1: ClaudeCodeProfile = {
      name: "list-test-1",
      providerId: "zhipu",
      apiKey: "key-1",
      model: "glm-4",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const profile2: ClaudeCodeProfile = {
      name: "list-test-2",
      providerId: "moonshot",
      apiKey: "key-2",
      model: "moonshot-v1-8k",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertTestProfile(profile1);
    await upsertTestProfile(profile2);

    const profiles = await listTestProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(2);
    expect(profiles.find(p => p.name === "list-test-1")).toBeDefined();
    expect(profiles.find(p => p.name === "list-test-2")).toBeDefined();
  });

  test("应该抛出错误当尝试切换不存在的配置时", async () => {
    try {
      await setActiveTestProfile("non-existent-profile");
      expect(true).toBe(false); // 应该不执行到这里
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("不存在");
    }
  });
});
