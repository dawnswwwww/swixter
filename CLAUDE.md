# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Swixter is a CLI tool for managing Claude Code configurations across multiple AI providers. It allows users to easily switch between different providers (Anthropic, Ollama, custom) and manage API keys/configurations for AI coding assistants.

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

# Run E2E tests (Docker-based)
bun run test:e2e

# Test package contents before publishing
npm pack --dry-run
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
- `claude.ts` / `qwen.ts` - Per-coder command handlers (create, switch, list, delete, apply)
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

1. **Coder-agnostic design**: Most code works with any "coder" (claude/qwen). Coder-specific logic is in adapters and constants/coders.ts.

2. **Profile = Configuration template**: A profile contains provider ID, API key, base URL, etc. Multiple profiles can exist; one is "active" per coder.

3. **Apply flow**: `switch` changes active profile in swixter config → `apply` writes active profile to coder's config file (e.g., `~/.claude/settings.json`)

4. **Validation timing**: Input validation happens at prompt time (immediate feedback) AND at save time (for non-interactive mode)

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
- Continue.dev config: `~/.continue/config.json`

## When Adding New Features

- If adding a new coder: Create adapter in `src/adapters/`, add to `src/constants/coders.ts`, create CLI handler like `claude.ts`
- If adding new provider: Users can add via CLI (`swixter providers add`), no code changes needed
- If adding new commands: Update `src/cli/help.ts` with detailed help, add to completions, add command aliases to `src/constants/commands.ts`
- All user-facing text must go into `src/constants/messages.ts`
