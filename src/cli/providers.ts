#!/usr/bin/env bun
import * as p from "@clack/prompts";
import pc from "picocolors";
import { getAllPresets, getBuiltInPresets } from "../providers/presets.js";
import {
  upsertUserProvider,
  deleteUserProvider,
  getUserProvider,
  loadUserProviders,
} from "../providers/user-providers.js";
import type { ProviderPreset } from "../types.js";
import { showError, showSuccess } from "../utils/ui.js";
import { MARKERS } from "../constants/formatting.js";

/**
 * List all available providers
 */
export async function listProviders(): Promise<void> {
  console.log();
  p.intro(pc.cyan("Available Providers"));

  const allPresets = await getAllPresets();
  const userProviders = await loadUserProviders();
  const userProviderIds = new Set(userProviders.map(p => p.id));
  const builtInProviderIds = new Set(getBuiltInPresets().map(p => p.id));

  if (allPresets.length === 0) {
    console.log(pc.yellow("No providers configured"));
    console.log();
    return;
  }

  console.log();
  console.log(pc.bold("Built-in Providers:"));
  allPresets
    .filter(p => builtInProviderIds.has(p.id) && !userProviderIds.has(p.id))
    .forEach(preset => {
      console.log(
        `  ${pc.cyan(preset.id.padEnd(15))} ${pc.dim("|")} ${preset.displayName.padEnd(30)} ${pc.dim("|")} ${pc.yellow(preset.baseURL || "N/A")}`
      );
    });

  const userOnlyProviders = allPresets.filter(p => userProviderIds.has(p.id));
  if (userOnlyProviders.length > 0) {
    console.log();
    console.log(pc.bold("User-defined Providers:"));
    userOnlyProviders.forEach(preset => {
      const isOverride = builtInProviderIds.has(preset.id);
      const marker = isOverride ? pc.yellow(" (override)") : "";
      console.log(
        `  ${pc.green(preset.id.padEnd(15))} ${pc.dim("|")} ${preset.displayName.padEnd(30)} ${pc.dim("|")} ${pc.yellow(preset.baseURL || "N/A")}${marker}`
      );
    });
  }

  console.log();
  console.log(pc.dim(`Total: ${allPresets.length} providers`));
  console.log();
}

/**
 * Add or update a provider
 */
export async function addProvider(options: {
  id?: string;
  name?: string;
  displayName?: string;
  baseURL?: string;
  authType?: "api-key" | "bearer" | "custom";
  models?: string;
  quiet?: boolean;
}): Promise<void> {
  let providerId = options.id;
  let name = options.name;
  let displayName = options.displayName;
  let baseURL = options.baseURL;
  let authType = options.authType;
  let models = options.models;

  // Interactive mode if not quiet
  if (!options.quiet) {
    console.log();
    p.intro(pc.cyan("Add Custom Provider"));

    const existing = providerId ? await getUserProvider(providerId) : undefined;

    providerId = (await p.text({
      message: "Provider ID (unique identifier, e.g., 'openrouter', 'deepseek')",
      placeholder: existing?.id || "my-provider",
      initialValue: existing?.id,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Provider ID cannot be empty";
        }
        if (!/^[a-z0-9-]+$/.test(value)) {
          return "Provider ID can only contain lowercase letters, numbers, and hyphens";
        }
      },
    })) as string;

    if (p.isCancel(providerId)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    // Load existing if updating
    const existingProvider = await getUserProvider(providerId);

    name = (await p.text({
      message: "Provider name",
      placeholder: existingProvider?.name || "My Provider",
      initialValue: existingProvider?.name,
    })) as string;

    if (p.isCancel(name)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    displayName = (await p.text({
      message: "Display name (shown in UI)",
      placeholder: existingProvider?.displayName || name,
      initialValue: existingProvider?.displayName || name,
    })) as string;

    if (p.isCancel(displayName)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    baseURL = (await p.text({
      message: "Base URL (API endpoint)",
      placeholder: existingProvider?.baseURL || "https://api.example.com/v1",
      initialValue: existingProvider?.baseURL,
      validate: (value) => {
        if (!value || value.trim().length === 0) {
          return "Base URL cannot be empty";
        }
        try {
          new URL(value);
        } catch {
          return "Invalid URL format";
        }
      },
    })) as string;

    if (p.isCancel(baseURL)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    authType = (await p.select({
      message: "Authentication type",
      options: [
        { value: "api-key", label: "API Key (X-API-Key header)" },
        { value: "bearer", label: "Bearer Token (Authorization: Bearer)" },
        { value: "custom", label: "Custom (no authentication or custom headers)" },
      ],
      initialValue: existingProvider?.authType || "bearer",
    })) as "api-key" | "bearer" | "custom";

    if (p.isCancel(authType)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    models = (await p.text({
      message: "Default models (comma-separated, optional)",
      placeholder: existingProvider?.defaultModels?.join(", ") || "model-1, model-2",
      initialValue: existingProvider?.defaultModels?.join(", "),
    })) as string;

    if (p.isCancel(models)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  // Validate required fields
  if (!providerId || !name || !displayName || !baseURL || !authType) {
    showError(
      "Error: Missing required fields",
      "Usage: swixter providers add --id <id> --name <name> --display-name <display> --base-url <url> --auth-type <type>"
    );
  }

  const provider: ProviderPreset = {
    id: providerId,
    name: name,
    displayName: displayName,
    baseURL: baseURL,
    authType: authType,
    defaultModels: models ? models.split(",").map(m => m.trim()).filter(Boolean) : [],
    docs: "",
  };

  try {
    await upsertUserProvider(provider);

    if (!options.quiet) {
      p.outro(pc.green(`${MARKERS.success} Provider "${providerId}" added successfully!`));
    } else {
      showSuccess(`Provider "${providerId}" added successfully!`, {
        ID: providerId,
        "Display Name": displayName,
        "Base URL": baseURL,
        "Auth Type": authType,
      });
    }
  } catch (error) {
    showError(`Failed to add provider: ${error}`);
  }
}

/**
 * Remove a provider
 */
export async function removeProvider(providerId?: string, options?: { quiet?: boolean }): Promise<void> {
  if (!providerId) {
    if (options?.quiet) {
      showError("Error: Provider ID is required", "Usage: swixter providers remove <provider-id>");
    }

    // Interactive mode - show list and let user select
    console.log();
    p.intro(pc.cyan("Remove Custom Provider"));

    const userProviders = await loadUserProviders();

    if (userProviders.length === 0) {
      p.outro(pc.yellow("No user-defined providers to remove"));
      return;
    }

    providerId = (await p.select({
      message: "Select provider to remove",
      options: userProviders.map(p => ({
        value: p.id,
        label: `${p.displayName} (${p.id})`,
      })),
    })) as string;

    if (p.isCancel(providerId)) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }

    const confirmed = await p.confirm({
      message: `Are you sure you want to remove provider "${providerId}"?`,
    });

    if (p.isCancel(confirmed) || !confirmed) {
      p.cancel("Operation cancelled");
      process.exit(0);
    }
  }

  const deleted = await deleteUserProvider(providerId);

  if (!deleted) {
    showError(`Error: Provider "${providerId}" not found`, "Use 'swixter providers list' to see all providers");
  }

  if (!options?.quiet) {
    p.outro(pc.green(`${MARKERS.success} Provider "${providerId}" removed successfully!`));
  } else {
    showSuccess(`Provider "${providerId}" removed successfully!`);
  }
}

/**
 * Show provider details
 */
export async function showProvider(providerId?: string): Promise<void> {
  if (!providerId) {
    showError("Error: Provider ID is required", "Usage: swixter providers show <provider-id>");
  }

  const provider = await getUserProvider(providerId);

  if (!provider) {
    showError(`Error: Provider "${providerId}" not found`, "Use 'swixter providers list' to see all providers");
  }

  console.log();
  p.intro(pc.cyan(`Provider: ${provider.displayName}`));
  console.log();
  console.log(`  ID: ${pc.cyan(provider.id)}`);
  console.log(`  Name: ${pc.yellow(provider.name)}`);
  console.log(`  Display Name: ${pc.yellow(provider.displayName)}`);
  console.log(`  Base URL: ${pc.yellow(provider.baseURL)}`);
  console.log(`  Auth Type: ${pc.yellow(provider.authType)}`);
  if (provider.defaultModels && provider.defaultModels.length > 0) {
    console.log(`  Default Models:`);
    provider.defaultModels.forEach(model => console.log(`    - ${pc.dim(model)}`));
  }
  if (provider.docs) {
    console.log(`  Documentation: ${pc.blue(provider.docs)}`);
  }
  console.log();
}
