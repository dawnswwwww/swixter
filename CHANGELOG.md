# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Cloud Sync** - End-to-end encrypted config sync across devices
  - `swixter auth register` / `login` / `logout` / `status` / `delete-account`
  - `swixter sync push` / `pull` / `status` / `enable` / `disable`
  - Magic link login (`swixter auth login --magic-link`)
  - Client-side encryption of API keys and sensitive fields using PBKDF2-derived keys
  - Version-based conflict detection with force-push / force-pull overrides
  - Auto-sync toggle for automatic push after config changes
- **Crypto Module** (`src/crypto/`) - Key derivation (PBKDF2), AES-GCM encryption, selective field encryption
- **Auth Module** (`src/auth/`) - Cloud authentication with token refresh and persistent sessions
- **Sync Module** (`src/sync/`) - Cloud sync client, three-way merge, conflict detection
- **Tests** - Unit tests for auth token, crypto derive/encrypt/fields, sync client and merge

## [0.1.1] - 2026-04-22

### Fixed
- **User-defined providers not showing in CLI** — Replaced synchronous `getPresetById()` with async `getPresetByIdAsync()` in list/switch/current/edit commands so user-added providers display correctly
- **Potential crash in profile switch** — Added null guard for profile lookup after switch instead of using non-null assertions
- **Unpredictable active profile after deletion** — Active profile is now cleared (not randomly reassigned) when the active profile is deleted
- **Deleting profile referenced in a group** — Deletion is now blocked with a clear error message listing the affected groups
- **Config file corruption on crash** — Config writes are now atomic (write to temp file + rename)
- **Deprecated API usage in interactive mode** — Replaced `setActiveProfile`/`getActiveProfile` with `setActiveProfileForCoder`/`getActiveProfileForCoder`
- **Circuit breaker state inconsistency** — `isOpen` is now kept in sync with `state` during half-open transitions
- **Command injection in browser open** — Replaced `exec()` with `execFile()` using array args to prevent shell injection
- **Shell deprecation warning on Unix** — `shell: true` now only used on Windows, avoiding Node.js DEP0190 warning on Unix
- **Build tooling migration** — Switched from npm to bun for UI build pipeline

## [0.1.0] - 2026-04-21

### Added
- **Proxy Gateway** - Full proxy server with circuit breaker, request forwarding, logging, and health checks
- **Group Management** - Batch profile operations via CLI (`swixter group`) and REST API
- **Real-time Web UI** - WebSocket-based live updates for proxy status and groups
  - Proxy status page with live request monitoring
  - Groups page with drag-and-drop reordering (dnd-kit)
- **Bun HTTP Server Enhancements** - Bun-native HTTP bridge, static file serving, WebSocket manager, event system
- **Model Helper Utilities** - Consistent model configuration handling across adapters
- **Comprehensive Test Suite** - Full coverage for proxy, server, and UI components

## [0.0.11] - 2026-03-30

### Fixed
- **`claude run --profile` model env vars not working** - Claude Code reads `~/.claude/settings.json` env vars on startup, overriding process-level env vars. Now uses `--settings` CLI flag with a temp file to override settings.json without modifying it, ensuring the profile's model, base URL, and auth token take effect for the current session only.

## [0.0.10] - 2026-03-30

### Added
- **Web UI** - Local HTTP server for browser-based configuration management
  - `swixter ui` command to launch Web UI (default port: 3141)
  - Auto-opens browser on supported platforms (macOS, Linux, Windows)
  - REST API for Profiles, Providers, Coders, and Config operations
  - API key masking in GET responses (shows first 4 and last 4 characters)
  - ETag-based config polling support for efficient cache validation
- **SPA Project Structure** - React + Vite foundation for Web UI
  - Located in `ui/` directory with independent package.json
  - shadcn/ui integration ready (requires manual installation)
  - Development mode: `npm run ui:dev` with API proxy
  - Build integration: `npm run build:all` includes UI assets
- **New Scripts**
  - `npm run build:ui` - Build SPA to `dist/ui/`
  - `npm run build:all` - Build both CLI and UI
  - `npm run ui:dev` - Start Vite dev server with API proxy

### Changed
- Updated `src/cli/index.ts` to route `ui` command
- Updated `src/cli/help.ts` to include UI command documentation
- Updated `src/constants/commands.ts` to add `ui` to GLOBAL_COMMANDS
- Updated `src/constants/messages.ts` with UI-related messages
- Updated `src/constants/paths.ts` AUTH path placeholder for future sync feature

### Technical
- **Server Infrastructure** (`src/server/`)
  - `index.ts` - Main server with port detection and browser launch
  - `router.ts` - Lightweight HTTP router with pattern matching
  - `middleware.ts` - CORS, JSON parsing, error handling
  - `static.ts` - Static file serving with SPA fallback
  - `api/` - REST API endpoints for all resources
- **Zero additional runtime dependencies** - Uses Node.js built-in `node:http`
- **API Endpoints**
  - `/api/profiles` - CRUD operations for profiles
  - `/api/providers` - CRUD operations for user providers
  - `/api/coders` - Coder status, active profile, apply, verify
  - `/api/version` - Version information
  - `/api/config` - Config metadata, export, import
- **Unit Tests**
  - `tests/server/router.test.ts` - 10 passing tests
  - `tests/server/util.test.ts` - 13 passing tests
- **Cross-platform browser launch** - Platform-specific commands (open/xdg-open/start)

### Fixed
- **`swixter claude run` not setting model environment variables** - `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL` were missing from spawned process env

### Changed
- **Unified env var construction** - Extracted `buildProfileEnv()` utility in `src/utils/model-helper.ts`
  - Replaces hardcoded env var logic in 3 CLI run commands (claude/codex/qwen) and Claude adapter (`apply`/`verify`)
  - Dynamically reads `envVarMapping` from coder config, so new fields are auto-supported
  - Supports `apiKeyEnvName` override for Codex custom env_key
- **Test coverage** - Added 17 unit tests for `buildProfileEnv` (total: 238 → 255)

## [0.0.9] - 2025-02-13

### Fixed
- **19 bug fixes and code quality improvements across the codebase**
  - Fixed `EXIT_CODES.userCancelled` → `EXIT_CODES.cancelled` (undefined property access, 28 occurrences)
  - Fixed `LABELS.profileList` missing constant
  - Fixed `MISC_DEFAULTS.baseUrl` → `MISC_DEFAULTS.baseUrlFallback` (undefined property access)
  - Fixed Codex apply hint showing "swixter claude create" instead of "swixter codex create"
  - Added `wire_api` and `env_key` fields to `ProviderPresetSchema` (were silently stripped from user providers)
  - Removed unimplemented `doctor` command from registry and help
  - Enabled `parseFlags()` from parsers.ts across all CLI handlers (short flags like `-k`, `-p` now work)
  - All adapters now use async `getPresetByIdAsync()` (user-defined providers were invisible)
  - Claude adapter `verify()` now handles credential-less profiles (e.g., Ollama)
  - Qwen profile name validation now uses shared `ProfileValidators.name`
  - Added `apiKey` null guard in `cmdCurrent()` to prevent crash on Ollama profiles
  - Claude adapter `apply()` now preserves non-Swixter env vars during merge
  - Fixed Codex adapter async issues in `createProviderTable`/`createProfileTable`
  - Added `process.exit()` after `showError()` in unknown command handlers
  - Removed `-p` semantic conflict in Codex `run` command (was stripping Codex's `-p` prompt flag)
  - Fixed Continue adapter `remove()` YAML formatting consistency

### Changed
- Removed duplicate `parseArgs()` functions from commands.ts and install-commands.ts
- Cleaned 30 unused imports across claude.ts, codex.ts, qwen.ts
- Removed `if (true)` dead code block in claude.ts
- Replaced hardcoded coder list with `Object.keys(CODER_REGISTRY)` in config manager

### Improved
- Updated README.md with missing commands, features, and aliases
- Updated CLAUDE.md with current architecture and design patterns
- Fixed CHANGELOG.md formatting issues and broken links
- Updated docs/WINDOWS.md version references

## [0.0.8] - 2025-02-11

### Fixed
- **Edit profile now includes all fields from create**
  - Claude edit: added model configuration (anthropicModel, defaultHaikuModel, defaultOpusModel, defaultSonnetModel)
  - Qwen edit: added model name editing
  - Previously these fields could only be set during creation, requiring delete & recreate to modify

## [0.0.7] - 2025-02-09

### Added
- **Install and Update Commands for All Coders**
  - `swixter <coder> install` - Interactive CLI installation with platform-specific methods
  - `swixter <coder> update-cli` / `upgrade` - Update CLI to latest version
  - Automatic installation detection and method inference
  - Support for curl, Homebrew, npm, WinGet, and custom installation methods
  - Platform-specific recommendations (curl for Unix, PowerShell for Windows)
  - Non-interactive mode with `--method` parameter
  - Reinstall confirmation when CLI already installed
- **Comprehensive Test Coverage**
  - New test file: `tests/utils/cli-version.test.ts` (19 tests, all passing)
  - New test file: `tests/utils/install.test.ts` (42 tests, all passing)
  - New E2E scenarios: install-detection, install-command, update-command (all passing)
  - Total: 215 unit tests + 11 E2E tests = 226 tests passing

### Changed
- **Code Refactoring: Eliminate Duplicate Install/Update Handlers**
  - Created `src/utils/install-commands.ts` with shared `handleInstallCommand()` and `handleUpdateCommand()`
  - Simplified claude.ts, codex.ts, qwen.ts: ~220 lines → ~20 lines per file
  - Removed ~660 lines of duplicate code across three coder files
  - Improved maintainability: single source of truth for install/update logic

### Improved
- **Version Detection with semver Library**
  - Migrated from custom regex parsing to industry-standard semver library
  - Support for pre-release versions (e.g., 1.0.0-alpha, 2.0.0-beta.1)
  - More robust version parsing and comparison
  - New `isValidVersion()` utility function
- **Update Command Fallback Logic**
  - Interactive mode: prompts user to select installation method when auto-detection fails
  - Non-interactive mode: uses recommended method with clear warning messages
  - Prevents incorrect update commands when installation method is ambiguous

### Technical
- Added `semver` as production dependency
- Created `src/constants/install.ts` with platform-specific installation configurations
- Enhanced `src/utils/install.ts` with installation method detection
- All tests passing (215 unit + 11 E2E)
- Fully backward compatible - no breaking changes

## [0.0.6] - 2025-12-10

### Added
- **Comprehensive Model Configuration Support for All Coders**
  - Configure model selection per profile for Claude Code, Qwen, and Codex
  - Claude Code: separate models for Sonnet, Opus, Haiku, and default
  - Codex and Qwen: configurable OpenAI-compatible model parameter
  - Environment variable mapping for model configuration
  - Interactive prompts during profile creation and editing

## [0.0.5] - 2025-12-07

### Added
- Initial stable release with multi-coder support
- Support for Claude Code, Codex, and Continue/Qwen
- Profile management (create, switch, list, delete, apply)
- Custom provider configuration
- Command aliases

## [0.0.4] - 2025-12-06

### Added
- **Interactive Apply Prompt for Switch Command**
  - After switching profiles, users are now prompted "Apply this profile now?" (default: true)
  - Consistent UX with `create` and `edit` commands which already had apply prompts
  - New flags for non-interactive mode:
    - `--apply`: Auto-apply without prompting
    - `--no-apply`: Skip prompt entirely
  - Applies to all three coders: Claude, Qwen (Continue), and Codex
  - Updated help documentation with flag usage examples

### Fixed
- **Windows Compatibility Issue in Run Commands**
  - Fixed "spawn ENOENT" error when running `swixter claude r` / `qwen r` / `codex r` on Windows
  - Added `shell: true` option to all `spawn()` calls for proper `.cmd`/`.bat`/`.exe` resolution
  - Affects `cmdRun()` in claude.ts, qwen.ts, and codex.ts
  - Cross-platform compatibility maintained (Linux, macOS, Windows)

### Changed
- **Code Refactoring and Quality Improvements**
  - Created `src/utils/process.ts` with `spawnCLI()` utility for unified process spawning
  - Created `src/utils/commands.ts` with `handleApplyPrompt()` utility for shared apply logic
  - Eliminated ~180 lines of duplicated code across three CLI files
  - Improved maintainability: bug fixes and feature additions now centralized in utilities
  - Enhanced code robustness through DRY principle and single source of truth
  - All existing tests pass (153/153) after refactoring

### Technical
- New utility modules enable consistent behavior across all coders
- Internal `parseArgs()` function in commands.ts for flag parsing
- Updated imports to use new shared utilities
- No breaking changes - all existing functionality preserved
- Improved extensibility: future coders can reuse utilities without code duplication

## [0.0.3] - 2025-11-30

### Added
- **Custom env_key Configuration for Codex Profiles**
  - New optional `envKey` field in Codex profiles to override provider's default environment variable name
  - Interactive prompt during `codex create` to specify custom env_key (leave empty for provider default)
  - Non-interactive support via `--env-key` parameter in `codex create --quiet`
  - Edit command support: modify or clear custom env_key (use 'clear' to revert to provider default)
  - Priority logic: `profile.envKey` > `preset.env_key` > `"OPENAI_API_KEY"` (fallback)
  - Consistent behavior across `createProviderTable()`, `getEnvExportCommands()`, and `cmdRun()`

### Changed
- Updated `ClaudeCodeProfile` interface with optional `envKey?: string` field
- Enhanced Codex adapter to support per-profile environment variable customization
- Improved help documentation with custom env_key examples
- Updated `CLAUDE.md` with design pattern #9: Custom env_key per profile

### Technical
- 7 new unit tests covering custom env_key functionality (all passing)
- No breaking changes - existing profiles without `envKey` field work seamlessly
- Backward compatible - undefined `envKey` falls back to provider preset defaults

## [0.0.2] - 2025-01-21

### Added
- **Windows Support**: Full compatibility with Windows 10/11
  - Platform-specific config path detection (~/swixter on Windows vs ~/.config/swixter on Unix)
  - All adapters verified to work on Windows via `os.homedir()` and `path.join()`
  - Docker-based E2E tests compatible with Docker Desktop on Windows
- **Documentation**: Comprehensive Windows development guide
  - New `docs/WINDOWS.md` with detailed Windows compatibility information
  - Configuration path mapping table for all supported platforms
  - E2E testing strategies for Windows (Docker vs native)
  - Troubleshooting guide for common Windows issues
- Updated `README.md` with Windows installation instructions
- Updated `CLAUDE.md` with cross-platform architecture details

### Changed
- `src/constants/paths.ts`: Added platform detection for Swixter config directory
  - Windows: `~/swixter/config.json` (e.g., `C:\Users\username\swixter\config.json`)
  - Linux/macOS: `~/.config/swixter/config.json` (XDG Base Directory spec)

### Technical
- No breaking changes - existing configs automatically work on all platforms
- All file operations use Node.js built-in APIs (os, path, fs/promises)
- TOML and YAML parsing libraries are pure JavaScript (no native deps)

## [0.0.1] - 2025-01-21

### Added
- 🎉 Initial release of Swixter
- Multi-coder support: Claude Code, Codex, and Continue.dev/Qwen
- Profile management: create, list, switch, delete, edit profiles
- Built-in providers: Anthropic, Ollama, Custom (OpenAI-compatible)
- User-defined provider system for custom AI services
- Command aliases for improved productivity:
  - `r` → `run` (ultra-short alias)
  - `ls` → `list`
  - `sw` → `switch`
  - `rm` → `delete`
  - `new` → `create`
- Interactive menus for easy navigation
- Shell completion support (Bash, Zsh, Fish)
- Configuration import/export with optional API key sanitization
- Codex integration with:
  - TOML config file support (`~/.codex/config.toml`)
  - Environment variable management
  - All-in-one `run` command (apply + env setup + execute)
- Comprehensive E2E test suite with Docker
- English and Chinese bilingual support

### Features
- **Claude Code Support**: Full integration with `~/.claude/settings.json`
- **Codex Support**: TOML-based configuration with automatic env var setup
- **Continue/Qwen Support**: YAML-based configuration at `~/.continue/config.yaml`
- **Provider Management**: Add, remove, list custom providers via CLI
- **Profile Switching**: Independent active profiles per coder
- **Smart Apply Flow**: Automatically writes coder-specific config files
- **Interactive Mode**: Beautiful CLI prompts with validation
- **Non-interactive Mode**: Full flag support for scripting (`--quiet` mode)
- **Shell Completions**: Auto-completion for commands, profiles, and providers

### Technical
- Built with Bun for fast performance
- TypeScript with strict mode
- Zod for schema validation
- @clack/prompts for beautiful CLI interface
- Comprehensive test coverage (unit + E2E)
- Docker-based E2E testing for reliability

[Unreleased]: https://github.com/dawnswwwww/swixter/compare/v0.0.10...HEAD
[0.0.10]: https://github.com/dawnswwwww/swixter/compare/v0.0.9...v0.0.10
[0.0.9]: https://github.com/dawnswwwww/swixter/compare/v0.0.8...v0.0.9
[0.0.8]: https://github.com/dawnswwwww/swixter/compare/v0.0.7...v0.0.8
[0.0.7]: https://github.com/dawnswwwww/swixter/compare/v0.0.6...v0.0.7
[0.0.6]: https://github.com/dawnswwwww/swixter/compare/v0.0.5...v0.0.6
[0.0.5]: https://github.com/dawnswwwww/swixter/compare/v0.0.4...v0.0.5
[0.0.4]: https://github.com/dawnswwwww/swixter/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/dawnswwwww/swixter/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/dawnswwwww/swixter/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/dawnswwwww/swixter/releases/tag/v0.0.1
