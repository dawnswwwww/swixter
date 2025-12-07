# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

- **Current Version**: v0.0.2 (see CHANGELOG.md for details)
- **Stability**: Early release, actively developed
- **Platform Support**: Linux, macOS, Windows 10/11
- **Package Manager**: npm (published as `swixter`)

## Project Overview

Swixter is a CLI tool for managing configurations across multiple AI coding assistants. It allows users to easily switch between different AI providers (Anthropic, Ollama, custom) and manage API keys/configurations. Currently supports:
- **Claude Code** (Anthropic) - JSON config at `~/.claude/settings.json`
- **Codex** - TOML config at `~/.codex/config.toml` with env var support
- **Continue.dev** - YAML config at `~/.continue/config.yaml` (note: accessed via `swixter qwen` command for historical reasons, but targets Continue.dev VS Code extension, NOT Qwen Code CLI)

## Development Commands

```bash
# Build the CLI
bun run build

# Run CLI in development mode (with hot reload)
bun run cli:dev

# Run CLI directly (without build)
bun run cli

# Run all unit tests
bun test

# Run specific test file
bun test tests/adapters/codex.test.ts

# Run E2E tests (Docker-based, requires Docker running)
bun run test:e2e

# Test package contents before publishing
npm pack --dry-run

# Test CLI commands manually (after build)
node dist/cli/index.js claude list
node dist/cli/index.js providers list

# Release commands (automated versioning + publish)
bun run release:patch   # For bug fixes (0.0.1 -> 0.0.2)
bun run release:minor   # For new features (0.0.x -> 0.1.0)
bun run release:major   # For breaking changes (0.x.y -> 1.0.0)
```

## Architecture Overview

### Core Data Flow

1. **Configuration Storage** (`~/.config/swixter/config.json`)
   - Stores all profiles, active profile per coder, and metadata
   - Schema defined in `src/types.ts` (ConfigFile interface)
   - Managed through `src/config/manager.ts`

2. **Provider System** (Two-tier)
   - **Built-in providers**: Hardcoded in `src/providers/presets.ts` (Anthropic, Ollama, Custom)
   - **User-defined providers**: Stored in `~/.config/swixter/providers.json`, managed via `src/providers/user-providers.ts`
   - User providers can override built-in ones with same ID
   - Synchronous access (`getPresetById`) for built-in only, async (`getPresetByIdAsync`) for merged access

3. **Adapter Pattern** (`src/adapters/`)
   - Each AI coder tool has an adapter (Claude Code, Continue.dev)
   - Adapters handle reading/writing tool-specific config files
   - Base interface in `src/adapters/base.ts`

### Key Module Responsibilities

**CLI Layer** (`src/cli/`):
- `index.ts` - Main entry point, routes commands to handlers
- `claude.ts` / `qwen.ts` / `codex.ts` - Per-coder command handlers (create, switch, list, delete, apply, run)
- `providers.ts` - Provider management commands (add, remove, list, show)
- `help.ts` - Detailed help system with command documentation
- `completions.ts` - Shell completion generation (bash/zsh/fish)
- `commands/parsers.ts` - Unified argument parsing supporting long/short options

**Configuration Layer** (`src/config/`):
- `manager.ts` - CRUD operations on profiles, atomic file writes
- `export.ts` - Import/export with optional API key sanitization

**Constants** (`src/constants/`):
- Split into multiple files for organization (messages, formatting, defaults, etc.)
- All UI text centralized in `src/constants/messages.ts` for i18n

**Utilities** (`src/utils/`):
- `validation.ts` - Input validation (profile names, URLs, API keys)
- `ui.ts` - Shared UI functions (spinners, formatters, error display)

### Important Design Patterns

1. **Coder-agnostic design**: Most code works with any "coder" (claude/qwen/codex). Coder-specific logic is in adapters and constants/coders.ts.

2. **Profile = Configuration template**: A profile contains provider ID, API key, base URL, etc. Multiple profiles can exist; one is "active" per coder.

3. **Apply flow**: `switch` changes active profile in swixter config → `apply` writes active profile to coder's config file (e.g., `~/.claude/settings.json`)

4. **Validation timing**: Input validation happens at prompt time (immediate feedback) AND at save time (for non-interactive mode)

5. **Adapter-specific behaviors**:
   - **Claude adapter** (JSON): Full replacement of API-related env vars in settings.json. When applying a profile, only fields present in the profile are written; undefined fields are removed to prevent stale configuration. Other sections (MCP servers, approval policies, etc.) are preserved.
   - **Continue adapter** (YAML): Modifies config.yaml with model/apiKey fields
   - **Codex adapter** (TOML): Uses environment variable references (env_key) per official spec. Creates provider tables `[model_providers.swixter-<name>]` and profile tables `[profiles.swixter-<name>]`. API keys must be set as environment variables before running codex, or use `swixter codex run` for automatic setup.

6. **Provider wire_api field**: Codex only supports `wire_api: "chat"` providers (OpenAI-compatible). Anthropic uses `wire_api: "responses"` and is filtered out in Codex CLI flows.

7. **Special "run" command pattern**: Each coder's `run` command behaves differently based on requirements:
   - **Claude/Qwen**: Simple wrapper that spawns the coder CLI (e.g., `claude` or `qwen-code`)
   - **Codex**: All-in-one command that applies profile → sets env vars → spawns codex in single operation, because Codex requires environment variables to be set before execution

8. **Profile naming constraints**: Profile names must be alphanumeric with dashes/underscores only (validated in `src/utils/validation.ts`). No spaces, special chars, or starting with dash.

9. **Custom env_key per profile** (Codex only): Codex profiles can override the provider's default env_key.
   - **Priority**: `profile.envKey` > `preset.env_key` > `"OPENAI_API_KEY"` (fallback)
   - Set during profile creation or editing via `--env-key` parameter or interactive prompt
   - Empty/undefined means use provider preset default (e.g., `OLLAMA_API_KEY` for Ollama)
   - Used consistently across: `createProviderTable()`, `getEnvExportCommands()`, and `cmdRun()`
   - Allows flexibility for custom providers or non-standard environment setups

## Testing

- **Unit tests**: Use Bun's built-in test runner (`bun:test`)
  - Located in `tests/` directory, structure mirrors `src/`
  - Run individual tests: `bun test tests/adapters/claude.test.ts`
  - All constants used in validation must be testable (exported from constants/)

- **E2E tests**: Docker-based for isolated environment
  - Main script: `test/e2e-docker.sh`
  - Test scenarios in `test/scenarios/` (create, switch, apply, delete, etc.)
  - Requires Docker running; works on Linux/macOS/Windows (via Docker Desktop)
  - Builds project → builds Docker image → runs all scenario tests → cleanup

## Documentation

- **README.md**: User-facing documentation (installation, quick start, examples)
- **CHANGELOG.md**: Version history and release notes (follow Keep a Changelog format)
- **CLAUDE.md**: This file - developer guidance for Claude Code
- **docs/WINDOWS.md**: Comprehensive Windows compatibility guide (created in v0.0.2)

## Code Style Notes

- Use TypeScript with strict mode
- Prefer `async/await` over promises
- Use `@clack/prompts` for all interactive inputs (provides cancellation, validation)
- Error messages use `ERRORS` constants from `src/constants/messages.ts`
- Exit codes defined in `src/constants/formatting.ts` (EXIT_CODES)
- Cancellation: Use `p.cancel(ERRORS.cancelled)` + `process.exit(EXIT_CODES.userCancelled)`

## Configuration File Paths

**Platform-Specific Paths:**

| Platform | Swixter Config | User Providers | Claude Code | Codex | Continue.dev |
|----------|---------------|----------------|-------------|-------|--------------|
| **Linux/macOS** | `~/.config/swixter/config.json` | `~/.config/swixter/providers.json` | `~/.claude/settings.json` | `~/.codex/config.toml` | `~/.continue/config.yaml` |
| **Windows** | `~/swixter/config.json`<br/>(e.g., `C:\Users\name\swixter\config.json`) | `~/swixter/providers.json` | `~/.claude/settings.json`<br/>(e.g., `C:\Users\name\.claude\settings.json`) | `~/.codex/config.toml` | `~/.continue/config.yaml` |

**Platform Detection:** Implemented in `src/constants/paths.ts:getSwixterConfigDir()` using `os.platform()` check.

**Key Insight:** Only Swixter's own config path is platform-specific. All AI coder tools use `~/.tool-name` format which works cross-platform via Node.js `os.homedir()`.

## Windows Compatibility

**Current Status:** ~90% Windows compatible (v0.0.2+)

### Cross-Platform Design Principles

1. **Path Handling:**
   - ✅ Always use `os.homedir()` instead of `~`, `$HOME`, or `%USERPROFILE%`
   - ✅ Always use `path.join()` instead of string concatenation with `/` or `\`
   - ✅ Platform detection via `os.platform() === "win32"`
   - ✅ All adapters already follow these patterns

2. **File Operations:**
   - ✅ All adapters use `fs/promises` which works identically on Windows
   - ✅ TOML parsing (`smol-toml`) and YAML parsing (`js-yaml`) are pure JavaScript
   - ✅ No native dependencies that could cause Windows issues

3. **Configuration Paths:**
   - Swixter: Platform-specific (`~/.config/swixter` on Unix vs `~/swixter` on Windows)
   - AI Coders: Unified `~/.tool-name` works cross-platform via `os.homedir()`

### Windows-Specific Considerations

- **Config Location:** Windows uses `~/swixter/config.json` for simplicity and consistency with AI coder tools
- **E2E Tests:** Docker-based tests work on Windows via Docker Desktop + WSL2 (no code changes needed)
- **Shell Completions:** Bash/Zsh/Fish supported; PowerShell completion planned for v0.1.0
- **Build Script:** `chmod +x` in package.json is harmless on Windows (command not found is expected and safe to ignore)

### When Adding Windows-Sensitive Features

If you're adding features that touch file paths or system-specific behavior:

- [ ] Use `os.homedir()` instead of `~` or environment variables
- [ ] Use `path.join()` instead of template literals with `/`
- [ ] Use `path.sep` if you need to detect or use the path separator
- [ ] Test on Windows if modifying `src/constants/paths.ts` or adapters
- [ ] Update `docs/WINDOWS.md` if adding Windows-specific behavior

**For comprehensive Windows support details, see [docs/WINDOWS.md](docs/WINDOWS.md)**

## When Adding New Features

- **Adding a new coder**:
  1. Create adapter in `src/adapters/` implementing CoderAdapter interface (apply, verify, remove methods)
  2. Add entry to CODER_REGISTRY in `src/constants/coders.ts` with config paths, env var mappings, wire_api type
  3. Create CLI handler in `src/cli/<coder>.ts` (copy claude.ts or codex.ts as template)
  4. Export handler function in `src/cli/index.ts` and add routing logic
  5. Add completion support in `src/cli/completions.ts`
  6. Write unit tests in `tests/adapters/<coder>.test.ts`

- **Adding a new provider**: Users can add via CLI (`swixter providers add`), no code changes needed. Built-in providers go in `src/providers/presets.ts` with wire_api field.

- **Adding new commands**: Update `src/cli/help.ts` with detailed help, add to completions, add command aliases to `src/constants/commands.ts`

- **All user-facing text** must go into `src/constants/messages.ts` for i18n support

## Key Implementation Notes

1. **TOML handling (Codex)**: Use `smol-toml` for parsing/stringifying. Always backup corrupted configs before overwriting.

2. **Environment variables**: Codex adapter stores env_key references, not direct keys. The `getEnvExportCommands()` method generates shell export commands for users. The `run` command automates this by spawning codex with modified env.

3. **Provider filtering**: When creating Codex profiles, filter providers by `wire_api === "chat"` to exclude incompatible ones (like Anthropic's responses API).

4. **Profile naming**: Codex adapter prefixes all table names with `swixter-` to avoid conflicts with user's existing codex config.

5. **Config merging**: Adapters must preserve existing config (MCP servers, approval policies, etc.) when applying profiles - never overwrite the entire file.
