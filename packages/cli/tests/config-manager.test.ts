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

describe("Configuration Manager", () => {
  // Clean up before each test
  beforeEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }
  });

  // Clean up after each test
  afterEach(() => {
    if (existsSync(TEST_CONFIG_PATH)) {
      rmSync(TEST_CONFIG_PATH);
    }
  });

  test("should be able to create default configuration", async () => {
    const config = await loadTestConfig();
    expect(config.version).toBeDefined();
    expect(config.profiles).toEqual({});
    expect(config.coders).toEqual({});
  });

  test("should be able to save and load configuration", async () => {
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

  test("should be able to switch active profile", async () => {
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
      providerId: "ollama",
      apiKey: "",
      model: "qwen2.5-coder:7b",
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

  test("should be able to delete profile", async () => {
    const profile: ClaudeCodeProfile = {
      name: "to-delete",
      providerId: "anthropic",
      apiKey: "key",
      model: "claude-3-5-sonnet-20241022",
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

  test("should be able to list all profiles", async () => {
    const profile1: ClaudeCodeProfile = {
      name: "list-test-1",
      providerId: "anthropic",
      apiKey: "key-1",
      model: "claude-3-5-sonnet-20241022",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const profile2: ClaudeCodeProfile = {
      name: "list-test-2",
      providerId: "ollama",
      apiKey: "",
      model: "qwen2.5-coder:7b",
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

  test("should throw error when trying to switch to non-existent profile", async () => {
    try {
      await setActiveTestProfile("non-existent-profile");
      expect(true).toBe(false); // Should not reach here
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("does not exist");
    }
  });
});
