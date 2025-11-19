#!/usr/bin/env node

import * as p from "@clack/prompts";
import pc from "picocolors";
import { handleClaudeCommand } from "./claude.js";
import { handleQwenCommand } from "./qwen.js";
import { exportConfig, importConfig } from "../config/export.js";
import { showGlobalHelp } from "./help.js";
import { generateCompletion, showCompletionInstructions } from "./completions.js";
import { listProviders, addProvider, removeProvider, showProvider } from "./providers.js";

/**
 * Execute providers command
 */
async function cmdProviders(subcommand?: string, args?: string[]): Promise<void> {
  if (!subcommand || subcommand === "list" || subcommand === "ls") {
    await listProviders();
    return;
  }

  if (subcommand === "add" || subcommand === "new") {
    // Parse flags
    const options: any = { quiet: args?.includes("--quiet") || args?.includes("-q") };

    for (let i = 0; args && i < args.length; i++) {
      const arg = args[i];
      const nextArg = args[i + 1];

      if ((arg === "--id" || arg === "-i") && nextArg) {
        options.id = nextArg;
        i++;
      } else if ((arg === "--name" || arg === "-n") && nextArg) {
        options.name = nextArg;
        i++;
      } else if ((arg === "--display-name" || arg === "-d") && nextArg) {
        options.displayName = nextArg;
        i++;
      } else if ((arg === "--base-url" || arg === "-u") && nextArg) {
        options.baseURL = nextArg;
        i++;
      } else if ((arg === "--auth-type" || arg === "-t") && nextArg) {
        options.authType = nextArg as "api-key" | "bearer" | "custom";
        i++;
      } else if ((arg === "--models" || arg === "-m") && nextArg) {
        options.models = nextArg;
        i++;
      }
    }

    await addProvider(options);
    return;
  }

  if (subcommand === "remove" || subcommand === "rm" || subcommand === "delete") {
    const providerId = args?.[0];
    const quiet = args?.includes("--quiet") || args?.includes("-q");
    await removeProvider(providerId, { quiet });
    return;
  }

  if (subcommand === "show" || subcommand === "info") {
    const providerId = args?.[0];
    await showProvider(providerId);
    return;
  }

  console.log(pc.red(`Unknown providers subcommand: ${subcommand}`));
  console.log();
  console.log(pc.bold("Available subcommands:"));
  console.log(`  ${pc.cyan("list, ls")}           - List all providers`);
  console.log(`  ${pc.cyan("add, new")}           - Add a custom provider`);
  console.log(`  ${pc.cyan("remove, rm, delete")} - Remove a custom provider`);
  console.log(`  ${pc.cyan("show, info")}         - Show provider details`);
  console.log();
  process.exit(1);
}

/**
 * Execute export command
 */
async function cmdExport(filePath: string): Promise<void> {
  if (!filePath) {
    console.log(pc.red("Error: Please specify export file path"));
    console.log(pc.dim("Usage: swixter export <file>"));
    process.exit(1);
  }

  try {
    await exportConfig(filePath, { sanitizeKeys: false });
    console.log();
    console.log(pc.green("✓") + " Export successful!");
    console.log(`  File: ${pc.cyan(filePath)}`);
    console.log();
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ Export failed: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * Execute completion command
 */
async function cmdCompletion(shell?: string): Promise<void> {
  if (!shell) {
    console.log(pc.yellow("Please specify shell type"));
    console.log();
    console.log(pc.bold("Usage:"));
    console.log(`  ${pc.green("swixter completion <shell>")}`);
    console.log();
    console.log(pc.bold("Supported shells:"));
    console.log(`  ${pc.cyan("bash")}   - Bash shell`);
    console.log(`  ${pc.cyan("zsh")}    - Z shell`);
    console.log(`  ${pc.cyan("fish")}   - Fish shell`);
    console.log();
    console.log(pc.bold("Examples:"));
    console.log(`  ${pc.green("swixter completion bash > ~/.local/share/bash-completion/completions/swixter")}`);
    console.log(`  ${pc.green("swixter completion zsh > ~/.zfunc/_swixter")}`);
    console.log(`  ${pc.green("swixter completion fish > ~/.config/fish/completions/swixter.fish")}`);
    process.exit(1);
  }

  const supportedShells = ["bash", "zsh", "fish"];
  if (!supportedShells.includes(shell)) {
    console.log(pc.red(`Unsupported shell: ${shell}`));
    console.log(pc.dim(`Supported shells: ${supportedShells.join(", ")}`));
    process.exit(1);
  }

  try {
    const script = generateCompletion(shell as "bash" | "zsh" | "fish");
    console.log(script);
  } catch (error) {
    console.error(pc.red("Failed to generate completion script:"), error);
    process.exit(1);
  }
}

/**
 * Execute import command
 */
async function cmdImport(filePath: string): Promise<void> {
  if (!filePath) {
    console.log(pc.red("Error: Please specify import file path"));
    console.log(pc.dim("Usage: swixter import <file>"));
    process.exit(1);
  }

  try {
    const result = await importConfig(filePath, { overwrite: false });
    console.log();
    console.log(pc.green("✓") + " Import completed!");
    console.log();
    console.log(`  Successfully imported: ${pc.green(result.imported)} items`);
    console.log(`  Skipped: ${pc.yellow(result.skipped)} items`);
    console.log(`  Errors: ${pc.red(result.errors.length)} items`);
    console.log();

    if (result.errors.length > 0) {
      console.log(pc.red("Error details:"));
      result.errors.forEach((err) => console.log(pc.red(`  - ${err}`)));
      console.log();
    }
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ Import failed: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * Main entry point
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  try {
    // No arguments or help
    if (!firstArg || firstArg === "--help" || firstArg === "-h") {
      showGlobalHelp();
      return;
    }

    // Coder subcommands
    if (firstArg === "claude") {
      await handleClaudeCommand(args.slice(1));
      return;
    }

    if (firstArg === "qwen") {
      await handleQwenCommand(args.slice(1));
      return;
    }

    // Global commands
    if (firstArg === "providers") {
      await cmdProviders(args[1], args.slice(2));
      return;
    }

    if (firstArg === "export") {
      await cmdExport(args[1]);
      return;
    }

    if (firstArg === "import") {
      await cmdImport(args[1]);
      return;
    }

    if (firstArg === "completion") {
      await cmdCompletion(args[1]);
      return;
    }

    // Unknown command
    console.log(pc.red(`Unknown command: ${firstArg}`));
    console.log(pc.dim("Run 'swixter --help' for help"));
    process.exit(1);
  } catch (error) {
    console.error(pc.red("An error occurred:"), error);
    process.exit(1);
  }
}

// Run main function
main();
