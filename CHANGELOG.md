# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/dawnswwwww/swixter/compare/v0.0.4...HEAD
[0.0.4]: https://github.com/dawnswwwww/swixter/compare/v0.0.3...v0.0.4
[0.0.3]: https://github.com/dawnswwwww/swixter/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/dawnswwwww/swixter/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/dawnswwwww/swixter/releases/tag/v0.0.1
