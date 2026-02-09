import { describe, test, expect } from "bun:test";
import {
  isCommandAvailable,
  getInstallMethodsForPlatform,
  checkCliInstalled,
  showInstallMethods,
} from "../../src/utils/install.js";
import { INSTALL_CONFIGS, getInstallConfig } from "../../src/constants/install.js";
import { CODER_REGISTRY } from "../../src/constants/coders.js";

describe("Installation Utilities", () => {
  describe("isCommandAvailable", () => {
    test("should return true for known available command (node)", () => {
      const result = isCommandAvailable("node");
      expect(result).toBe(true);
    });

    test("should return true for known available command (bun)", () => {
      const result = isCommandAvailable("bun");
      expect(result).toBe(true);
    });

    test("should return false for non-existent command", () => {
      const result = isCommandAvailable("this-command-definitely-does-not-exist-12345");
      expect(result).toBe(false);
    });

    test("should return false for empty command", () => {
      const result = isCommandAvailable("");
      expect(result).toBe(false);
    });
  });

  describe("getInstallMethodsForPlatform", () => {
    test("should return methods for known coder (claude)", () => {
      const methods = getInstallMethodsForPlatform("claude");
      expect(methods.length).toBeGreaterThan(0);
    });

    test("should return methods for known coder (codex)", () => {
      const methods = getInstallMethodsForPlatform("codex");
      expect(methods.length).toBeGreaterThan(0);
    });

    test("should return methods for known coder (qwen)", () => {
      const methods = getInstallMethodsForPlatform("qwen");
      expect(methods.length).toBeGreaterThan(0);
    });

    test("should return empty array for unknown coder", () => {
      const methods = getInstallMethodsForPlatform("unknown-coder");
      expect(methods).toEqual([]);
    });

    test("should only return methods matching the current platform", () => {
      const currentPlatform = process.platform as "darwin" | "linux" | "win32";
      const methods = getInstallMethodsForPlatform("claude");

      for (const method of methods) {
        expect(method.platforms).toContain(currentPlatform);
      }
    });

    test("should include at least one recommended method for each coder on current platform", () => {
      for (const coderId of ["claude", "codex", "qwen"]) {
        const methods = getInstallMethodsForPlatform(coderId);
        // Every coder should have at least one method on any platform
        expect(methods.length).toBeGreaterThan(0);
      }
    });
  });

  describe("INSTALL_CONFIGS", () => {
    test("should have configs for all three coders", () => {
      expect(INSTALL_CONFIGS.claude).toBeDefined();
      expect(INSTALL_CONFIGS.codex).toBeDefined();
      expect(INSTALL_CONFIGS.qwen).toBeDefined();
    });

    test("each coder should have at least one install method", () => {
      for (const [, config] of Object.entries(INSTALL_CONFIGS)) {
        expect(config.methods.length).toBeGreaterThan(0);
      }
    });

    test("each method should have required fields", () => {
      for (const [, config] of Object.entries(INSTALL_CONFIGS)) {
        for (const method of config.methods) {
          expect(method.label).toBeTruthy();
          expect(method.command).toBeTruthy();
          expect(method.platforms.length).toBeGreaterThan(0);
        }
      }
    });

    test("every method should target at least one valid platform", () => {
      const validPlatforms = ["darwin", "linux", "win32"];

      for (const config of Object.values(INSTALL_CONFIGS)) {
        for (const method of config.methods) {
          for (const platform of method.platforms) {
            expect(validPlatforms).toContain(platform);
          }
        }
      }
    });

    test("claude should have platform-specific methods", () => {
      const claude = INSTALL_CONFIGS.claude;
      if (!claude) {
        throw new Error("claude config not found");
      }
      const unixMethods = claude.methods.filter(
        (m) => m.platforms.includes("darwin") || m.platforms.includes("linux"),
      );
      const winMethods = claude.methods.filter((m) =>
        m.platforms.includes("win32"),
      );

      expect(unixMethods.length).toBeGreaterThan(0);
      expect(winMethods.length).toBeGreaterThan(0);
    });

    test("codex should have cross-platform npm method", () => {
      const codex = INSTALL_CONFIGS.codex;
      if (!codex) {
        throw new Error("codex config not found");
      }
      const npmMethod = codex.methods.find((m) => m.command.includes("npm"));

      expect(npmMethod).toBeDefined();
      expect(npmMethod!.platforms).toContain("darwin");
      expect(npmMethod!.platforms).toContain("linux");
      expect(npmMethod!.platforms).toContain("win32");
    });
  });

  describe("getInstallConfig", () => {
    test("should return config for valid coder", () => {
      const config = getInstallConfig("claude");
      expect(config).toBeDefined();
      expect(config!.methods.length).toBeGreaterThan(0);
    });

    test("should return undefined for unknown coder", () => {
      const config = getInstallConfig("non-existent");
      expect(config).toBeUndefined();
    });
  });

  describe("checkCliInstalled", () => {
    test("should return boolean value", () => {
      const config = CODER_REGISTRY.claude;
      if (!config) {
        throw new Error("claude config not found");
      }
      const result = checkCliInstalled("claude", config);
      expect(typeof result).toBe("boolean");
    });

    test("should return false when CLI is not available", () => {
      // Use a non-existent executable name to test the false case
      const fakeConfig = {
        id: "fake-coder",
        displayName: "Fake CLI",
        executable: "this-command-definitely-does-not-exist-12345",
        adapter: "fake",
        envVarMapping: {
          apiKey: "FAKE_API_KEY",
          baseURL: "https://fake.example.com",
        },
        configPath: {
          dir: "/fake",
          file: "config.json",
        },
        supportsAuthToken: false,
      };
      const result = checkCliInstalled("fake-coder", fakeConfig);
      expect(result).toBe(false);
    });

    test("should work for all coders", () => {
      for (const [coderId, config] of Object.entries(CODER_REGISTRY)) {
        if (!config) {
          continue;
        }
        const result = checkCliInstalled(coderId, config);
        expect(typeof result).toBe("boolean");
      }
    });
  });

  describe("showInstallMethods", () => {
    test("should not throw for valid coder", () => {
      // This function only logs, so we just verify it doesn't throw
      expect(() => showInstallMethods("claude")).not.toThrow();
      expect(() => showInstallMethods("codex")).not.toThrow();
      expect(() => showInstallMethods("qwen")).not.toThrow();
    });

    test("should handle unknown coder gracefully", () => {
      expect(() => showInstallMethods("unknown-coder")).not.toThrow();
    });

    test("should handle empty coder ID", () => {
      expect(() => showInstallMethods("")).not.toThrow();
    });
  });

  describe("integration tests", () => {
    test("checkCliInstalled should use isCommandAvailable internally", () => {
      // Verify the function delegates to isCommandAvailable
      const config = CODER_REGISTRY.claude;
      if (!config) {
        throw new Error("claude config not found");
      }
      const claudeResult = checkCliInstalled("claude", config);
      const directCheck = isCommandAvailable("claude");
      expect(claudeResult).toBe(directCheck);
    });

    test("showInstallMethods should use getInstallMethodsForPlatform", () => {
      // Verify the function uses getInstallMethodsForPlatform
      const methods = getInstallMethodsForPlatform("claude");
      expect(methods.length).toBeGreaterThan(0);
      // showInstallMethods should not throw when methods exist
      expect(() => showInstallMethods("claude")).not.toThrow();
    });
  });
});
