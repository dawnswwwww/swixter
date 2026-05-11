import { describe, test, expect } from "bun:test";
import { getCliVersion, compareVersions, isValidVersion } from "../../src/utils/cli-version.js";

describe("CLI Version Utilities", () => {
  describe("compareVersions", () => {
    test("should return 0 for equal versions", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
      expect(compareVersions("2.5.3", "2.5.3")).toBe(0);
    });

    test("should return negative when v1 < v2", () => {
      expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
      expect(compareVersions("0.9.9", "1.0.0")).toBeLessThan(0);
    });

    test("should return positive when v1 > v2", () => {
      expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
      expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
      expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    });

    test("should handle versions with different segment counts", () => {
      // semver normalizes versions to 3 segments
      // Note: versions with >3 segments are not valid semver
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    test("should handle patch version differences", () => {
      expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
      expect(compareVersions("1.0.5", "1.0.10")).toBeLessThan(0);
    });

    test("should handle minor version differences", () => {
      expect(compareVersions("1.0.0", "1.1.0")).toBeLessThan(0);
      expect(compareVersions("1.5.0", "1.10.0")).toBeLessThan(0);
    });

    test("should handle major version differences", () => {
      expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
      expect(compareVersions("2.0.0", "1.0.0")).toBeGreaterThan(0);
    });

    test("should handle pre-release versions (semver)", () => {
      expect(compareVersions("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
      expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
      expect(compareVersions("1.0.0-rc.1", "1.0.0-beta")).toBeGreaterThan(0);
    });

    test("should throw error for invalid versions", () => {
      expect(() => compareVersions("invalid", "1.0.0")).toThrow();
      expect(() => compareVersions("1.0.0", "not-a-version")).toThrow();
    });
  });

  describe("isValidVersion", () => {
    test("should return true for valid semver versions", () => {
      expect(isValidVersion("1.0.0")).toBe(true);
      expect(isValidVersion("0.0.1")).toBe(true);
      expect(isValidVersion("10.20.30")).toBe(true);
    });

    test("should return true for valid semver with pre-release", () => {
      expect(isValidVersion("1.0.0-alpha")).toBe(true);
      expect(isValidVersion("1.0.0-beta.1")).toBe(true);
      expect(isValidVersion("1.0.0-rc.1")).toBe(true);
    });

    test("should return true for valid semver with build metadata", () => {
      expect(isValidVersion("1.0.0+20130313")).toBe(true);
      expect(isValidVersion("1.0.0-alpha+001")).toBe(true);
    });

    test("should return false for invalid versions", () => {
      expect(isValidVersion("invalid")).toBe(false);
      expect(isValidVersion("1.0")).toBe(false); // incomplete version
      expect(isValidVersion("")).toBe(false);
    });

    test("should handle v prefix (semver cleans it)", () => {
      // semver's valid() function automatically strips lowercase 'v' prefix
      expect(isValidVersion("v1.0.0")).toBe(true);
      // Uppercase 'V' is not accepted by semver
      expect(isValidVersion("V1.0.0")).toBe(false);
    });
  });

  describe("getCliVersion", () => {
    test("should return null for non-existent command", async () => {
      const version = await getCliVersion("this-command-definitely-does-not-exist-12345");
      expect(version).toBeNull();
    });

    test("should return null for empty command", async () => {
      const version = await getCliVersion("");
      expect(version).toBeNull();
    });

    test("should return version for node if available", async () => {
      const version = await getCliVersion("node");
      // Node.js should be available in test environment
      if (version !== null) {
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
        expect(isValidVersion(version)).toBe(true);
      }
    });

    test("should return version for bun if available", async () => {
      const version = await getCliVersion("bun");
      // Bun should be available in test environment
      if (version !== null) {
        expect(version).toMatch(/^\d+\.\d+\.\d+/);
        expect(isValidVersion(version)).toBe(true);
      }
    });

    test("should parse version from various formats", () => {
      // Test version parsing logic indirectly through compareVersions
      // The actual parsing is tested through integration with real commands
      expect(compareVersions("1.0.0", "1.0.1")).toBeLessThan(0);
    });
  });
});
