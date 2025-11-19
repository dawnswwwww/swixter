import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ClaudeCodeProfile, ProviderPreset } from "../types.js";
import { allPresets, getPresetById } from "../providers/presets.js";
import {
  upsertProfile,
  setActiveProfile,
  getActiveProfile,
  listProfiles,
  deleteProfile,
} from "../config/manager.js";
import { exportConfig, importConfig } from "../config/export.js";

/**
 * Show welcome screen
 */
export function showWelcome(): void {
  console.clear();
  p.intro(pc.bgCyan(pc.black(" Swixter - Claude Code Configuration Manager ")));
}

/**
 * Main menu
 */
export async function showMainMenu(): Promise<string> {
  const currentProfile = await getActiveProfile();
  const currentInfo = currentProfile
    ? pc.dim(`Current: ${currentProfile.name} (${getPresetById(currentProfile.providerId)?.displayName})`)
    : pc.dim("Not configured");

  const action = await p.select({
    message: `Select action ${currentInfo}`,
    options: [
      { value: "create", label: "Create new configuration", hint: "Configure new provider and model" },
      { value: "switch", label: "Switch configuration", hint: "Switch between existing configurations" },
      { value: "list", label: "View all configurations", hint: "List all saved configurations" },
      { value: "delete", label: "Delete configuration", hint: "Delete unwanted configurations" },
      { value: "export", label: "Export configurations", hint: "Export configurations to file" },
      { value: "import", label: "Import configurations", hint: "Import configurations from file" },
      { value: "providers", label: "View supported providers", hint: "List all preset providers" },
      { value: "exit", label: "Exit" },
    ],
  });

  if (p.isCancel(action)) {
    return "exit";
  }

  return action as string;
}

/**
 * Create new configuration
 */
export async function createProfile(): Promise<void> {
  const group = await p.group(
    {
      profileName: () =>
        p.text({
          message: "Configuration name",
          placeholder: "my-config",
          validate: (value) => {
            if (!value) return "Configuration name cannot be empty";
            if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
              return "Can only contain letters, numbers, underscores and hyphens";
            }
          },
        }),

      provider: () =>
        p.select({
          message: "Select provider",
          options: allPresets.map((preset) => ({
            value: preset.id,
            label: preset.displayName,
            hint: preset.isChinese ? "🇨🇳" : "🌐",
          })),
        }),

      baseURL: ({ results }) => {
        const preset = getPresetById(results.provider as string);
        if (preset?.id === "custom") {
          return p.text({
            message: "API Base URL",
            placeholder: "https://api.example.com/v1",
            validate: (value) => {
              if (!value) return "URL cannot be empty";
              try {
                new URL(value);
              } catch {
                return "Please enter a valid URL";
              }
            },
          });
        } else {
          // Preset provider shows default baseURL, allows user to override
          return p.text({
            message: "API Base URL (leave empty to use default)",
            placeholder: preset?.baseURL || "",
            defaultValue: "",
          });
        }
      },

      apiKey: () =>
        p.password({
          message: "API Key",
          validate: (value) => {
            if (!value) return "API Key cannot be empty";
          },
        }),

      confirm: ({ results }) => {
        const preset = getPresetById(results.provider as string);
        return p.confirm({
          message: `Confirm creating configuration "${results.profileName}"?`,
          initialValue: true,
        });
      },
    },
    {
      onCancel: () => {
        p.cancel("Operation cancelled");
        process.exit(0);
      },
    }
  );

  if (!group.confirm) {
    p.cancel("Configuration creation cancelled");
    return;
  }

  const s = p.spinner();
  s.start("Saving configuration...");

  try {
    const preset = getPresetById(group.provider);
    // Use user-provided baseURL, or fall back to preset baseURL if empty
    const finalBaseURL = group.baseURL || preset?.baseURL;

    const profile: ClaudeCodeProfile = {
      name: group.profileName,
      providerId: group.provider,
      apiKey: group.apiKey,
      baseURL: finalBaseURL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(profile);
    await setActiveProfile(profile.name);

    s.stop("Configuration created successfully!");
    p.note(
      `Configuration name: ${pc.cyan(profile.name)}\nProvider: ${pc.green(preset?.displayName)}\nBase URL: ${pc.yellow(finalBaseURL || "default")}`,
      "New configuration details"
    );
  } catch (error) {
    s.stop("Save failed");
    p.log.error(`Error: ${error}`);
  }
}

/**
 * Switch configuration
 */
export async function switchProfile(): Promise<void> {
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    p.log.warn("No available configurations, please create one first");
    return;
  }

  const current = await getActiveProfile();

  const selected = await p.select({
    message: "Select configuration to switch to",
    options: profiles.map((profile) => {
      const preset = getPresetById(profile.providerId);
      const isCurrent = current?.name === profile.name;
      return {
        value: profile.name,
        label: isCurrent ? `${profile.name} ${pc.green("(current)")}` : profile.name,
        hint: `${preset?.displayName}`,
      };
    }),
  });

  if (p.isCancel(selected)) {
    p.cancel("Operation cancelled");
    return;
  }

  const s = p.spinner();
  s.start("Switching configuration...");

  try {
    await setActiveProfile(selected as string);
    s.stop("Switch successful!");
    p.log.success(`Switched to: ${pc.cyan(selected)}`);
  } catch (error) {
    s.stop("Switch failed");
    p.log.error(`Error: ${error}`);
  }
}

/**
 * List all configurations
 */
export async function showProfiles(): Promise<void> {
  const profiles = await listProfiles();
  const current = await getActiveProfile();

  if (profiles.length === 0) {
    p.log.warn("No configurations yet");
    return;
  }

  const lines = profiles.map((profile) => {
    const preset = getPresetById(profile.providerId);
    const isCurrent = current?.name === profile.name;
    const marker = isCurrent ? pc.green("●") : pc.dim("○");
    const baseUrl = profile.baseURL || preset?.baseURL || "default";
    return `${marker} ${pc.cyan(profile.name.padEnd(20))} ${pc.dim("|")} ${preset?.displayName.padEnd(25)} ${pc.dim("|")} ${pc.yellow(baseUrl)}`;
  });

  p.note(lines.join("\n"), `Configuration list (${profiles.length} total)`);
}

/**
 * Delete configuration
 */
export async function removeProfile(): Promise<void> {
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    p.log.warn("No configurations to delete");
    return;
  }

  const selected = await p.select({
    message: "Select configuration to delete",
    options: profiles.map((profile) => ({
      value: profile.name,
      label: profile.name,
      hint: getPresetById(profile.providerId)?.displayName,
    })),
  });

  if (p.isCancel(selected)) {
    p.cancel("Operation cancelled");
    return;
  }

  const confirm = await p.confirm({
    message: `Confirm deleting configuration "${selected}"?`,
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Deletion cancelled");
    return;
  }

  const s = p.spinner();
  s.start("Deleting configuration...");

  try {
    await deleteProfile(selected as string);
    s.stop("Deletion successful!");
    p.log.success(`Configuration deleted: ${pc.cyan(selected)}`);
  } catch (error) {
    s.stop("Deletion failed");
    p.log.error(`Error: ${error}`);
  }
}

/**
 * Export configurations
 */
export async function exportProfiles(): Promise<void> {
  const group = await p.group(
    {
      filePath: () =>
        p.text({
          message: "Export file path",
          placeholder: "./swixter-config.json",
          defaultValue: "./swixter-config.json",
        }),

      sanitize: () =>
        p.confirm({
          message: "Sanitize API Keys?",
          initialValue: true,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Operation cancelled");
      },
    }
  );

  if (p.isCancel(group.filePath)) {
    return;
  }

  const s = p.spinner();
  s.start("Exporting configurations...");

  try {
    await exportConfig(group.filePath, {
      sanitizeKeys: group.sanitize,
    });
    s.stop("Export successful!");
    p.log.success(`Configurations exported to: ${pc.cyan(group.filePath)}`);
  } catch (error) {
    s.stop("Export failed");
    p.log.error(`Error: ${error}`);
  }
}

/**
 * Import configurations
 */
export async function importProfiles(): Promise<void> {
  const group = await p.group(
    {
      filePath: () =>
        p.text({
          message: "Import file path",
          placeholder: "./swixter-config.json",
          validate: (value) => {
            if (!value) return "File path cannot be empty";
          },
        }),

      overwrite: () =>
        p.confirm({
          message: "Overwrite existing configurations with same name?",
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel("Operation cancelled");
      },
    }
  );

  if (p.isCancel(group.filePath)) {
    return;
  }

  const s = p.spinner();
  s.start("Importing configurations...");

  try {
    const result = await importConfig(group.filePath, {
      overwrite: group.overwrite,
    });

    s.stop("Import completed!");
    p.note(
      `Successfully imported: ${pc.green(result.imported)} items\nSkipped: ${pc.yellow(result.skipped)} items\nErrors: ${pc.red(result.errors.length)} items`,
      "Import results"
    );

    if (result.errors.length > 0) {
      p.log.error("Error details:\n" + result.errors.join("\n"));
    }
  } catch (error) {
    s.stop("Import failed");
    p.log.error(`Error: ${error}`);
  }
}

/**
 * Show all providers
 */
export async function showProviders(): Promise<void> {
  const international = allPresets.filter((p) => !p.isChinese && p.id !== "custom");
  const chinese = allPresets.filter((p) => p.isChinese);

  const intLines = international.map(
    (p) => `  ${pc.cyan(p.displayName.padEnd(30))} ${pc.dim(p.baseURL)}`
  );

  const cnLines = chinese.map(
    (p) => `  ${pc.cyan(p.displayName.padEnd(30))} ${pc.dim(p.baseURL)}`
  );

  console.log();
  p.note(intLines.join("\n"), pc.green("🌐 International Providers"));
  console.log();
  p.note(cnLines.join("\n"), pc.green("🇨🇳 Chinese Providers"));
  console.log();
}
