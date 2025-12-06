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

const CODER_NAME = "claude";
const CODER_CONFIG = CODER_REGISTRY[CODER_NAME];

/**
 * Claude Code subcommand handler
 */
export async function handleClaudeCommand(args: string[]): Promise<void> {
  const command = args[0];

  if (command === "--help" || command === "-h") {
    showClaudeHelp();
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
 * Show Claude Code help
 */
function showClaudeHelp(): void {
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
  ${pc.green(`swixter ${CODER_NAME} create --quiet --name <name> --provider <id> --api-key <key> [--base-url <url>] [--apply]`)}

${pc.bold("Examples:")}
  ${pc.dim("# Interactive profile creation")}
  ${pc.green(`swixter ${CODER_NAME} create`)}

  ${pc.dim("# Non-interactive profile creation")}
  ${pc.green(`swixter ${CODER_NAME} create --quiet --name my-config --provider anthropic --api-key sk-ant-xxx`)}

  ${pc.dim("# Switch profile (short alias: sw)")}
  ${pc.green(`swixter ${CODER_NAME} sw my-config`)}

  ${pc.dim("# List all profiles (short alias: ls)")}
  ${pc.green(`swixter ${CODER_NAME} ls`)}

  ${pc.dim(`# Apply profile to ${CODER_CONFIG.displayName}`)}
  ${pc.green(`swixter ${CODER_NAME} apply`)}

  ${pc.dim(`# Run ${CODER_CONFIG.displayName} with current profile (ultra-short alias: r)`)}
  ${pc.green(`swixter ${CODER_NAME} r`)}

  ${pc.dim(`# Run ${CODER_CONFIG.displayName} with specified profile (no switch needed)`)}
  ${pc.green(`swixter ${CODER_NAME} run --profile my-config`)}

  ${pc.dim(`# Run ${CODER_CONFIG.displayName} and pass other arguments`)}
  ${pc.green(`swixter ${CODER_NAME} r --print "What is 2+2?"`)}
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
  const presets = allPresets;

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
    message: "API Key (corresponds to ANTHROPIC_API_KEY, optional)",
    placeholder: preset?.id === "anthropic" ? "sk-ant-..." : "Enter your API Key",
  });

  if (p.isCancel(apiKey)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // 4. Enter Auth Token
  const authToken = await p.text({
    message: "Auth Token (corresponds to ANTHROPIC_AUTH_TOKEN, optional)",
    placeholder: "Enter your Auth Token",
  });

  if (p.isCancel(authToken)) {
    p.cancel(ERRORS.cancelled);
    process.exit(EXIT_CODES.userCancelled);
  }

  // 5. Custom Base URL (optional)
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

  // 6. Apply immediately?
  const shouldApply = await p.confirm({
    message: "Apply this profile to Claude Code now?",
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

    // Add authToken (if provided)
    if (authToken) {
      profile.authToken = authToken as string;
    }

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
    console.log(pc.dim("Usage: swixter claude create --quiet --name <name> --provider <id> [--api-key <key>] [--auth-token <token>] [--base-url <url>] [--apply]"));
    process.exit(1);
  }

  const preset = getPresetById(params.provider as string);
  if (!preset) {
    console.log(pc.red(`Error: Unknown provider ID: ${params.provider}`));
    console.log(pc.dim("Run 'swixter providers' to see all supported providers"));
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

    // Add authToken (if provided)
    if (params["auth-token"]) {
      profile.authToken = params["auth-token"] as string;
    }

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
    if (profile.apiKey) {
      console.log(`  API Key: ${pc.dim(profile.apiKey.slice(0, 10) + "...")}`);
    }
    if (profile.authToken) {
      console.log(`  Auth Token: ${pc.dim(profile.authToken.slice(0, 10) + "...")}`);
    }
    console.log();

    // If --apply specified, apply profile immediately
    if (params.apply) {
      console.log(pc.dim("Applying profile to Claude Code..."));
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
    console.log(pc.dim("Usage: swixter claude switch <name>"));
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
    console.log(pc.dim("Usage: swixter claude delete <name>"));
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
      console.log(pc.dim("Run 'swixter claude create' to create a profile"));
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
    console.log(pc.dim("Run 'swixter claude list' to see all profiles"));
    process.exit(1);
  }

  console.log();
  console.log(pc.bold(pc.cyan(`Edit profile: ${profileName}`)));
  console.log();

  const { allPresets } = await import("../providers/presets.js");
  const presets = allPresets;
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
    message: "API Key (ANTHROPIC_API_KEY, leave empty to keep current)",
    placeholder: profile.apiKey ? profile.apiKey.slice(0, 10) + "..." : "None",
  });

  if (p.isCancel(newApiKey)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  // 3. Edit Auth Token
  const newAuthToken = await p.text({
    message: "Auth Token (ANTHROPIC_AUTH_TOKEN, leave empty to keep current)",
    placeholder: profile.authToken ? profile.authToken.slice(0, 10) + "..." : "None",
  });

  if (p.isCancel(newAuthToken)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  // 4. Edit Base URL
  const currentBaseURL = profile.baseURL || newPreset?.baseURL || "";
  const newBaseURL = await p.text({
    message: "Base URL (leave empty for default, enter 'clear' to remove custom URL)",
    placeholder: currentBaseURL,
  });

  if (p.isCancel(newBaseURL)) {
    p.cancel(ERRORS.cancelled);
    return;
  }

  // 5. Apply immediately?
  const shouldApply = await p.confirm({
    message: "Apply this profile to Claude Code now?",
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

    // Handle Auth Token
    if (newAuthToken) {
      updatedProfile.authToken = newAuthToken as string;
    } else if (profile.authToken) {
      updatedProfile.authToken = profile.authToken;
    }

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
  console.log(pc.bold(pc.cyan("Claude Code Configuration Management")));
  console.log();

  const action = await p.select({
    message: "Select operation",
    options: [
      { value: "run", label: "Run Claude Code now", hint: "Execute with current profile" },
      { value: "create", label: "Create new profile", hint: "Interactive profile creation" },
      { value: "list", label: "List all profiles", hint: "View existing profiles" },
      { value: "switch", label: "Switch profile", hint: "Switch to another profile" },
      { value: "edit", label: "Edit profile", hint: "Edit existing profile" },
      { value: "apply", label: "Apply profile", hint: "Apply current profile to Claude Code" },
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
 * Run Claude Code
 * Run Claude Code CLI with current or specified profile
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
      console.log(pc.dim("Run 'swixter claude list' to see all profiles"));
      process.exit(1);
    }
  } else {
    // Use current active profile
    profile = await getActiveProfileForCoder(CODER_NAME);

    if (!profile) {
      console.log(pc.yellow("No active profile"));
      console.log(pc.dim("Run 'swixter claude create' to create a profile, or use --profile to specify one"));
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

  // Set API Key (if available)
  if (profile.apiKey) {
    env.ANTHROPIC_API_KEY = profile.apiKey;
  }

  // Set Auth Token (if available)
  if (profile.authToken) {
    env.ANTHROPIC_AUTH_TOKEN = profile.authToken;
  }

  // Set Base URL
  if (baseURL) {
    env.ANTHROPIC_BASE_URL = baseURL;
  }

  // Filter out --profile parameter, pass other arguments to claude
  const claudeArgs = args.filter((arg, idx) => {
    if (arg === "--profile") {
      // Skip --profile and its value
      return false;
    }
    if (idx > 0 && args[idx - 1] === "--profile") {
      // Skip --profile value
      return false;
    }
    return true;
  });

  // Show profile being used
  console.log();
  console.log(pc.dim(`Using profile: ${pc.cyan(profile.name)} (${preset?.displayName})`));
  console.log(pc.dim(`Base URL: ${pc.yellow(baseURL || "Default")}`));
  console.log();

  // Use shared utility for spawning CLI
  spawnCLI({
    command: "claude",
    args: claudeArgs,
    env,
    displayName: CODER_CONFIG.displayName,
  });
}
