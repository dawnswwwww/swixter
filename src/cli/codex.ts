import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  upsertProfile,
  setActiveProfileForCoder,
  getActiveProfileForCoder,
  listProfiles,
  deleteProfile,
} from "../config/manager.js";
import { getPresetById } from "../providers/presets.js";
import { getAdapter } from "../adapters/index.js";
import type { ClaudeCodeProfile } from "../types.js";
import {
  CODER_REGISTRY,
  ERRORS,
  SUCCESS,
  PROMPTS,
  VALIDATION,
  USAGE,
  INFO,
  PROGRESS,
  LABELS,
  MENU,
  MENU_HINTS,
  PLACEHOLDERS,
  DEFAULT_PLACEHOLDERS,
  MISC_DEFAULTS,
  MARKERS,
  EXIT_CODES,
} from "../constants/index.js";
import {
  withSpinner,
  showError,
  showSuccess,
  formatProfileListItem,
  showProfileDetails,
} from "../utils/ui.js";
import { ProfileValidators } from "../utils/validation.js";
import { handleApplyPrompt } from "../utils/commands.js";
import { spawnCLI } from "../utils/process.js";

const CODER_NAME = "codex";
const CODER_CONFIG = CODER_REGISTRY[CODER_NAME];

/**
 * Codex subcommand handler
 */
export async function handleCodexCommand(args: string[]): Promise<void> {
  const command = args[0];

  if (command === "--help" || command === "-h") {
    showCodexHelp();
    return;
  }

  // Launch interactive main menu when no arguments provided
  if (!command) {
    await cmdMainMenu();
    return;
  }

  switch (command) {
    case "create":
    case "create-profile": // Backward compatibility
    case "new": // Short alias
      await cmdCreate(args.slice(1));
      break;
    case "list":
    case "ls": // Short alias
      await cmdList();
      break;
    case "switch":
    case "sw": // Short alias
      await cmdSwitch(args[1], args.slice(2));
      break;
    case "edit":
    case "update":
      await cmdEdit(args[1]);
      break;
    case "delete":
    case "delete-profile": // Backward compatibility
    case "rm": // Short alias
      await cmdDelete(args[1]);
      break;
    case "apply":
      await cmdApply();
      break;
    case "current":
      await cmdCurrent();
      break;
    case "run":
    case "r": // Ultra-short alias
      await cmdRun(args.slice(1));
      break;
    default:
      showError(
        ERRORS.unknownCommand(command),
        USAGE.checkHelp(CODER_NAME)
      );
  }
}

/**
 * Show Codex help
 */
function showCodexHelp(): void {
  console.log(`
${pc.bold(pc.cyan(`Swixter - ${CODER_CONFIG.displayName} Configuration Management`))}

${pc.bold("Usage:")}
  ${pc.green(`swixter ${CODER_NAME} <command> [options]`)}

${pc.bold("Commands:")}
  ${pc.cyan("run, r")}              Run ${CODER_CONFIG.displayName} with current profile
  ${pc.cyan("create")}              Create new profile (interactive, use --quiet for non-interactive)
  ${pc.cyan("list, ls")}            List all profiles
  ${pc.cyan("switch, sw")} <name>   Switch to specified profile
  ${pc.cyan("edit [name]")}         Edit profile (interactive)
  ${pc.cyan("apply")}               Apply current profile to ${CODER_CONFIG.displayName}
  ${pc.cyan("current")}             Show current active profile
  ${pc.cyan("delete, rm")} <name>   Delete specified profile
  ${pc.cyan("--help, -h")}          Show this help message

${pc.bold("Create profile (interactive):")}
  ${pc.green(`swixter ${CODER_NAME} create`)}

${pc.bold("Create profile (non-interactive):")}
  ${pc.green(`swixter ${CODER_NAME} create --quiet --name <name> --provider <id> --api-key <key> [--base-url <url>] [--model <model>] [--env-key <var>] [--apply]`)}

${pc.bold("Examples:")}
  ${pc.dim("# Interactive profile creation")}
  ${pc.green(`swixter ${CODER_NAME} create`)}

  ${pc.dim("# Create Ollama local profile")}
  ${pc.green(`swixter ${CODER_NAME} create --quiet --name local --provider ollama --base-url http://localhost:11434`)}

  ${pc.dim("# Create custom provider profile")}
  ${pc.green(`swixter ${CODER_NAME} create --quiet --name my-config --provider custom --api-key your-key --base-url https://api.example.com`)}

  ${pc.dim("# Create custom provider profile with custom env var")}
  ${pc.green(`swixter ${CODER_NAME} create --quiet --name my-config --provider custom --api-key your-key --base-url https://api.example.com --env-key MY_CUSTOM_API_KEY`)}

  ${pc.dim("# Switch profile (short alias: sw)")}
  ${pc.green(`swixter ${CODER_NAME} sw my-config`)}

  ${pc.dim("# List all profiles (short alias: ls)")}
  ${pc.green(`swixter ${CODER_NAME} ls`)}

  ${pc.dim(`# Apply profile to ${CODER_CONFIG.displayName} (writes config.toml)`)}
  ${pc.green(`swixter ${CODER_NAME} apply`)}

  ${pc.dim(`# Run ${CODER_CONFIG.displayName} with current profile (ultra-short alias: r)`)}
  ${pc.green(`swixter ${CODER_NAME} r`)}

  ${pc.dim(`# Run ${CODER_CONFIG.displayName} with specific profile`)}
  ${pc.green(`swixter ${CODER_NAME} run --profile my-config`)}
`);
}

/**
 * Parse command line arguments
 */
function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1];

      // Check if it's a boolean flag
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

/**
 * Create profile (interactive or non-interactive)
 */
async function cmdCreate(args: string[]): Promise<void> {
  const params = parseArgs(args);

  // Check if non-interactive mode
  if (params.quiet) {
    await cmdCreateQuiet(params);
    return;
  }

  // Interactive mode
  await cmdCreateInteractive();
}

/**
 * Interactive profile creation
 */
async function cmdCreateInteractive(): Promise<void> {
  console.log();
  console.log(pc.bold(pc.cyan(PROMPTS.createProfile(CODER_CONFIG.displayName))));
  console.log();

  const { allPresets } = await import("../providers/presets.js");
  // Filter out Anthropic provider - Codex only supports OpenAI-compatible (chat API) providers
  const presets = allPresets.filter(preset => preset.wire_api === 'chat');

  // 1. Enter profile name
  const name = await p.text({
    message: PROMPTS.configName,
    placeholder: DEFAULT_PLACEHOLDERS.configName,
    validate: ProfileValidators.name,
  });

  if (p.isCancel(name)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // 2. Select provider
  const providerId = await p.select({
    message: PROMPTS.selectProvider,
    options: presets.map((preset) => ({
      value: preset.id,
      label: preset.displayName,
      hint: preset.baseURL,
    })),
  });

  if (p.isCancel(providerId)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  const preset = presets.find((p) => p.id === providerId);

  // 3. Enter API Key
  const apiKey = await p.text({
    message: "API Key (optional for Ollama)",
    placeholder: preset?.id === "ollama" ? "Leave empty for Ollama" : "Enter your API Key",
    validate: (value) => {
      if (!value && preset?.id !== "ollama") return "API Key cannot be empty (except for Ollama)";
      return;
    },
  });

  if (p.isCancel(apiKey)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // 4. Custom Base URL (optional)
  const customBaseURL = await p.text({
    message: "Base URL (optional, leave empty for default)",
    placeholder: preset?.baseURL || "https://api.example.com",
    validate: (value) => {
      // Allow empty (will use preset default)
      if (!value || value.trim() === "") {
        return undefined;
      }
      // Validate URL format
      return ProfileValidators.url(value);
    },
  });

  if (p.isCancel(customBaseURL)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // 5. Model selection
  let modelName: string | symbol = "";

  if (preset && preset.defaultModels && preset.defaultModels.length > 0) {
    // Provider has default models - show selection
    modelName = await p.select({
      message: "Select model",
      options: [
        ...preset.defaultModels.map((model) => ({
          value: model,
          label: model,
        })),
        {
          value: "__custom__",
          label: "Enter custom model name",
        },
      ],
    });

    if (p.isCancel(modelName)) {
      p.cancel(ERRORS.cancelled);
      process.exit(EXIT_CODES.userCancelled);
    }

    // If user selected custom, ask for input
    if (modelName === "__custom__") {
      modelName = await p.text({
        message: "Enter model name",
        placeholder: "gpt-4",
        validate: (value) => {
          if (!value || value.trim() === "") return "Model name cannot be empty";
          return;
        },
      });

      if (p.isCancel(modelName)) {
        p.cancel(ERRORS.cancelled);
        process.exit(EXIT_CODES.userCancelled);
      }
    }
  } else {
    // No default models - ask for input
    modelName = await p.text({
      message: "Model name (optional)",
      placeholder: "e.g., gpt-4, claude-3-5-sonnet",
      validate: (value) => {
        // Model is optional, so empty is allowed
        return;
      },
    });

    if (p.isCancel(modelName)) {
      p.cancel(ERRORS.cancelled);
      process.exit(EXIT_CODES.userCancelled);
    }
  }

  // 6. Custom env_key (optional)
  const customEnvKey = await p.text({
    message: "Environment variable name (optional, leave empty for provider default)",
    placeholder: preset?.env_key || "OPENAI_API_KEY",
    validate: (value) => {
      // No validation required - accept any input
      return;
    },
  });

  if (p.isCancel(customEnvKey)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // 7. Apply immediately?
  const shouldApply = await p.confirm({
    message: `Apply this profile to ${CODER_CONFIG.displayName} now?`,
    initialValue: true,
  });

  if (p.isCancel(shouldApply)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // Create profile
  const spinner = p.spinner();
  spinner.start("Creating profile...");

  try {
    const finalBaseURL = (customBaseURL as string) || preset?.baseURL;
    const finalModel = modelName as string;

    const profile: ClaudeCodeProfile = {
      name: name as string,
      providerId: providerId as string,
      apiKey: (apiKey as string) || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (finalBaseURL) {
      profile.baseURL = finalBaseURL;
    }

    if (finalModel) {
      profile.model = finalModel;
    }

    // Add custom env_key if provided and not empty
    if (customEnvKey && (customEnvKey as string).trim() !== "") {
      profile.envKey = (customEnvKey as string).trim();
    }

    await upsertProfile(profile, CODER_NAME);
    spinner.stop("Profile created successfully!");

    console.log();
    console.log(`  Profile name: ${pc.cyan(profile.name)}`);
    console.log(`  Provider: ${pc.yellow(preset?.displayName)}`);
    console.log(`  Base URL: ${pc.yellow(finalBaseURL || "Default")}`);
    if (finalModel) {
      console.log(`  Model: ${pc.green(finalModel)}`);
    }
    console.log();

    // If apply immediately selected
    if (shouldApply) {
      // First switch to the newly created profile
      await setActiveProfileForCoder(CODER_NAME, profile.name);
      await cmdApply();
    }
  } catch (error) {
    spinner.stop(pc.red(`Creation failed: ${error}`));
    process.exit(1);
  }
}

/**
 * Non-interactive profile creation
 */
async function cmdCreateQuiet(params: Record<string, string | boolean>): Promise<void> {
  if (!params.name || !params.provider) {
    console.log(pc.red("Error: Missing required parameters"));
    console.log(pc.dim(`Usage: swixter ${CODER_NAME} create --quiet --name <name> --provider <id> [--api-key <key>] [--base-url <url>] [--model <model>] [--env-key <var>] [--apply]`));
    process.exit(1);
  }

  const preset = getPresetById(params.provider as string);
  if (!preset) {
    console.log(pc.red(`Error: Unknown provider ID: ${params.provider}`));
    console.log(pc.dim("Run 'swixter providers' to see all supported providers"));
    process.exit(1);
  }

  // Codex only supports OpenAI-compatible (chat API) providers
  if (preset.wire_api !== 'chat') {
    console.log(pc.red(`Error: Provider "${preset.displayName}" is not compatible with ${CODER_CONFIG.displayName}`));
    console.log(pc.dim(`${CODER_CONFIG.displayName} only supports OpenAI-compatible providers (chat API).`));
    console.log(pc.dim("Use 'ollama' or 'custom' provider instead."));
    process.exit(1);
  }

  // Ollama doesn't require API key
  if (params.provider !== "ollama" && !params["api-key"]) {
    console.log(pc.red("Error: This provider requires --api-key parameter"));
    process.exit(1);
  }

  try {
    const finalBaseURL = (params["base-url"] as string) || preset.baseURL;
    const finalModel = params.model as string;

    const profile: ClaudeCodeProfile = {
      name: params.name as string,
      providerId: params.provider as string,
      apiKey: (params["api-key"] as string) || "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (finalBaseURL) {
      profile.baseURL = finalBaseURL;
    }

    if (finalModel) {
      profile.model = finalModel;
    }

    // Add custom env_key if provided
    if (params["env-key"]) {
      profile.envKey = params["env-key"] as string;
    }

    await upsertProfile(profile, CODER_NAME);

    console.log();
    console.log(pc.green("✓") + " Profile created successfully!");
    console.log();
    console.log(`  Profile name: ${pc.cyan(profile.name)}`);
    console.log(`  Provider: ${pc.yellow(preset.displayName)}`);
    console.log(`  Base URL: ${pc.yellow(finalBaseURL || "Default")}`);
    if (finalModel) {
      console.log(`  Model: ${pc.green(finalModel)}`);
    }
    if (profile.apiKey) {
      console.log(`  API Key: ${pc.dim(profile.apiKey.slice(0, 10) + "...")}`);
    }
    console.log();

    // If --apply specified, apply profile immediately
    if (params.apply) {
      console.log(pc.dim(`Applying profile to ${CODER_CONFIG.displayName}...`));
      // First switch to the newly created profile
      await setActiveProfileForCoder(CODER_NAME, profile.name);
      await cmdApply();
    }
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ Creation failed: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * List all profiles
 */
async function cmdList(): Promise<void> {
  const profiles = await listProfiles();
  const current = await getActiveProfileForCoder(CODER_NAME);

  if (profiles.length === 0) {
    console.log(pc.yellow(INFO.noProfiles));
    console.log(pc.dim(USAGE.createProfile(CODER_NAME)));
    return;
  }

  console.log();
  console.log(pc.bold(LABELS.profileList));
  console.log();

  for (const profile of profiles) {
    const preset = getPresetById(profile.providerId);
    const isCurrent = current?.name === profile.name;
    const marker = isCurrent ? pc.green(MARKERS.active) : pc.dim(MARKERS.inactive);
    const baseUrl = profile.baseURL || preset?.baseURL || MISC_DEFAULTS.baseUrl;
    console.log(
      `${marker} ${pc.cyan(profile.name.padEnd(20))} ${pc.dim("|")} ${preset?.displayName.padEnd(25)} ${pc.dim("|")} ${pc.yellow(baseUrl)}`
    );
  }

  console.log();
  console.log(pc.dim(INFO.totalProfiles(profiles.length)));
  if (current) {
    console.log(pc.dim(INFO.currentActive(current.name)));
  }
  console.log();
}

/**
 * Switch profile
 */
async function cmdSwitch(profileName: string, args: string[] = []): Promise<void> {
  if (!profileName) {
    console.log(pc.red("Error: Please specify profile name"));
    console.log(pc.dim(`Usage: swixter ${CODER_NAME} switch <name>`));
    process.exit(1);
  }

  try {
    await setActiveProfileForCoder(CODER_NAME, profileName);
    const profile = await getActiveProfileForCoder(CODER_NAME);
    const preset = getPresetById(profile!.providerId);
    const baseUrl = profile!.baseURL || preset?.baseURL || "Default";

    console.log();
    console.log(pc.green("✓") + " Switched successfully!");
    console.log();
    console.log(`  Profile: ${pc.cyan(profile!.name)}`);
    console.log(`  Provider: ${pc.yellow(preset?.displayName)}`);
    console.log(`  Base URL: ${pc.yellow(baseUrl)}`);
    console.log();

    // Use shared utility for apply prompt logic
    await handleApplyPrompt({
      args,
      applyFn: cmdApply,
      coderDisplayName: CODER_CONFIG.displayName,
      coderName: CODER_NAME,
    });
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ Switch failed: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * Delete profile
 */
async function cmdDelete(profileName: string): Promise<void> {
  if (!profileName) {
    console.log(pc.red("Error: Please specify profile name"));
    console.log(pc.dim(`Usage: swixter ${CODER_NAME} delete <name>`));
    process.exit(1);
  }

  try {
    await deleteProfile(profileName);
    console.log();
    console.log(pc.green("✓") + " Deleted successfully!");
    console.log(`  Profile: ${pc.cyan(profileName)}`);
    console.log();
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ Deletion failed: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * Edit profile (interactive or by name)
 */
async function cmdEdit(profileName?: string): Promise<void> {
  // If no profile name specified, select interactively
  if (!profileName) {
    const profiles = await listProfiles();

    if (profiles.length === 0) {
      console.log(pc.yellow("No profiles yet"));
      console.log(pc.dim(`Run 'swixter ${CODER_NAME} create' to create a profile`));
      return;
    }

    const selected = await p.select({
      message: "Select profile to edit",
      options: profiles.map((profile) => ({
        value: profile.name,
        label: profile.name,
        hint: getPresetById(profile.providerId)?.displayName || "",
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel(ERRORS.cancelled);
      return;
    }

    profileName = selected as string;
  }

  // Find profile
  const profiles = await listProfiles();
  const profile = profiles.find((p) => p.name === profileName);

  if (!profile) {
    console.log(pc.red(`Error: Profile "${profileName}" not found`));
    console.log(pc.dim(`Run 'swixter ${CODER_NAME} list' to see all profiles`));
    process.exit(1);
  }

  console.log();
  console.log(pc.bold(pc.cyan(`Edit profile: ${profileName}`)));
  console.log();

  const { allPresets } = await import("../providers/presets.js");
  // Filter out Anthropic provider - Codex only supports OpenAI-compatible (chat API) providers
  const presets = allPresets.filter(preset => preset.wire_api === 'chat');
  const currentPreset = getPresetById(profile.providerId);

  // 1. Change provider?
  const shouldChangeProvider = await p.confirm({
    message: `Change provider? Current: ${currentPreset?.displayName}`,
    initialValue: false,
  });

  if (p.isCancel(shouldChangeProvider)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  let newProviderId = profile.providerId;
  if (shouldChangeProvider) {
    const providerId = await p.select({
      message: "Select new API provider",
      options: presets.map((preset) => ({
        value: preset.id,
        label: preset.displayName,
        hint: preset.baseURL,
      })),
      initialValue: profile.providerId,
    });

    if (p.isCancel(providerId)) {
      p.cancel(ERRORS.cancelled);
      return;
    }

    newProviderId = providerId as string;
  }

  const newPreset = presets.find((p) => p.id === newProviderId);

  // 2. Edit API Key
  const newApiKey = await p.text({
    message: "API Key (leave empty to keep current, optional for Ollama)",
    placeholder: profile.apiKey ? profile.apiKey.slice(0, 10) + "..." : "None",
  });

  if (p.isCancel(newApiKey)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  // 3. Edit Base URL
  const currentBaseURL = profile.baseURL || newPreset?.baseURL || "";
  const newBaseURL = await p.text({
    message: "Base URL (leave empty for default, enter 'clear' to remove custom URL)",
    placeholder: currentBaseURL,
  });

  if (p.isCancel(newBaseURL)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  // 4. Edit Model
  const currentModel = profile.model || "";
  let newModel: string | symbol = "";

  if (newPreset && newPreset.defaultModels && newPreset.defaultModels.length > 0) {
    // Provider has default models - show selection
    newModel = await p.select({
      message: `Model (current: ${currentModel || "none"})`,
      options: [
        {
          value: "",
          label: "Keep current",
        },
        ...newPreset.defaultModels.map((model) => ({
          value: model,
          label: model,
        })),
        {
          value: "__custom__",
          label: "Enter custom model name",
        },
        {
          value: "__clear__",
          label: "Clear model (use default)",
        },
      ],
    });

    if (p.isCancel(newModel)) {
      p.cancel(ERRORS.cancelled);
      return;
    }

    // If user selected custom, ask for input
    if (newModel === "__custom__") {
      newModel = await p.text({
        message: "Enter model name",
        placeholder: currentModel || "gpt-4",
        validate: (value) => {
          if (!value || value.trim() === "") return "Model name cannot be empty";
          return;
        },
      });

      if (p.isCancel(newModel)) {
        p.cancel(ERRORS.cancelled);
        return;
      }
    }
  } else {
    // No default models - ask for text input
    newModel = await p.text({
      message: `Model (leave empty to keep current: ${currentModel || "none"})`,
      placeholder: currentModel || "e.g., gpt-4, claude-3-5-sonnet",
    });

    if (p.isCancel(newModel)) {
      p.cancel(ERRORS.cancelled);
      return;
    }
  }

  // 5. Edit env_key
  const currentEnvKey = profile.envKey || newPreset?.env_key || "OPENAI_API_KEY";
  const newEnvKey = await p.text({
    message: `Environment variable name (leave empty to keep current, enter 'clear' to use provider default)`,
    placeholder: currentEnvKey,
    validate: (value) => {
      // No validation required
      return;
    },
  });

  if (p.isCancel(newEnvKey)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  // 6. Apply immediately?
  const shouldApply = await p.confirm({
    message: `Apply this profile to ${CODER_CONFIG.displayName} now?`,
    initialValue: false,
  });

  if (p.isCancel(shouldApply)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  // Update profile
  const spinner = p.spinner();
  spinner.start("Updating profile...");

  try {
    // Build updated profile
    const updatedProfile: ClaudeCodeProfile = {
      name: profileName,
      providerId: newProviderId,
      apiKey: (newApiKey as string) || profile.apiKey || "",
      createdAt: profile.createdAt,
      updatedAt: new Date().toISOString(),
    };

    // Handle Base URL
    if (newBaseURL === "clear") {
      // Clear custom URL, use default
      // Don't set baseURL field
    } else if (newBaseURL) {
      // Use new custom URL
      updatedProfile.baseURL = newBaseURL as string;
    } else {
      // Keep existing configuration
      if (profile.baseURL) {
        updatedProfile.baseURL = profile.baseURL;
      }
    }

    // Handle Model
    if (newModel === "__clear__") {
      // Clear model, don't set it
      // updatedProfile.model remains undefined
    } else if (newModel && newModel !== "") {
      // Use new model
      updatedProfile.model = newModel as string;
    } else {
      // Keep existing model
      if (profile.model) {
        updatedProfile.model = profile.model;
      }
    }

    // Handle env_key
    if (newEnvKey === "clear") {
      // Clear custom env_key, will use provider default
      // Don't set envKey field
    } else if (newEnvKey && (newEnvKey as string).trim() !== "") {
      // Use new custom env_key
      updatedProfile.envKey = (newEnvKey as string).trim();
    } else {
      // Keep existing env_key
      if (profile.envKey) {
        updatedProfile.envKey = profile.envKey;
      }
    }

    const finalBaseURL = updatedProfile.baseURL || newPreset?.baseURL || "";

    await upsertProfile(updatedProfile, CODER_NAME);
    spinner.stop("Profile updated successfully!");

    console.log();
    console.log(`  Profile name: ${pc.cyan(updatedProfile.name)}`);
    console.log(`  Provider: ${pc.yellow(newPreset?.displayName)}`);
    console.log(`  Base URL: ${pc.yellow(finalBaseURL || "Default")}`);
    if (updatedProfile.model) {
      console.log(`  Model: ${pc.green(updatedProfile.model)}`);
    }
    console.log();

    // If apply immediately selected
    if (shouldApply) {
      await setActiveProfileForCoder(CODER_NAME, profileName);
      await cmdApply();
    }
  } catch (error) {
    spinner.stop(pc.red(`Update failed: ${error}`));
    process.exit(1);
  }
}

/**
 * Apply profile
 */
async function cmdApply(): Promise<void> {
  const profile = await getActiveProfileForCoder(CODER_NAME);

  if (!profile) {
    console.log(pc.yellow("No active profile"));
    console.log(pc.dim("Run 'swixter claude create' to create a profile"));
    return;
  }

  try {
    const adapter = getAdapter(CODER_NAME);
    const preset = getPresetById(profile.providerId);

    console.log();
    console.log(pc.dim(`Applying profile to ${adapter.configPath}...`));

    await adapter.apply(profile);

    // Verify application result
    const verified = await adapter.verify(profile);

    if (verified) {
      console.log(pc.green("✓") + " Profile applied successfully!");
      console.log();
      console.log(`  Profile: ${pc.cyan(profile.name)}`);
      console.log(`  Provider: ${pc.yellow(preset?.displayName)}`);
      console.log(`  Config file: ${pc.dim(adapter.configPath)}`);
      console.log();

      // Show environment variable export commands
      if (adapter.name === "codex" && "getEnvExportCommands" in adapter) {
        const envCommands = (adapter as any).getEnvExportCommands(profile);
        if (envCommands.length > 0) {
          console.log(pc.bold("To use this profile, set environment variables:"));
          console.log();
          envCommands.forEach(cmd => {
            console.log(`  ${pc.green(cmd)}`);
          });
          console.log();
          console.log(pc.dim(`Then run: ${pc.cyan("codex")}`));
          console.log();
        }
      }
    } else {
      console.log(pc.yellow("⚠  Profile written, but verification failed"));
      console.log(pc.dim("Please check config file format"));
      console.log();
    }
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ Apply failed: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * Show current profile
 */
async function cmdCurrent(): Promise<void> {
  const profile = await getActiveProfileForCoder(CODER_NAME);

  if (!profile) {
    console.log(pc.yellow("No active profile"));
    return;
  }

  const preset = getPresetById(profile.providerId);
  const baseUrl = profile.baseURL || preset?.baseURL || "Default";

  console.log();
  console.log(pc.bold("Current active profile:"));
  console.log();
  console.log(`  Name: ${pc.cyan(profile.name)}`);
  console.log(`  Provider: ${pc.yellow(preset?.displayName)}`);
  console.log(`  Base URL: ${pc.yellow(baseUrl)}`);
  console.log(`  API Key: ${pc.dim(profile.apiKey.slice(0, 10) + "...")}`);
  console.log();
}

/**
 * Interactive main menu
 */
async function cmdMainMenu(): Promise<void> {
  console.log();
  console.log(pc.bold(pc.cyan(`${CODER_CONFIG.displayName} Configuration Management`)));
  console.log();

  const action = await p.select({
    message: "Select operation",
    options: [
      { value: "run", label: "Run Codex now", hint: "Execute with current profile" },
      { value: "create", label: "Create new profile", hint: "Interactive profile creation" },
      { value: "list", label: "List all profiles", hint: "View existing profiles" },
      { value: "switch", label: "Switch profile", hint: "Switch to another profile" },
      { value: "edit", label: "Edit profile", hint: "Edit existing profile" },
      { value: "apply", label: "Apply profile", hint: `Apply current profile to ${CODER_CONFIG.displayName}` },
      { value: "current", label: "Show current profile", hint: "View active profile" },
      { value: "delete", label: "Delete profile", hint: "Delete specified profile" },
      { value: "exit", label: "Exit", hint: "Exit program" },
    ],
  });

  if (p.isCancel(action)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  console.log();

  switch (action) {
    case "run":
      await cmdRun([]);
      break;
    case "create":
      await cmdCreate([]);
      break;
    case "list":
      await cmdList();
      break;
    case "switch":
      await cmdSwitchInteractive();
      break;
    case "edit":
      await cmdEdit();
      break;
    case "apply":
      await cmdApply();
      break;
    case "current":
      await cmdCurrent();
      break;
    case "delete":
      await cmdDeleteInteractive();
      break;
    case "exit":
      console.log(pc.green("Goodbye!"));
      process.exit(EXIT_CODES.userCancelled);
  }
}

/**
 * Interactive profile switch
 */
async function cmdSwitchInteractive(): Promise<void> {
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    console.log(pc.yellow("No profiles yet"));
    console.log(pc.dim("Please create a profile first"));
    return;
  }

  const current = await getActiveProfileForCoder(CODER_NAME);

  const profileName = await p.select({
    message: "Select profile to switch to",
    options: profiles.map((profile) => ({
      value: profile.name,
      label: profile.name,
      hint: profile.name === current?.name ? "(current)" : getPresetById(profile.providerId)?.displayName || "",
    })),
  });

  if (p.isCancel(profileName)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  await cmdSwitch(profileName as string);
}

/**
 * Interactive profile deletion
 */
async function cmdDeleteInteractive(): Promise<void> {
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    console.log(pc.yellow("No profiles yet"));
    return;
  }

  const profileName = await p.select({
    message: "Select profile to delete",
    options: profiles.map((profile) => ({
      value: profile.name,
      label: profile.name,
      hint: getPresetById(profile.providerId)?.displayName || "",
    })),
  });

  if (p.isCancel(profileName)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  const confirm = await p.confirm({
    message: `Are you sure you want to delete profile "${profileName}"?`,
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  await cmdDelete(profileName as string);
}

/**
 * Run Codex with current or specified profile
 *
 * This command:
 * 1. Applies the profile to ~/.codex/config.toml (sets active profile)
 * 2. Sets environment variables based on the profile's env_key
 * 3. Spawns codex process with proper environment
 */
async function cmdRun(args: string[]): Promise<void> {
  const params = parseArgs(args);

  // Get profile to use
  let profile: ClaudeCodeProfile | null = null;

  if (params.profile) {
    // Use specified profile
    const profiles = await listProfiles();
    profile = profiles.find((p) => p.name === params.profile) || null;

    if (!profile) {
      console.log(pc.red(`Error: Profile "${params.profile}" not found`));
      console.log(pc.dim(`Run 'swixter ${CODER_NAME} list' to see all profiles`));
      process.exit(1);
    }
  } else {
    // Use current active profile
    profile = await getActiveProfileForCoder(CODER_NAME);

    if (!profile) {
      console.log(pc.yellow("No active profile"));
      console.log(pc.dim(`Run 'swixter ${CODER_NAME} create' to create a profile, or use --profile to specify one`));
      process.exit(1);
    }
  }

  try {
    // Step 1: Apply profile to config.toml (sets active profile)
    const adapter = getAdapter(CODER_NAME);
    await adapter.apply(profile);

    // Step 2: Get preset to determine env_key
    const preset = getPresetById(profile.providerId);
    // Use profile's custom env_key if provided, otherwise use preset default
    const envKey = profile.envKey || preset?.env_key || "OPENAI_API_KEY";

    // Step 3: Build environment variables
    const env = {
      ...process.env,
    };

    // Set the API key using the correct env_key name
    if (profile.apiKey) {
      env[envKey] = profile.apiKey;
    }

    // Step 4: Filter out --profile parameter, build codex arguments
    const codexArgs = args.filter((arg, idx) => {
      if (arg === "--profile" || arg === "-p") {
        return false;
      }
      if (idx > 0 && (args[idx - 1] === "--profile" || args[idx - 1] === "-p")) {
        return false;
      }
      return true;
    });

    // Show what we're doing
    console.log();
    console.log(pc.dim(`Using profile: ${pc.cyan(profile.name)} (${preset?.displayName})`));
    console.log(pc.dim(`Environment: ${pc.yellow(envKey)}=${profile.apiKey ? "***" : "not set"}`));
    console.log(pc.dim(`Config: ${adapter.configPath}`));
    console.log();

    // Use shared utility for spawning CLI
    spawnCLI({
      command: "codex",
      args: codexArgs,
      env,
      displayName: CODER_CONFIG.displayName,
    });
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ Failed to start ${CODER_CONFIG.displayName}: ${error}`));
    console.log();
    process.exit(1);
  }
}
