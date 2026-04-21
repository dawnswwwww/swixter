import pc from "picocolors";
import * as p from "@clack/prompts";
import {
  createGroup,
  listGroups,
  getGroup,
  updateGroup,
  deleteGroup,
  setDefaultGroup,
} from "../groups/manager.js";
import { listProfiles, getProfile } from "../config/manager.js";
import { getPresetByIdAsync } from "../providers/presets.js";
import { ERRORS } from "../constants/messages.js";
import { EXIT_CODES } from "../constants/formatting.js";
import { ProfileValidators } from "../utils/validation.js";

function cancelAndExit(): never {
  p.cancel(ERRORS.cancelled);
  process.exit(EXIT_CODES.cancelled);
}

function exitWithError(message: string, exitCode: number = EXIT_CODES.generalError): never {
  console.log(pc.red(message));
  process.exit(exitCode);
}

async function getExistingGroupNameSet(): Promise<Set<string>> {
  const groups = await listGroups();
  return new Set(groups.map((group) => group.name));
}

async function normalizeAndValidateProfiles(profileNames: string[]): Promise<string[]> {
  const normalized = profileNames.map((name) => name.trim()).filter(Boolean);

  if (normalized.length === 0) {
    throw new Error("At least one profile is required");
  }

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of normalized) {
    if (seen.has(name)) {
      duplicates.add(name);
    }
    seen.add(name);
  }

  if (duplicates.size > 0) {
    throw new Error(`Duplicate profiles are not allowed: ${Array.from(duplicates).join(", ")}`);
  }

  const missing: string[] = [];
  for (const name of normalized) {
    const profile = await getProfile(name);
    if (!profile) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Unknown profiles: ${missing.join(", ")}`);
  }

  return normalized;
}

async function validateGroupNameOrExit(name: string, currentGroupName?: string): Promise<string> {
  const trimmed = name.trim();
  const validationError = ProfileValidators.name(trimmed);
  if (validationError) {
    exitWithError(validationError, EXIT_CODES.invalidArgument);
  }

  const existingNames = await getExistingGroupNameSet();
  if (trimmed !== currentGroupName && existingNames.has(trimmed)) {
    exitWithError(`Group "${trimmed}" already exists`, EXIT_CODES.invalidArgument);
  }

  return trimmed;
}

export async function handleGroupCommand(args: string[]): Promise<void> {
  const subcommand = args[0];

  switch (subcommand) {
    case "list":
    case "ls":
      await cmdList();
      break;
    case "create":
    case "new":
      await cmdCreate(args.slice(1));
      break;
    case "edit":
    case "update":
      await cmdEdit(args.slice(1));
      break;
    case "delete":
    case "rm":
      await cmdDelete(args.slice(1));
      break;
    case "set-default":
      await cmdSetDefault(args.slice(1));
      break;
    case "show":
    case "info":
      await cmdShow(args.slice(1));
      break;
    default:
      console.log(pc.red(`Unknown subcommand: ${subcommand}`));
      console.log(groupHelp());
      process.exit(EXIT_CODES.invalidArgument);
  }
}

async function cmdList(): Promise<void> {
  const groups = await listGroups();

  if (groups.length === 0) {
    console.log(pc.yellow("No groups defined. Create one with: swixter group create"));
    return;
  }

  console.log();
  console.log(pc.bold("Groups:"));
  console.log();

  for (const group of groups) {
    const marker = group.isDefault ? pc.green("✓") : " ";
    const name = group.isDefault ? pc.green(group.name) : pc.cyan(group.name);
    console.log(`  ${marker} ${name} - ${group.profiles.length} profiles`);
  }
  console.log();
}

async function cmdCreate(args: string[]): Promise<void> {
  let profiles: string[] = [];
  let name = "";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--profiles" && args[i + 1] !== undefined) {
      profiles = args[i + 1].split(",");
      i++;
    } else if (args[i] === "--name" && args[i + 1] !== undefined) {
      name = args[i + 1];
      i++;
    } else if (!name && !args[i].startsWith("--")) {
      name = args[i];
    }
  }

  if (!name) {
    const result = await p.text({
      message: "Group name:",
      validate: (value) => ProfileValidators.name(value.trim()),
    });

    if (p.isCancel(result)) {
      cancelAndExit();
    }

    name = result as string;
  }

  name = await validateGroupNameOrExit(name);

  if (profiles.length === 0) {
    profiles = await promptForProfiles();
  } else {
    try {
      profiles = await normalizeAndValidateProfiles(profiles);
    } catch (error) {
      exitWithError(error instanceof Error ? error.message : String(error), EXIT_CODES.invalidArgument);
    }
  }

  const group = await createGroup({ name, profiles });

  console.log();
  console.log(pc.green(`✓ Group "${group.name}" created`));
  console.log(pc.dim(`  ID: ${group.id}`));
  console.log(pc.dim(`  Profiles: ${group.profiles.join(", ")}`));
  console.log();
}

async function promptForProfiles(initialSelectedProfiles: string[] = []): Promise<string[]> {
  const availableProfiles = await listProfiles();

  if (availableProfiles.length === 0) {
    exitWithError("No profiles available. Create a profile first.", EXIT_CODES.notFound);
  }

  const availableProfileNames = new Set(availableProfiles.map((profile) => profile.name));
  const validInitialSelectedProfiles = initialSelectedProfiles.filter((profileName) => availableProfileNames.has(profileName));

  const selections = await Promise.all(
    availableProfiles.map(async (profile) => {
      const preset = await getPresetByIdAsync(profile.providerId);
      const hint = preset?.displayName || profile.providerId;
      return {
        value: profile.name,
        label: profile.name,
        hint,
      };
    })
  );

  const selected = await p.multiselect({
    message: "Select profiles for this group:",
    options: selections,
    initialValues: validInitialSelectedProfiles,
    required: true,
  });

  if (p.isCancel(selected)) {
    cancelAndExit();
  }

  let selectedProfiles: string[];
  try {
    selectedProfiles = await normalizeAndValidateProfiles(selected as string[]);
  } catch (error) {
    exitWithError(error instanceof Error ? error.message : String(error));
  }

  if (selectedProfiles.length === 1) {
    return selectedProfiles;
  }

  console.log();
  console.log(pc.dim("Set failover priority. Priority 1 is tried first."));

  return await promptForProfileOrder(selectedProfiles);
}

async function promptForProfileOrder(selectedProfiles: string[]): Promise<string[]> {
  const ordered: string[] = [];
  const remaining = [...selectedProfiles];

  for (let i = 0; i < selectedProfiles.length; i++) {
    const selected = await p.select({
      message: i === 0 ? "Select priority 1 (tried first):" : `Select priority ${i + 1}:`,
      options: await Promise.all(
        remaining.map(async (profileName) => {
          const profile = await getProfile(profileName);
          const preset = profile ? await getPresetByIdAsync(profile.providerId) : null;
          return {
            value: profileName,
            label: profileName,
            hint: preset?.displayName || profile?.providerId || "Unknown provider",
          };
        })
      ),
    });

    if (p.isCancel(selected)) {
      cancelAndExit();
    }

    const profileName = selected as string;
    ordered.push(profileName);
    remaining.splice(remaining.indexOf(profileName), 1);
  }

  return ordered;
}

async function cmdEdit(args: string[]): Promise<void> {
  let targetName = "";
  let newName: string | undefined;
  let profiles: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--name" && args[i + 1] !== undefined) {
      newName = args[i + 1];
      i++;
    } else if (args[i] === "--profiles" && args[i + 1] !== undefined) {
      profiles = args[i + 1].split(",");
      i++;
    } else if (!targetName && !args[i].startsWith("--")) {
      targetName = args[i];
    }
  }

  if (!targetName) {
    const groups = await listGroups();

    if (groups.length === 0) {
      exitWithError("No groups available to edit", EXIT_CODES.notFound);
    }

    const selected = await p.select({
      message: "Select a group to edit:",
      options: groups.map((group) => ({
        value: group.name,
        label: group.name,
        hint: `${group.profiles.length} profiles${group.isDefault ? ", default" : ""}`,
      })),
    });

    if (p.isCancel(selected)) {
      cancelAndExit();
    }

    targetName = selected as string;
  }

  const group = await getGroup(targetName);
  if (!group) {
    exitWithError(`Group not found: ${targetName}`, EXIT_CODES.notFound);
  }

  if (newName === undefined) {
    const nameResult = await p.text({
      message: "Group name:",
      placeholder: group.name,
      defaultValue: group.name,
      validate: (value) => ProfileValidators.name(value.trim()),
    });

    if (p.isCancel(nameResult)) {
      cancelAndExit();
    }

    newName = nameResult as string;
  }

  newName = await validateGroupNameOrExit(newName, group.name);

  if (profiles === undefined) {
    const shouldUpdateProfiles = await p.confirm({
      message: "Do you want to update profiles?",
      initialValue: false,
    });

    if (p.isCancel(shouldUpdateProfiles)) {
      cancelAndExit();
    }

    if (shouldUpdateProfiles) {
      profiles = await promptForProfiles(group.profiles);
    }
  } else {
    try {
      profiles = await normalizeAndValidateProfiles(profiles);
    } catch (error) {
      exitWithError(error instanceof Error ? error.message : String(error), EXIT_CODES.invalidArgument);
    }
  }

  const updated = await updateGroup(group.id, {
    name: newName,
    ...(profiles !== undefined ? { profiles } : {}),
  });

  if (!updated) {
    exitWithError(`Failed to update group: ${group.name}`);
  }

  console.log();
  console.log(pc.green(`✓ Group "${updated.name}" updated`));
  console.log(pc.dim(`  ID: ${updated.id}`));
  console.log(pc.dim(`  Profiles: ${updated.profiles.join(", ")}`));
  console.log();
}

async function cmdDelete(args: string[]): Promise<void> {
  const name = args.find(a => !a.startsWith("--")) || "";
  const force = args.includes("--force") || args.includes("-f");

  if (!name) {
    exitWithError("Group name required", EXIT_CODES.invalidArgument);
  }

  const group = await getGroup(name);
  if (!group) {
    exitWithError(`Group not found: ${name}`, EXIT_CODES.notFound);
  }

  let confirmed = force;

  if (!force) {
    const confirmation = await p.confirm({
      message: `Delete group "${group.name}"?`,
      initialValue: false,
    });

    if (p.isCancel(confirmation)) {
      cancelAndExit();
    }

    confirmed = confirmation;
  }

  if (confirmed) {
    await deleteGroup(group.id);
    console.log(pc.green(`✓ Group "${group.name}" deleted`));
  }
}

async function cmdSetDefault(args: string[]): Promise<void> {
  const name = args.find(a => !a.startsWith("--")) || "";

  if (!name) {
    exitWithError("Group name required", EXIT_CODES.invalidArgument);
  }

  const group = await setDefaultGroup(name);
  if (group) {
    console.log(pc.green(`✓ "${group.name}" is now the default group`));
  } else {
    exitWithError(`Group not found: ${name}`, EXIT_CODES.notFound);
  }
}

async function cmdShow(args: string[]): Promise<void> {
  const name = args.find(a => !a.startsWith("--")) || "";

  if (!name) {
    exitWithError("Group name required", EXIT_CODES.invalidArgument);
  }

  const group = await getGroup(name);
  if (!group) {
    exitWithError(`Group not found: ${name}`, EXIT_CODES.notFound);
  }

  console.log();
  console.log(pc.bold("Group: ") + pc.cyan(group.name));
  console.log(pc.bold("ID: ") + group.id);
  console.log(pc.bold("Default: ") + (group.isDefault ? pc.green("yes") : pc.dim("no")));
  console.log(pc.bold("Profiles:"));
  group.profiles.forEach((p, i) => {
    console.log(pc.dim(`  ${i + 1}. ${p}`));
  });
  console.log();
}

function groupHelp(): string {
  return `
${pc.bold("Swixter Group Commands")}

${pc.bold("Usage:")}
  ${pc.green("swixter group <command> [options]")}

${pc.bold("Commands:")}
  ${pc.cyan("list, ls")}           List all groups
  ${pc.cyan("create, new")}         Create a new group
  ${pc.cyan("edit")}               Edit a group
  ${pc.cyan("delete, rm")}         Delete a group
  ${pc.cyan("set-default")}         Set default group
  ${pc.cyan("show, info")}         Show group details

${pc.bold("Examples:")}
  ${pc.green("swixter group list")}
  ${pc.green("swixter group create my-group --profiles profile-a,profile-b")}
  ${pc.green("swixter group set-default my-group")}
`;
}
