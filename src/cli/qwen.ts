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

const CODER_NAME = "qwen";
const CODER_CONFIG = CODER_REGISTRY[CODER_NAME];

/**
 * Qwen/Continue subcommand handler
 */
export async function handleQwenCommand(args: string[]): Promise<void> {
  const command = args[0];

  if (command === "--help" || command === "-h") {
    showQwenHelp();
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
 * Show Qwen help
 */
function showQwenHelp(): void {
  console.log(`
${pc.bold(pc.cyan("Swixter - Continue/Qwen Configuration Management"))}

${pc.bold("Usage:")}
  ${pc.green("swixter qwen <command> [options]")}

${pc.bold("Commands:")}
  ${pc.cyan("run, r")}              Run Qwen Code with current profile
  ${pc.cyan("create")}              Create new profile (interactive, use --quiet for non-interactive)
  ${pc.cyan("list, ls")}            List all profiles
  ${pc.cyan("switch, sw")} <name>   Switch to specified profile
  ${pc.cyan("edit [name]")}         Edit profile (interactive)
  ${pc.cyan("apply")}               Apply current profile to Continue
  ${pc.cyan("current")}             Show current active profile
  ${pc.cyan("delete, rm")} <name>   Delete specified profile
  ${pc.cyan("--help, -h")}          Show this help message

${pc.bold("Create profile (interactive):")}
  ${pc.green("swixter qwen create")}

${pc.bold("Create profile (non-interactive):")}
  ${pc.green("swixter qwen create --quiet --name <name> --provider <id> [--api-key <key>] [--base-url <url>] [--apply]")}

${pc.bold("Examples:")}
  ${pc.dim("# Create Ollama local profile")}
  ${pc.green('swixter qwen create --quiet --name qwen-local --provider ollama --base-url http://localhost:11434')}

  ${pc.dim("# Create custom provider profile and apply immediately")}
  ${pc.green('swixter qwen create --quiet --name my-config --provider custom --api-key your-api-key --base-url https://api.example.com --apply')}

  ${pc.dim("# Switch profile (short alias: sw)")}
  ${pc.green("swixter qwen sw my-config")}

  ${pc.dim("# List all profiles (short alias: ls)")}
  ${pc.green("swixter qwen ls")}

  ${pc.dim("# Run Qwen Code with current profile (ultra-short alias: r)")}
  ${pc.green("swixter qwen r")}

  ${pc.dim("# Run Qwen Code with specified profile (no switch needed)")}
  ${pc.green("swixter qwen run --profile my-config")}

  ${pc.dim("# Run Qwen Code and pass other arguments")}
  ${pc.green("swixter qwen r --prompt \"What is 2+2?\"")}
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
  console.log(pc.bold(pc.cyan("Create Continue/Qwen Profile")));
  console.log();

  const { allPresets } = await import("../providers/presets.js");
  // Filter out Anthropic provider as it's not compatible with OpenAI API format
  const presets = allPresets.filter(preset => preset.id !== 'anthropic');

  // 1. Enter profile name
  const name = await p.text({
    message: "Profile name",
    placeholder: "my-qwen-config",
    validate: (value) => {
      if (!value) return "Profile name cannot be empty";
      if (value.length < 2) return "Profile name must be at least 2 characters";
      return;
    },
  });

  if (p.isCancel(name)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // 2. Select provider
  const providerId = await p.select({
    message: "Select API provider",
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

  // 3. Enter API Key (optional for Ollama)
  const apiKey = await p.text({
    message: preset?.id === "ollama" ? "API Key (optional, not required for Ollama)" : "API Key",
    placeholder: preset?.id === "ollama" ? "Leave empty" : "Enter your API Key",
    validate: (value) => {
      if (!value && preset?.id !== "ollama") return "API Key cannot be empty";
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

  // 5. Apply immediately?
  const shouldApply = await p.confirm({
    message: "Apply this profile to Continue now?",
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

    await upsertProfile(profile, CODER_NAME);
    spinner.stop("Profile created successfully!");

    console.log();
    console.log(`  Profile name: ${pc.cyan(profile.name)}`);
    console.log(`  Provider: ${pc.yellow(preset?.displayName)}`);
    console.log(`  Base URL: ${pc.yellow(finalBaseURL || "Default")}`);
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
    console.log(pc.dim("Usage: swixter qwen create --quiet --name <name> --provider <id> [--api-key <key>] [--base-url <url>]"));
    process.exit(1);
  }

  const preset = getPresetById(params.provider as string);
  if (!preset) {
    console.log(pc.red(`Error: Unknown provider ID: ${params.provider}`));
    console.log(pc.dim("Run 'swixter providers' to see all supported providers"));
    process.exit(1);
  }

  // Anthropic provider is not compatible with OpenAI API format
  if (preset.id === 'anthropic') {
    console.log(pc.red("Error: Anthropic provider is not compatible with Continue/Qwen"));
    console.log(pc.dim("Continue/Qwen uses OpenAI API format. Use 'ollama' or 'custom' provider instead."));
    process.exit(1);
  }

  // Ollama doesn't require API key
  if (params.provider !== "ollama" && !params["api-key"]) {
    console.log(pc.red("Error: This provider requires --api-key parameter"));
    process.exit(1);
  }

  try {
    const finalBaseURL = (params["base-url"] as string) || preset.baseURL;

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

    await upsertProfile(profile, CODER_NAME);

    console.log();
    console.log(pc.green("✓") + " Profile created successfully!");
    console.log();
    console.log(`  Profile name: ${pc.cyan(profile.name)}`);
    console.log(`  Provider: ${pc.yellow(preset.displayName)}`);
    console.log(`  Base URL: ${pc.yellow(finalBaseURL || "Default")}`);
    console.log();

    if (params.apply) {
      console.log(pc.dim("Applying profile to Continue..."));
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
    console.log(pc.dim("Usage: swixter qwen switch <name>"));
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
    console.log(pc.dim("Usage: swixter qwen delete <name>"));
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
      console.log(pc.dim("Run 'swixter qwen create' to create a profile"));
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
    console.log(pc.dim("Run 'swixter qwen list' to see all profiles"));
    process.exit(1);
  }

  console.log();
  console.log(pc.bold(pc.cyan(`Edit profile: ${profileName}`)));
  console.log();

  const { allPresets } = await import("../providers/presets.js");
  // Filter out Anthropic provider as it's not compatible with OpenAI API format
  const presets = allPresets.filter(preset => preset.id !== 'anthropic');
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

  // 2. Edit API Key (if any)
  const apiKeyPlaceholder = profile.apiKey
    ? profile.apiKey.slice(0, 10) + "..."
    : "No API Key (Ollama)";

  const newApiKey = await p.text({
    message: "API Key (leave empty to keep current, optional for Ollama)",
    placeholder: apiKeyPlaceholder,
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

  // 4. Apply immediately?
  const shouldApply = await p.confirm({
    message: "Apply this profile to Continue now?",
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

    const finalBaseURL = updatedProfile.baseURL || newPreset?.baseURL || "";

    await upsertProfile(updatedProfile, CODER_NAME);
    spinner.stop("Profile updated successfully!");

    console.log();
    console.log(`  Profile name: ${pc.cyan(updatedProfile.name)}`);
    console.log(`  Provider: ${pc.yellow(newPreset?.displayName)}`);
    console.log(`  Base URL: ${pc.yellow(finalBaseURL || "Default")}`);
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
    console.log(pc.dim("Run 'swixter qwen create' to create a profile"));
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
  if (profile.apiKey) {
    console.log(`  API Key: ${pc.dim(profile.apiKey.slice(0, 10) + "...")}`);
  }
  console.log();
}

/**
 * Interactive main menu
 */
async function cmdMainMenu(): Promise<void> {
  console.log();
  console.log(pc.bold(pc.cyan("Continue/Qwen Configuration Management")));
  console.log();

  const action = await p.select({
    message: "Select operation",
    options: [
      { value: "run", label: "Run Qwen Code now", hint: "Execute with current profile" },
      { value: "create", label: "Create new profile", hint: "Interactive profile creation" },
      { value: "list", label: "List all profiles", hint: "View existing profiles" },
      { value: "switch", label: "Switch profile", hint: "Switch to another profile" },
      { value: "edit", label: "Edit profile", hint: "Edit existing profile" },
      { value: "apply", label: "Apply profile", hint: "Apply current profile to Continue" },
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
 * Run Qwen Code
 * Run Qwen Code CLI with current or specified profile
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
      console.log(pc.dim("Run 'swixter qwen list' to see all profiles"));
      process.exit(1);
    }
  } else {
    // Use current active profile
    profile = await getActiveProfileForCoder(CODER_NAME);

    if (!profile) {
      console.log(pc.yellow("No active profile"));
      console.log(pc.dim("Run 'swixter qwen create' to create a profile, or use --profile to specify one"));
      process.exit(1);
    }
  }

  // Get preset and baseURL
  const preset = getPresetById(profile.providerId);
  const baseURL = profile.baseURL || preset?.baseURL || "";

  // Build environment variables
  const env = {
    ...process.env,
  };

  // Set corresponding environment variables based on provider
  if (profile.apiKey) {
    env.OPENAI_API_KEY = profile.apiKey;
  }
  if (baseURL) {
    env.OPENAI_BASE_URL = baseURL;
  }

  // Filter out --profile parameter, build qwen arguments
  const qwenArgs = [];

  // Add API key to arguments if available
  if (profile.apiKey) {
    qwenArgs.push("--openai-api-key", profile.apiKey);
  }

  // Add base URL to arguments if available
  if (baseURL) {
    qwenArgs.push("--openai-base-url", baseURL);
  }

  // Add other user-provided arguments (excluding --profile)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profile") {
      // Skip --profile and its value
      i++;
      continue;
    }
    qwenArgs.push(args[i]);
  }

  // Show profile being used
  console.log();
  console.log(pc.dim(`Using profile: ${pc.cyan(profile.name)} (${preset?.displayName})`));
  console.log(pc.dim(`Base URL: ${pc.yellow(baseURL || "Default")}`));
  console.log();

  // Use shared utility for spawning CLI
  spawnCLI({
    command: "qwen",
    args: qwenArgs,
    env,
    displayName: CODER_CONFIG.displayName,
  });
}
