/**
 * CLI help system
 * Provides detailed command help, examples, and documentation
 */

import pc from "picocolors";
import type { CoderConfig } from "../constants/coders.js";

/**
 * Command argument definition
 */
export interface CommandArg {
  name: string;
  shorthand?: string;
  description: string;
  required: boolean;
  defaultValue?: string;
  type?: "string" | "boolean" | "number";
}

/**
 * Command example
 */
export interface CommandExample {
  description: string;
  command: string;
}

/**
 * Command help information
 */
export interface CommandHelp {
  name: string;
  aliases?: string[];
  description: string;
  usage: string;
  args: CommandArg[];
  examples: CommandExample[];
  relatedCommands?: string[];
  notes?: string[];
}

/**
 * Get help information for all commands
 */
export function getCommandHelp(coderName: string): Record<string, CommandHelp> {
  return {
    create: {
      name: "create",
      aliases: ["new"],
      description: "Create a new configuration profile",
      usage: `swixter ${coderName} create [options]`,
      args: [
        {
          name: "--name, -n",
          description: "Configuration name (unique identifier)",
          required: true,
          type: "string",
        },
        {
          name: "--provider, -p",
          description: "API provider ID (anthropic, ollama, custom)",
          required: true,
          type: "string",
        },
        {
          name: "--api-key, -k",
          description: "API key",
          required: false,
          type: "string",
        },
        {
          name: "--auth-token, -t",
          description: "Authentication token (for certain providers)",
          required: false,
          type: "string",
        },
        {
          name: "--base-url, -u",
          description: "Custom API base URL",
          required: false,
          type: "string",
        },
        {
          name: "--model, -m",
          description: "Default model name",
          required: false,
          type: "string",
        },
        {
          name: "--apply, -a",
          description: "Apply this configuration immediately after creation",
          required: false,
          type: "boolean",
          defaultValue: "false",
        },
        {
          name: "--quiet, -q",
          description: "Non-interactive mode (requires all mandatory parameters)",
          required: false,
          type: "boolean",
          defaultValue: "false",
        },
      ],
      examples: [
        {
          description: "Create configuration interactively",
          command: `swixter ${coderName} create`,
        },
        {
          description: "Quick create Anthropic official API configuration",
          command: `swixter ${coderName} create --name prod --provider anthropic --api-key sk-ant-xxx`,
        },
        {
          description: "Create and apply immediately using short options",
          command: `swixter ${coderName} create -n dev -p anthropic -k sk-ant-xxx -a`,
        },
        {
          description: "Create Ollama local configuration (Qwen)",
          command: `swixter ${coderName} create -n local -p ollama -m qwen2.5-coder:7b`,
        },
        {
          description: "Create custom API configuration",
          command: `swixter ${coderName} create -n custom -p custom -u https://my-api.com -k mykey`,
        },
      ],
      relatedCommands: ["list", "switch", "apply"],
      notes: [
        "Interactive wizard will launch when --quiet is not used",
        "Configuration name must be unique and cannot contain spaces or special characters",
        "Use 'swixter providers' to view all available providers",
      ],
    },

    list: {
      name: "list",
      aliases: ["ls"],
      description: "List all saved configurations",
      usage: `swixter ${coderName} list [options]`,
      args: [
        {
          name: "--format",
          description: "Output format: table (default), json, yaml",
          required: false,
          type: "string",
          defaultValue: "table",
        },
        {
          name: "--names-only",
          description: "Show configuration names only",
          required: false,
          type: "boolean",
          defaultValue: "false",
        },
      ],
      examples: [
        {
          description: "List all configurations (table format)",
          command: `swixter ${coderName} list`,
        },
        {
          description: "Use alias",
          command: `swixter ${coderName} ls`,
        },
        {
          description: "Output in JSON format",
          command: `swixter ${coderName} list --format json`,
        },
        {
          description: "Show configuration names only",
          command: `swixter ${coderName} list --names-only`,
        },
      ],
      relatedCommands: ["current", "switch"],
      notes: [
        "The currently active configuration will be highlighted",
        "Shows provider, creation time, and other info for each configuration",
      ],
    },

    switch: {
      name: "switch",
      aliases: ["sw"],
      description: "Switch to a specified configuration",
      usage: `swixter ${coderName} switch --name <name> [--apply | --no-apply]`,
      args: [
        {
          name: "--name, -n",
          description: "Configuration name to switch to",
          required: true,
          type: "string",
        },
        {
          name: "--apply",
          description: "Automatically apply the profile without prompting",
          required: false,
          type: "boolean",
        },
        {
          name: "--no-apply",
          description: "Skip apply prompt and don't apply the profile",
          required: false,
          type: "boolean",
        },
      ],
      examples: [
        {
          description: "Switch to specified configuration (prompts to apply)",
          command: `swixter ${coderName} switch --name prod`,
        },
        {
          description: "Switch and apply immediately without prompting",
          command: `swixter ${coderName} switch --name prod --apply`,
        },
        {
          description: "Switch without applying (skip prompt)",
          command: `swixter ${coderName} switch --name dev --no-apply`,
        },
        {
          description: "Use short option",
          command: `swixter ${coderName} sw -n dev`,
        },
      ],
      relatedCommands: ["list", "current", "apply"],
      notes: [
        "By default, you will be prompted to apply after switching",
        "Use --apply to automatically apply without prompting",
        "Use --no-apply to skip the prompt and apply manually later",
        "Use 'current' command to view the currently active configuration",
      ],
    },

    edit: {
      name: "edit",
      aliases: ["update"],
      description: "Edit an existing configuration",
      usage: `swixter ${coderName} edit [--name <name>]`,
      args: [
        {
          name: "--name, -n",
          description: "Configuration name to edit (leave empty to edit current configuration)",
          required: false,
          type: "string",
        },
      ],
      examples: [
        {
          description: "Edit the currently active configuration",
          command: `swixter ${coderName} edit`,
        },
        {
          description: "Edit a specified configuration",
          command: `swixter ${coderName} edit --name prod`,
        },
        {
          description: "Use alias",
          command: `swixter ${coderName} update -n dev`,
        },
      ],
      relatedCommands: ["create", "delete"],
      notes: [
        "Interactive editor will show current values",
        "All fields can be modified, including API Key",
      ],
    },

    delete: {
      name: "delete",
      aliases: ["rm"],
      description: "Delete specified configuration(s)",
      usage: `swixter ${coderName} delete --name <name> [options]`,
      args: [
        {
          name: "--name, -n",
          description: "Configuration name to delete",
          required: false,
          type: "string",
        },
        {
          name: "--names",
          description: "Batch delete multiple configurations (comma-separated)",
          required: false,
          type: "string",
        },
        {
          name: "--all",
          description: "Delete all configurations",
          required: false,
          type: "boolean",
          defaultValue: "false",
        },
        {
          name: "--force, -f",
          description: "Skip confirmation prompt",
          required: false,
          type: "boolean",
          defaultValue: "false",
        },
      ],
      examples: [
        {
          description: "Delete specified configuration",
          command: `swixter ${coderName} delete --name old-config`,
        },
        {
          description: "Use alias and short option",
          command: `swixter ${coderName} rm -n test`,
        },
        {
          description: "Force delete (no confirmation)",
          command: `swixter ${coderName} delete -n temp -f`,
        },
        {
          description: "Batch delete multiple configurations",
          command: `swixter ${coderName} delete --names config1,config2,config3`,
        },
        {
          description: "Delete all configurations (use with caution)",
          command: `swixter ${coderName} delete --all`,
        },
      ],
      relatedCommands: ["create", "list"],
      notes: [
        "Confirmation will be requested before deletion (unless using --force)",
        "Cannot delete the currently active configuration, must switch first",
        "Deletion is irreversible, recommend exporting configuration backup first",
      ],
    },

    apply: {
      name: "apply",
      description: "Apply the currently active configuration",
      usage: `swixter ${coderName} apply`,
      args: [],
      examples: [
        {
          description: "Apply current configuration",
          command: `swixter ${coderName} apply`,
        },
      ],
      relatedCommands: ["current", "switch"],
      notes: [
        "Will update the target tool's configuration file",
        "Configuration validity will be validated before applying",
      ],
    },

    current: {
      name: "current",
      description: "Show details of the currently active configuration",
      usage: `swixter ${coderName} current [options]`,
      args: [
        {
          name: "--format",
          description: "Output format: table (default), json, yaml",
          required: false,
          type: "string",
          defaultValue: "table",
        },
      ],
      examples: [
        {
          description: "Show current configuration",
          command: `swixter ${coderName} current`,
        },
        {
          description: "Output in JSON format",
          command: `swixter ${coderName} current --format json`,
        },
      ],
      relatedCommands: ["list", "switch"],
    },

    run: {
      name: "run",
      description: "Run target CLI with configuration",
      usage: `swixter ${coderName} run [--profile <name>] [cli-args...]`,
      args: [
        {
          name: "--profile",
          description: "Run with specified configuration (no need to switch first)",
          required: false,
          type: "string",
        },
      ],
      examples: [
        {
          description: "Run with current configuration",
          command: `swixter ${coderName} run`,
        },
        {
          description: "Run with specified configuration",
          command: `swixter ${coderName} run --profile prod`,
        },
        {
          description: "Pass arguments to target CLI",
          command: `swixter ${coderName} run --print "What is AI?"`,
        },
      ],
      relatedCommands: ["apply", "current"],
      notes: [
        "Will temporarily apply configuration environment variables",
        "All unrecognized arguments will be passed to target CLI",
      ],
    },

    doctor: {
      name: "doctor",
      description: "Diagnose configuration and environment issues",
      usage: `swixter ${coderName} doctor`,
      args: [],
      examples: [
        {
          description: "Run diagnostic checks",
          command: `swixter ${coderName} doctor`,
        },
      ],
      relatedCommands: ["current"],
      notes: [
        "Checks configuration file integrity",
        "Validates API Key format",
        "Checks target CLI installation status",
        "Tests network connectivity",
      ],
    },
  };
}

/**
 * Show command help
 */
export function showCommandHelp(coderName: string, commandName: string, coderConfig: CoderConfig): void {
  const allHelp = getCommandHelp(coderName);
  const help = allHelp[commandName];

  if (!help) {
    console.log(pc.red(`Unknown command: ${commandName}`));
    console.log(pc.dim(`Use 'swixter ${coderName} --help' to see all available commands`));
    return;
  }

  console.log(`
${pc.bold(pc.cyan(help.description))}

${pc.bold("Command:")} ${pc.green(help.name)}${help.aliases ? pc.dim(` (aliases: ${help.aliases.join(", ")})`) : ""}

${pc.bold("Usage:")}
  ${pc.green(help.usage)}
${
  help.args.length > 0
    ? `
${pc.bold("Arguments:")}
${help.args
  .map(
    (arg) =>
      `  ${pc.cyan(arg.name.padEnd(25))} ${arg.description}
   ${pc.dim(arg.required ? "✱ Required" : "○ Optional")}${arg.defaultValue ? pc.dim(` (default: ${arg.defaultValue})`) : ""}${arg.type ? pc.dim(` [${arg.type}]`) : ""}`
  )
  .join("\n")}`
    : ""
}
${pc.bold("Examples:")}
${help.examples
  .map(
    (ex) =>
      `  ${pc.dim("# " + ex.description)}
  ${pc.green(ex.command)}`
  )
  .join("\n\n")}
${
  help.relatedCommands && help.relatedCommands.length > 0
    ? `
${pc.bold("Related Commands:")}
  ${help.relatedCommands.map((cmd) => pc.cyan(cmd)).join(", ")}`
    : ""
}
${
  help.notes && help.notes.length > 0
    ? `
${pc.bold("Notes:")}
${help.notes.map((note) => `  • ${pc.dim(note)}`).join("\n")}`
    : ""
}
`);
}

/**
 * Show main coder help
 */
export function showCoderHelp(coderName: string, coderConfig: CoderConfig): void {
  console.log(`
${pc.bold(pc.cyan(`Swixter - ${coderConfig.displayName} Configuration Manager`))}

${pc.bold("Usage:")}
  ${pc.green(`swixter ${coderName} <command> [options]`)}

${pc.bold("Common Commands:")}
  ${pc.cyan("create")}              ${pc.dim("Create new configuration")}
  ${pc.cyan("list")}                ${pc.dim("List all configurations")}
  ${pc.cyan("switch")}              ${pc.dim("Switch to specified configuration")}
  ${pc.cyan("apply")}               ${pc.dim(`Apply configuration to ${coderConfig.displayName}`)}
  ${pc.cyan("current")}             ${pc.dim("Show currently active configuration")}
  ${pc.cyan("run")}                 ${pc.dim(`Run ${coderConfig.displayName} with configuration`)}

${pc.bold("Management Commands:")}
  ${pc.cyan("edit")}                ${pc.dim("Edit existing configuration")}
  ${pc.cyan("delete")}              ${pc.dim("Delete specified configuration")}

${pc.bold("Utility Commands:")}
  ${pc.cyan("doctor")}              ${pc.dim("Diagnose configuration issues")}

${pc.bold("Command Aliases:")}
  ${pc.dim("ls")} → list          ${pc.dim("sw")} → switch          ${pc.dim("rm")} → delete
  ${pc.dim("new")} → create

${pc.bold("Option Shortcuts:")}
  ${pc.dim("-n")} → --name        ${pc.dim("-p")} → --provider      ${pc.dim("-k")} → --api-key
  ${pc.dim("-a")} → --apply       ${pc.dim("-q")} → --quiet         ${pc.dim("-f")} → --force
  ${pc.dim("-h")} → --help

${pc.bold("Quick Start:")}
  ${pc.dim("# 1. Create configuration")}
  ${pc.green(`swixter ${coderName} create`)}

  ${pc.dim("# 2. List configurations")}
  ${pc.green(`swixter ${coderName} list`)}

  ${pc.dim("# 3. Apply configuration")}
  ${pc.green(`swixter ${coderName} apply`)}

${pc.bold("Getting Help:")}
  ${pc.green(`swixter ${coderName} --help`)}           ${pc.dim("Show this help")}
  ${pc.green(`swixter ${coderName} <command> --help`)} ${pc.dim("Show detailed command help")}
  ${pc.green(`swixter providers`)}                ${pc.dim("View all available providers")}

${pc.dim("Documentation: https://github.com/loonghao/swixter")}
`);
}

/**
 * Show global help
 */
export function showGlobalHelp(): void {
  console.log(`
${pc.bold(pc.cyan("Swixter - AI Coder Configuration Manager"))}

${pc.bold("Usage:")}
  ${pc.green("swixter <coder> <command> [options]")}
  ${pc.green("swixter <global-command> [options]")}

${pc.bold("Supported Coders:")}
  ${pc.cyan("claude")}              ${pc.dim("Claude Code configuration management")}
  ${pc.cyan("codex")}               ${pc.dim("Codex configuration management")}
  ${pc.cyan("qwen")}                ${pc.dim("Continue/Qwen configuration management")}

${pc.bold("Global Commands:")}
  ${pc.cyan("providers")}           ${pc.dim("List all available API providers")}
  ${pc.cyan("export <file>")}       ${pc.dim("Export all configurations to file")}
  ${pc.cyan("import <file>")}       ${pc.dim("Import configurations from file")}
  ${pc.cyan("completion <shell>")}  ${pc.dim("Generate shell auto-completion script")}
  ${pc.cyan("doctor")}              ${pc.dim("Diagnose system configuration")}
  ${pc.cyan("help")}                ${pc.dim("Show help information")}
  ${pc.cyan("version")}             ${pc.dim("Show version information")}

${pc.bold("Examples:")}
  ${pc.dim("# View Claude Code commands")}
  ${pc.green("swixter claude --help")}

  ${pc.dim("# Create Claude Code configuration")}
  ${pc.green("swixter claude create")}

  ${pc.dim("# View all providers")}
  ${pc.green("swixter providers")}

  ${pc.dim("# Export configurations")}
  ${pc.green("swixter export my-config.json")}

  ${pc.dim("# Install bash auto-completion")}
  ${pc.green("swixter completion bash > ~/.local/share/bash-completion/completions/swixter")}

${pc.dim("Documentation: https://github.com/loonghao/swixter")}
`);
}
