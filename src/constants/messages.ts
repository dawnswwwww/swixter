/**
 * UI Text Configuration
 * Centralized management of all user interface text messages
 */

/**
 * Error messages
 */
export const ERRORS = {
  missingProfileName: "Error: Please specify profile name",
  profileNotFound: (name: string) => `Error: Profile "${name}" not found`,
  unknownProvider: (id: string) => `Error: Unknown provider ID: ${id}`,
  missingRequiredArg: (arg: string) => `Error: Missing required argument --${arg}`,
  unknownCommand: (cmd: string) => `Unknown command: ${cmd}`,
  cancelled: "Cancelled",
  noActiveProfile: "No active profile",
  createFailed: (error: unknown) => `Failed to create: ${error}`,
  switchFailed: (error: unknown) => `Failed to switch: ${error}`,
  deleteFailed: (error: unknown) => `Failed to delete: ${error}`,
  applyFailed: (error: unknown) => `Failed to apply: ${error}`,
  updateFailed: (error: unknown) => `Failed to update: ${error}`,
  exportFailed: (error: unknown) => `Failed to export: ${error}`,
  importFailed: (error: unknown) => `Failed to import: ${error}`,
} as const;

/**
 * Success messages
 */
export const SUCCESS = {
  profileCreated: "Profile created successfully!",
  profileSwitched: "Switched successfully!",
  profileDeleted: "Deleted successfully!",
  profileApplied: "Profile applied successfully!",
  profileUpdated: "Profile updated successfully!",
  configExported: "Configuration exported successfully!",
  configImported: "Configuration imported successfully!",
} as const;

/**
 * Prompt texts
 */
export const PROMPTS = {
  configName: "Profile name",
  selectProvider: "Select API provider",
  apiKey: "API Key (for ANTHROPIC_API_KEY, optional)",
  apiKeyRequired: "API Key",
  apiKeyOllama: "API Key (optional, not required for Ollama)",
  authToken: "Auth Token (for ANTHROPIC_AUTH_TOKEN, optional)",
  baseUrl: "Base URL (optional, leave empty for default)",
  confirmApply: (app: string) => `Apply this configuration to ${app} now?`,
  selectToSwitch: "Select profile to switch to",
  selectToEdit: "Select profile to edit",
  selectToDelete: "Select profile to delete",
  confirmDelete: (name: string) => `Are you sure you want to delete profile "${name}"?`,
  changeProvider: (current: string) => `Change provider? Current: ${current}`,
  selectMainAction: "Select an action",
  createProfile: (app: string) => `Create ${app} Configuration Profile`,
} as const;

/**
 * Validation error messages
 */
export const VALIDATION = {
  nameRequired: "Profile name cannot be empty",
  nameTooShort: (min: number) => `Profile name must be at least ${min} characters`,
  nameInvalidChars: "Can only contain letters, numbers, underscores and hyphens",
  apiKeyRequired: "API Key cannot be empty",
  invalidUrl: "Invalid URL format",
} as const;

/**
 * Help and usage instructions
 */
export const USAGE = {
  main: (command: string) => `Usage: swixter ${command} <command> [options]`,
  create: (command: string) => `Usage: swixter ${command} create --quiet --name <name> --provider <id> [--api-key <key>] [--auth-token <token>] [--base-url <url>] [--apply]`,
  createProfile: (command: string) => `Usage: swixter ${command} create [options]`,
  switch: (command: string) => `Usage: swixter ${command} switch <name>`,
  delete: (command: string) => `Usage: swixter ${command} delete <name>`,
  checkHelp: (command: string) => `Run 'swixter ${command} --help' for help`,
  listProviders: "Run 'swixter providers' to see all supported providers",
  listProfiles: (command: string) => `Run 'swixter ${command} list' to see all profiles`,
  createFirst: (command: string) => `Run 'swixter ${command} create' to create a profile`,
  applyTip: (command: string) => `Tip: Run 'swixter ${command} apply' to apply configuration to ${command}`,
} as const;

/**
 * Information messages
 */
export const INFO = {
  noProfiles: "No profiles yet",
  applying: (path: string) => `Applying configuration to ${path}...`,
  verifying: "Verifying configuration...",
  verifyFailed: "⚠  Configuration written but verification failed",
  checkConfig: "Please check configuration file format",
  totalProfiles: (count: number) => `Total: ${count} profile${count !== 1 ? 's' : ''}`,
  currentActive: (name: string) => `Currently active: ${name}`,
  using: (name: string, provider: string) => `Using profile: ${name} (${provider})`,
  goodbye: "Goodbye!",
  exporting: (path: string) => `Exporting configuration to ${path}...`,
  importing: (path: string) => `Importing configuration from ${path}...`,
} as const;

/**
 * Placeholder texts
 */
export const PLACEHOLDERS = {
  configName: "my-config",
  configNameClaude: "my-claude-config",
  configNameQwen: "my-qwen-config",
  apiKeyExample: "sk-ant-...",
  apiKeyExampleGeneric: "Enter your API Key",
  baseUrlExample: "https://api.example.com",
  baseUrlOrDefault: (defaultUrl: string) => defaultUrl || "default",
  emptyForDefault: "leave empty",
  noApiKey: "none",
  noAuthToken: "No API Key (Ollama)",
} as const;

/**
 * Menu option labels
 */
export const MENU = {
  createProfile: "Create new profile",
  listProfiles: "List all profiles",
  switchProfile: "Switch profile",
  editProfile: "Edit profile",
  applyProfile: "Apply profile",
  currentProfile: "Show current profile",
  deleteProfile: "Delete profile",
  exit: "Exit",
} as const;

/**
 * Menu option hints
 */
export const MENU_HINTS = {
  createProfile: "Create profile interactively",
  listProfiles: "View existing profiles",
  switchProfile: "Switch to another profile",
  editProfile: "Modify existing profile",
  applyProfile: (app: string) => `Apply current profile to ${app}`,
  currentProfile: "View active profile",
  deleteProfile: "Delete specified profile",
  exit: "Exit program",
} as const;

/**
 * Display labels
 */
export const LABELS = {
  name: "Name",
  configName: "Profile Name",
  provider: "Provider",
  baseUrl: "Base URL",
  apiKey: "API Key",
  authToken: "Auth Token",
  configFile: "Config File",
  createdAt: "Created At",
  updatedAt: "Updated At",
} as const;

/**
 * Progress messages
 */
export const PROGRESS = {
  creating: "Creating profile...",
  updating: "Updating profile...",
  deleting: "Deleting profile...",
  applying: "Applying profile...",
  exporting: "Exporting configuration...",
  importing: "Importing configuration...",
} as const;
