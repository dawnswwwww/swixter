/**
 * CLI installation detection and guided installation utilities
 *
 * Provides functions to check if coder CLIs are installed,
 * prompt users with platform-specific installation options,
 * and execute installation commands.
 */

import { execSync, spawn } from "node:child_process";
import { platform } from "node:os";
import * as p from "@clack/prompts";
import pc from "picocolors";
import type { CoderConfig } from "../constants/coders.js";
import type { InstallMethod, InstallPlatform } from "../constants/install.js";
import { getInstallConfig } from "../constants/install.js";
import { INSTALL } from "../constants/messages.js";
import { EXIT_CODES } from "../constants/formatting.js";

/**
 * Check if a command is available on the system PATH
 *
 * Uses `which` on Unix-like systems and `where` on Windows
 * to determine if an executable can be found.
 *
 * @param command - The executable name to check (e.g., "claude", "codex")
 * @returns true if the command is available, false otherwise
 */
export function isCommandAvailable(command: string): boolean {
  try {
    const checkCommand = platform() === "win32" ? "where" : "which";
    execSync(`${checkCommand} ${command}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a coder CLI is installed
 *
 * @param coderId - The coder identifier (e.g., "claude", "codex", "qwen")
 * @param coderConfig - The coder configuration object
 * @returns true if the CLI is installed, false otherwise
 */
export function checkCliInstalled(
  coderId: string,
  coderConfig: CoderConfig,
): boolean {
  return isCommandAvailable(coderConfig.executable);
}

/**
 * Show available installation methods for a coder (non-interactive)
 *
 * @param coderId - The coder identifier (e.g., "claude", "codex", "qwen")
 */
export function showInstallMethods(coderId: string): void {
  const methods = getInstallMethodsForPlatform(coderId);

  if (methods.length === 0) {
    console.log(pc.red("No installation methods available for this platform"));
    return;
  }

  console.log(pc.bold("Available installation methods:"));
  for (let i = 0; i < methods.length; i++) {
    const method = methods[i];
    const label = method.recommended
      ? `${method.label} (Recommended)`
      : method.label;
    console.log(`  ${i + 1}. ${pc.cyan(label)}`);
    console.log(`     ${pc.dim(`$ ${method.command}`)}`);
    if (method.note) {
      console.log(`     ${pc.dim(method.note)}`);
    }
    console.log();
  }
}

/**
 * Get the current platform identifier
 */
function getCurrentPlatform(): InstallPlatform {
  return platform() as InstallPlatform;
}

/**
 * Get Homebrew package name for a coder
 */
function getBrewPackageName(coderId: string): string | null {
  const mapping: Record<string, string> = {
    claude: "claude-code", // cask
    qwen: "qwen-code",
    codex: "codex", // if exists
  };
  return mapping[coderId] || null;
}

/**
 * Get npm package name for a coder
 */
function getNpmPackageName(coderId: string): string | null {
  const mapping: Record<string, string> = {
    claude: "@anthropic-ai/claude-code",
    codex: "@openai/codex",
    qwen: "@qwen-code/qwen-code",
  };
  return mapping[coderId] || null;
}

/**
 * Detect if CLI was installed via Homebrew
 */
function detectHomebrewInstallation(
  executable: string,
  coderId: string,
): InstallMethod | null {
  try {
    // Get executable path
    const whichCommand = platform() === "win32" ? "where" : "which";
    const path = execSync(`${whichCommand} ${executable}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    // Check if path contains Homebrew directories
    if (
      path.includes("/opt/homebrew") ||
      path.includes("/usr/local/Homebrew") ||
      path.includes("/homebrew")
    ) {
      // Find corresponding Homebrew method
      const config = getInstallConfig(coderId);
      return (
        config?.methods.find((m) => m.command.includes("brew install")) ||
        null
      );
    }

    // Alternative: Check brew list (for casks and formulas)
    const brewPackage = getBrewPackageName(coderId);
    if (brewPackage) {
      try {
        // Try cask first (for claude-code)
        if (coderId === "claude") {
          execSync(`brew list --cask ${brewPackage}`, { stdio: "ignore" });
        } else {
          execSync(`brew list ${brewPackage}`, { stdio: "ignore" });
        }
        const config = getInstallConfig(coderId);
        return (
          config?.methods.find((m) => m.command.includes("brew")) || null
        );
      } catch {
        // Not installed via brew
      }
    }
  } catch {
    // Detection failed
  }

  return null;
}

/**
 * Detect if CLI was installed via npm
 */
function detectNpmInstallation(
  executable: string,
  coderId: string,
): InstallMethod | null {
  try {
    const whichCommand = platform() === "win32" ? "where" : "which";
    const path = execSync(`${whichCommand} ${executable}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    // Check if path contains npm global directory
    // Common npm global paths:
    // - macOS/Linux: /usr/local/lib/node_modules, ~/.npm-global, /opt/homebrew/lib/node_modules
    // - Windows: %APPDATA%\npm
    if (
      path.includes("node_modules") ||
      path.includes("/npm/") ||
      path.includes("\\npm\\")
    ) {
      const config = getInstallConfig(coderId);
      return (
        config?.methods.find((m) => m.command.includes("npm")) || null
      );
    }

    // Alternative: Check npm list
    const npmPackage = getNpmPackageName(coderId);
    if (npmPackage) {
      try {
        execSync(`npm list -g ${npmPackage}`, { stdio: "ignore" });
        const config = getInstallConfig(coderId);
        return (
          config?.methods.find((m) => m.command.includes("npm")) || null
        );
      } catch {
        // Not installed via npm
      }
    }
  } catch {
    // Detection failed
  }

  return null;
}

/**
 * Detect how a CLI was installed
 *
 * @param executable - The executable name (e.g., "claude", "codex")
 * @param coderId - The coder identifier (e.g., "claude", "codex", "qwen")
 * @returns The detected installation method, or null if cannot detect
 */
export function detectInstallationMethod(
  executable: string,
  coderId: string,
): InstallMethod | null {
  // Try Homebrew detection first (most reliable)
  const brewMethod = detectHomebrewInstallation(executable, coderId);
  if (brewMethod) {
    return brewMethod;
  }

  // Try npm detection
  const npmMethod = detectNpmInstallation(executable, coderId);
  if (npmMethod) {
    return npmMethod;
  }

  // Cannot detect installation method
  return null;
}

/**
 * Filter installation methods for the current platform
 *
 * @param coderId - The coder identifier (e.g., "claude", "codex", "qwen")
 * @returns Array of installation methods available on the current platform
 */
export function getInstallMethodsForPlatform(coderId: string): InstallMethod[] {
  const config = getInstallConfig(coderId);
  if (!config) {
    return [];
  }

  const currentPlatform = getCurrentPlatform();
  return config.methods.filter((method) => method.platforms.includes(currentPlatform));
}

/**
 * Execute an installation command and wait for it to complete
 *
 * Spawns the command with inherited stdio so the user can see
 * real-time installation progress.
 *
 * @param method - The installation method to execute
 * @returns Promise that resolves to true if installation succeeded
 */
export function runInstallCommand(method: InstallMethod): Promise<boolean> {
  return new Promise((resolve) => {
    const currentPlatform = getCurrentPlatform();

    // Determine shell and arguments based on method.shell and platform
    let shellCommand: string;
    let shellArgs: string[];

    if (method.shell === "powershell" && currentPlatform === "win32") {
      shellCommand = "powershell";
      shellArgs = ["-Command", method.command];
    } else if (method.shell === "cmd" && currentPlatform === "win32") {
      shellCommand = "cmd";
      shellArgs = ["/c", method.command];
    } else {
      // Default: use shell: true which works on all platforms
      shellCommand = method.command;
      shellArgs = [];
    }

    const child =
      shellArgs.length > 0
        ? spawn(shellCommand, shellArgs, { stdio: "inherit" })
        : spawn(shellCommand, { stdio: "inherit", shell: true });

    child.on("exit", (code) => {
      resolve(code === 0);
    });

    child.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Ensure a coder CLI is available before running it
 *
 * This is the main entry point for installation detection.
 * It checks if the CLI executable is on PATH, and if not,
 * guides the user through selecting and running an installation method.
 *
 * @param coderId - The coder identifier (e.g., "claude", "codex", "qwen")
 * @param coderConfig - The coder configuration object
 * @throws Will call process.exit if user cancels or installation fails
 */
export async function ensureCliAvailable(
  coderId: string,
  coderConfig: CoderConfig,
): Promise<void> {
  const { executable, displayName } = coderConfig;

  // Check if the CLI is already available
  if (isCommandAvailable(executable)) {
    return;
  }

  // CLI not found - inform the user
  console.log();
  console.log(pc.yellow(`⚠ ${INSTALL.cliNotInstalled(displayName)}`));
  console.log();

  // Get available installation methods for this platform
  const methods = getInstallMethodsForPlatform(coderId);

  if (methods.length === 0) {
    console.log(pc.red(INSTALL.installManualHint(displayName)));
    process.exit(EXIT_CODES.generalError);
  }

  // In non-interactive mode (no TTY), show install commands and exit
  // This handles CI/CD environments, piped input, and Docker exec without -t
  if (!process.stdin.isTTY) {
    console.log(INSTALL.installManualHint(displayName));
    console.log();
    console.log(pc.bold("Available installation methods:"));
    for (const method of methods) {
      const label = method.recommended ? `${method.label} (Recommended)` : method.label;
      console.log(`  ${pc.cyan(label)}`);
      console.log(`  ${pc.dim(`$ ${method.command}`)}`);
      if (method.note) {
        console.log(`  ${pc.dim(method.note)}`);
      }
      console.log();
    }
    process.exit(EXIT_CODES.generalError);
  }

  // Ask if user wants to install
  const shouldInstall = await p.confirm({
    message: INSTALL.confirmInstall(displayName),
  });

  if (p.isCancel(shouldInstall) || !shouldInstall) {
    p.cancel(INSTALL.skipInstall);
    process.exit(EXIT_CODES.cancelled);
  }

  // Let user select installation method
  let selectedMethod: InstallMethod;

  if (methods.length === 1) {
    // Only one method available - use it directly
    selectedMethod = methods[0];
  } else {
    const selection = await p.select({
      message: INSTALL.selectMethod,
      options: methods.map((method) => ({
        value: method,
        label: method.recommended
          ? `${method.label} ${pc.green("★")}`
          : method.label,
        hint: method.note,
      })),
    });

    if (p.isCancel(selection)) {
      p.cancel(INSTALL.skipInstall);
      process.exit(EXIT_CODES.cancelled);
    }

    selectedMethod = selection;
  }

  // Show the command that will be executed
  console.log();
  console.log(pc.dim(`$ ${selectedMethod.command}`));
  console.log();

  // Execute installation
  const success = await runInstallCommand(selectedMethod);

  if (!success) {
    console.log();
    console.log(pc.red(`✗ ${INSTALL.installFailed(displayName)}`));
    console.log(pc.dim(INSTALL.installManualHint(displayName)));
    process.exit(EXIT_CODES.generalError);
  }

  // Verify installation
  console.log();

  if (isCommandAvailable(executable)) {
    console.log(pc.green(`✓ ${INSTALL.installSuccess(displayName)}`));
  } else {
    // Command still not found - might need terminal restart
    console.log(pc.yellow(`⚠ ${INSTALL.installSuccess(displayName)}`));
    console.log(pc.dim(INSTALL.restartTerminalHint));
  }

  // Show post-install note if available
  const installConfig = getInstallConfig(coderId);
  if (installConfig?.postInstallNote) {
    console.log(pc.dim(installConfig.postInstallNote));
  }

  console.log();
}
