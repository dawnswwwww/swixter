# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.0.1]: https://github.com/dawnswwwww/swixter/releases/tag/v0.0.1
