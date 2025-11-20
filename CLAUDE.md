# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Swixter is a CLI tool for managing configurations across multiple AI coding assistants. It allows users to easily switch between different AI providers (Anthropic, Ollama, custom) and manage API keys/configurations. Currently supports:
- **Claude Code** (Anthropic) - JSON config at `~/.claude/settings.json`
- **Codex** - TOML config at `~/.codex/config.toml` with env var support
- **Continue.dev/Qwen** - YAML config at `~/.continue/config.yaml`

## Development Commands

```bash
# Build the CLI
bun run build

# Run CLI in development mode (with hot reload)
bun run cli:dev

# Run CLI directly
bun run cli

# Run all unit tests
bun test

# Run specific test file
bun test tests/adapters/codex.test.ts

# Run E2E tests (Docker-based)
bun run test:e2e

# Test package contents before publishing
npm pack --dry-run

# Test CLI commands manually (after build)
node dist/cli/index.js claude list
node dist/cli/index.js providers list
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
   - **Claude adapter** (JSON): Direct key storage in settings.json with ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN
   - **Continue adapter** (YAML): Modifies config.yaml with model/apiKey fields
   - **Codex adapter** (TOML): Uses environment variable references (env_key) per official spec. Creates provider tables `[model_providers.swixter-<name>]` and profile tables `[profiles.swixter-<name>]`. API keys must be set as environment variables before running codex, or use `swixter codex run` for automatic setup.

6. **Provider wire_api field**: Codex only supports `wire_api: "chat"` providers (OpenAI-compatible). Anthropic uses `wire_api: "responses"` and is filtered out in Codex CLI flows.

## Testing

- Unit tests use Bun's built-in test runner (`bun:test`)
- E2E tests run in Docker to ensure clean environment
- Test structure mirrors src structure: `tests/` directory
- All constants used in validation must be testable (exported from constants/)

## Code Style Notes

- Use TypeScript with strict mode
- Prefer `async/await` over promises
- Use `@clack/prompts` for all interactive inputs (provides cancellation, validation)
- Error messages use `ERRORS` constants from `src/constants/messages.ts`
- Exit codes defined in `src/constants/formatting.ts` (EXIT_CODES)
- Cancellation: Use `p.cancel(ERRORS.cancelled)` + `process.exit(EXIT_CODES.userCancelled)`

## Configuration File Paths

- Main config: `~/.config/swixter/config.json`
- User providers: `~/.config/swixter/providers.json`
- Claude Code settings: `~/.claude/settings.json`
- Codex config: `~/.codex/config.toml`
- Continue.dev config: `~/.continue/config.yaml`

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
