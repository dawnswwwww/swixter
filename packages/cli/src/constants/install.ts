/**
 * Installation method definitions for each supported coder CLI
 *
 * Defines platform-specific installation commands, recommended methods,
 * and post-install notes for Claude Code, Codex, and Qwen.
 */

/**
 * Supported platforms for installation methods
 */
export type InstallPlatform = "darwin" | "linux" | "win32";

/**
 * Shell type required to execute the install command
 */
export type InstallShell = "bash" | "powershell" | "cmd";

/**
 * A single installation method for a coder CLI
 */
export interface InstallMethod {
  /** Display label shown in the selection menu */
  label: string;
  /** The command to execute for installation */
  command: string;
  /** Platforms this method is available on */
  platforms: InstallPlatform[];
  /** Whether this is the recommended method for its platforms */
  recommended?: boolean;
  /** Shell type required (defaults to system default if not specified) */
  shell?: InstallShell;
  /** Additional note displayed alongside the method */
  note?: string;
}

/**
 * Installation configuration for a coder
 */
export interface CoderInstallConfig {
  /** Available installation methods */
  methods: InstallMethod[];
  /** Note displayed after successful installation */
  postInstallNote?: string;
}

/**
 * Installation configurations for all supported coders
 */
export const INSTALL_CONFIGS: Record<string, CoderInstallConfig> = {
  claude: {
    methods: [
      {
        label: "curl (Recommended)",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
        platforms: ["darwin", "linux"],
        recommended: true,
        shell: "bash",
      },
      {
        label: "Homebrew",
        command: "brew install --cask claude-code",
        platforms: ["darwin", "linux"],
        shell: "bash",
      },
      {
        label: "PowerShell (Recommended)",
        command: "irm https://claude.ai/install.ps1 | iex",
        platforms: ["win32"],
        recommended: true,
        shell: "powershell",
      },
      {
        label: "WinGet",
        command: "winget install Anthropic.ClaudeCode",
        platforms: ["win32"],
        shell: "cmd",
      },
      {
        label: "npm (Deprecated)",
        command: "npm install -g @anthropic-ai/claude-code",
        platforms: ["darwin", "linux", "win32"],
        note: "This method is deprecated, consider using another option",
      },
    ],
    postInstallNote: "Restart your terminal if the command is not found after installation.",
  },
  codex: {
    methods: [
      {
        label: "npm (Recommended)",
        command: "npm i -g @openai/codex",
        platforms: ["darwin", "linux", "win32"],
        recommended: true,
      },
    ],
    postInstallNote:
      "On Windows, it is recommended to use WSL2 for the best Codex experience. " +
      "See: https://github.com/openai/codex#windows",
  },
  qwen: {
    methods: [
      {
        label: "curl (Recommended)",
        command:
          "curl -fsSL https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.sh | bash",
        platforms: ["darwin", "linux"],
        recommended: true,
        shell: "bash",
      },
      {
        label: "Homebrew",
        command: "brew install qwen-code",
        platforms: ["darwin", "linux"],
        shell: "bash",
      },
      {
        label: "npm",
        command: "npm install -g @qwen-code/qwen-code@latest",
        platforms: ["darwin", "linux", "win32"],
      },
      {
        label: "Windows Installer (Run as Admin CMD)",
        command:
          'curl -fsSL -o %TEMP%\\install-qwen.bat https://qwen-code-assets.oss-cn-hangzhou.aliyuncs.com/installation/install-qwen.bat && %TEMP%\\install-qwen.bat',
        platforms: ["win32"],
        recommended: true,
        shell: "cmd",
        note: "Requires running as Administrator",
      },
    ],
    postInstallNote: "Restart your terminal after installation to ensure environment variables take effect.",
  },
} as const;

/**
 * Get installation config for a specific coder
 *
 * @param coderId - The coder identifier (e.g., "claude", "codex", "qwen")
 * @returns The installation config, or undefined if not found
 */
export function getInstallConfig(coderId: string): CoderInstallConfig | undefined {
  return INSTALL_CONFIGS[coderId];
}

/**
 * Update command mappings for installation methods
 *
 * Maps installation commands to their corresponding update commands.
 * If an installation method doesn't have a specific update command,
 * the original install command will be used (which typically handles updates).
 */
export const UPDATE_COMMANDS: Record<string, Record<string, string>> = {
  claude: {
    "brew install --cask claude-code": "brew upgrade --cask claude-code",
    "npm install -g @anthropic-ai/claude-code": "npm update -g @anthropic-ai/claude-code",
  },
  codex: {
    "npm i -g @openai/codex": "npm update -g @openai/codex",
  },
  qwen: {
    "brew install qwen-code": "brew upgrade qwen-code",
    "npm install -g @qwen-code/qwen-code@latest": "npm update -g @qwen-code/qwen-code",
  },
};
