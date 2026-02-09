/**
 * Shared install and update command handlers for all coders
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import type { CoderConfig } from "../constants/coders.js";
import { INSTALL } from "../constants/messages.js";
import { EXIT_CODES } from "../constants/formatting.js";
import {
  checkCliInstalled,
  getInstallMethodsForPlatform,
  showInstallMethods,
  runInstallCommand,
  isCommandAvailable,
  detectInstallationMethod,
} from "./install.js";
import { getCliVersion } from "./cli-version.js";
import { getInstallConfig, UPDATE_COMMANDS } from "../constants/install.js";
import type { InstallMethod } from "../constants/install.js";

/**
 * Install command handler - works for any coder
 */
export async function handleInstallCommand(
  coderId: string,
  coderConfig: CoderConfig,
  args: string[]
): Promise<void> {
  const { displayName, executable } = coderConfig;

  const isInstalled = checkCliInstalled(coderId, coderConfig);

  if (isInstalled) {
    console.log();
    console.log(pc.green(`✓ ${displayName} is already installed`));
    const version = await getCliVersion(executable);
    if (version) {
      console.log(pc.dim(`  Version: ${version}`));
    }
    console.log();

    if (process.stdin.isTTY) {
      const reinstall = await p.confirm({
        message: "Would you like to reinstall?",
      });

      if (p.isCancel(reinstall) || !reinstall) {
        p.cancel("Skipping reinstall");
        return;
      }
    } else {
      console.log(pc.dim("Run with --force to reinstall"));
      return;
    }
  }

  const methods = getInstallMethodsForPlatform(coderId);

  if (methods.length === 0) {
    console.log();
    console.log(pc.red(INSTALL.installManualHint(displayName)));
    process.exit(EXIT_CODES.generalError);
  }

  let selectedMethod: InstallMethod;

  // Parse args for --method parameter
  const params = parseArgs(args);

  if (params.method !== undefined) {
    const methodIndex = parseInt(params.method as string, 10) - 1;
    if (methodIndex < 0 || methodIndex >= methods.length) {
      console.log(pc.red(`Error: Invalid method index. Available: 1-${methods.length}`));
      showInstallMethods(coderId);
      process.exit(EXIT_CODES.invalidArgument);
    }
    selectedMethod = methods[methodIndex]!;
  } else if (process.stdin.isTTY) {
    if (methods.length === 1) {
      selectedMethod = methods[0]!;
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
        return;
      }

      selectedMethod = selection;
    }
  } else {
    console.log();
    console.log(INSTALL.installManualHint(displayName));
    console.log();
    showInstallMethods(coderId);
    process.exit(EXIT_CODES.generalError);
  }

  console.log();
  console.log(pc.dim(`$ ${selectedMethod.command}`));
  console.log();

  const success = await runInstallCommand(selectedMethod);

  if (!success) {
    console.log();
    console.log(pc.red(`✗ ${INSTALL.installFailed(displayName)}`));
    console.log(pc.dim(INSTALL.installManualHint(displayName)));
    process.exit(EXIT_CODES.generalError);
  }

  console.log();

  if (isCommandAvailable(executable)) {
    console.log(pc.green(`✓ ${INSTALL.installSuccess(displayName)}`));
    const newVersion = await getCliVersion(executable);
    if (newVersion) {
      console.log(pc.dim(`  Version: ${newVersion}`));
    }
  } else {
    console.log();
    console.log(pc.red(`✗ ${INSTALL.installFailed(displayName)}`));
    console.log(pc.dim("The installation command completed, but the CLI is not available."));
    console.log(pc.dim("This may indicate the installation failed. Please check the error messages above."));
    console.log(pc.dim(INSTALL.installManualHint(displayName)));
    process.exit(EXIT_CODES.generalError);
  }

  const installConfig = getInstallConfig(coderId);
  if (installConfig?.postInstallNote) {
    console.log(pc.dim(installConfig.postInstallNote));
  }

  console.log();
}

/**
 * Update command handler - works for any coder
 */
export async function handleUpdateCommand(
  coderId: string,
  coderConfig: CoderConfig,
  args: string[]
): Promise<void> {
  const { displayName, executable } = coderConfig;

  const isInstalled = checkCliInstalled(coderId, coderConfig);

  if (!isInstalled) {
    console.log();
    console.log(pc.yellow(`⚠ ${displayName} is not installed`));
    console.log();
    console.log(pc.dim("Please install it first using:"));
    console.log(pc.cyan(`  swixter ${coderId} install`));
    console.log();
    process.exit(EXIT_CODES.notFound);
  }

  const currentVersion = await getCliVersion(executable);
  if (currentVersion) {
    console.log();
    console.log(pc.dim(`Current version: ${currentVersion}`));
  }

  console.log();
  console.log(pc.yellow(`Updating ${displayName}...`));
  console.log();

  const detectedMethod = detectInstallationMethod(executable, coderId);

  let updateMethod: InstallMethod;

  if (detectedMethod) {
    const updateCommand =
      UPDATE_COMMANDS[coderId]?.[detectedMethod.command] ||
      detectedMethod.command;
    updateMethod = {
      ...detectedMethod,
      command: updateCommand,
    };
  } else {
    // If we can't detect the method, let user choose in interactive mode
    const methods = getInstallMethodsForPlatform(coderId);

    if (process.stdin.isTTY && methods.length > 1) {
      console.log(pc.yellow("Unable to detect installation method."));
      console.log(pc.dim("Please select the method you used to install:"));

      const selection = await p.select({
        message: "Select installation method",
        options: methods.map((method) => ({
          value: method,
          label: method.recommended
            ? `${method.label} ${pc.green("★")}`
            : method.label,
          hint: method.note,
        })),
      });

      if (p.isCancel(selection)) {
        p.cancel("Update cancelled");
        return;
      }

      updateMethod = selection;
    } else {
      const recommendedMethod = methods.find((m) => m.recommended) || methods[0];
      if (!recommendedMethod) {
        console.log(pc.red("No update method available"));
        process.exit(EXIT_CODES.generalError);
      }
      updateMethod = recommendedMethod;
    }
  }

  console.log(pc.dim(`$ ${updateMethod.command}`));
  console.log();

  const success = await runInstallCommand(updateMethod);

  if (!success) {
    console.log();
    console.log(pc.red(`✗ Failed to update ${displayName}`));
    process.exit(EXIT_CODES.generalError);
  }

  console.log();

  const newVersion = await getCliVersion(executable);
  if (newVersion && currentVersion && newVersion !== currentVersion) {
    console.log(pc.green(`✓ Updated from ${currentVersion} to ${newVersion}`));
  } else if (newVersion) {
    console.log(pc.green(`✓ ${displayName} is up to date`));
    console.log(pc.dim(`  Version: ${newVersion}`));
  } else {
    console.log(pc.green(`✓ Update completed`));
  }

  console.log();
}

/**
 * Simple argument parser for --method parameter
 */
function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1];

      if (!value || value.startsWith("--")) {
        parsed[key] = true;
      } else {
        parsed[key] = value;
        i++;
      }
    }
  }

  return parsed;
}
