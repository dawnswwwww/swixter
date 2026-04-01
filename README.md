# Swixter

[![npm version](https://badge.fury.io/js/swixter.svg)](https://www.npmjs.com/package/swixter)
[![Test Status](https://github.com/dawnswwwww/swixter/actions/workflows/test.yml/badge.svg)](https://github.com/dawnswwwww/swixter/actions/workflows/test.yml)
[![Release Status](https://github.com/dawnswwwww/swixter/actions/workflows/release.yml/badge.svg)](https://github.com/dawnswwwww/swixter/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/swixter.svg)](https://nodejs.org)

> Make AI coding tools effortlessly switchable

A lightweight CLI tool that makes it easy to switch between AI providers for Claude Code, Codex, Continue, and other AI coding assistants.

## Why Swixter?

Working with AI coding tools shouldn't be complicated. Swixter lets you:

- **Switch providers instantly** - Change between Anthropic, Ollama, or custom APIs with one command
- **Manage multiple configs** - Keep separate profiles for work, personal, or experimental setups
- **Support multiple coders** - Works with Claude Code, Codex, Continue, and more
- **Use command aliases** - Ultra-short commands (`r`, `ls`, `sw`) for maximum productivity
- **Add custom providers** - Easily integrate any OpenAI-compatible AI service
- **Stay in control** - All configs stored locally, no cloud dependencies
- **Web UI** - Browser-based interface for visual configuration management

## Installation

### npm (Recommended)

```bash
npm install -g swixter
```

### npx (No Install Needed)

```bash
npx swixter --help
```

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| **Linux** | ✅ Full | Full support |
| **macOS** | ✅ Full | Full support |
| **Windows 10/11** | ✅ Full | Requires Node.js 18+; Docker Desktop + WSL2 for E2E tests |

Config stored at:
- **Linux/macOS**: `~/.config/swixter/`
- **Windows**: `~/swixter/` (e.g., `C:\Users\YourName\swixter\`)

See [docs/WINDOWS.md](docs/WINDOWS.md) for detailed Windows guide.

## Quick Start

```bash
# Interactive mode - guided setup
swixter

# Or use commands directly
swixter claude create                    # Create profile
swixter claude list                     # List profiles
swixter claude switch my-profile        # Switch profile
swixter claude apply                    # Apply to Claude Code

# Launch Web UI (browser-based management)
swixter ui
```

## Built-in Providers

| Provider | API Type | Description |
|----------|----------|-------------|
| **Anthropic** | responses | Official Claude API |
| **Ollama** | chat | Run Qwen, Llama, and other models locally |
| **OpenAI** | chat | OpenAI API |
| **OpenRouter** | chat | Unified access to 100+ models |
| **Custom** | chat | Add any OpenAI-compatible API |

## Web UI

Launch `swixter ui` to open a browser-based interface for managing profiles.

### Features

- **Dashboard** - View all coders, switch active profiles, apply configurations
- **Profiles** - Create, edit, delete configuration profiles
- **Providers** - Manage custom API providers
- **Settings** - Import/export configurations

### Running the Web UI

```bash
# Default port (3141)
swixter ui

# Custom port
swixter ui --port 8080
```

The UI auto-opens in your browser at `http://localhost:3141`.

### Web UI Dashboard

The Dashboard shows:
- All installed coders (Claude Code, Codex, Continue)
- Current active profile per coder
- Quick profile switching via dropdown
- One-click Apply to write config to coder's settings file

## Commands

### For Claude Code

```bash
swixter claude create          # Create new profile (alias: new)
swixter claude list             # List all profiles (alias: ls)
swixter claude switch <name>    # Switch active profile (alias: sw)
swixter claude apply            # Apply to Claude Code
swixter claude run              # Run Claude Code with current profile (alias: r)
swixter claude edit <name>      # Edit existing profile (alias: update)
swixter claude current          # Show current active profile
swixter claude delete <name>    # Delete profile (alias: rm)
swixter claude install           # Install Claude Code CLI
swixter claude update-cli        # Update Claude Code CLI (alias: upgrade)
```

### For Codex

```bash
swixter codex create            # Create new profile
swixter codex list               # List all profiles (alias: ls)
swixter codex switch <name>      # Switch active profile (alias: sw)
swixter codex apply              # Apply to Codex (writes ~/.codex/config.toml)
swixter codex run                # Apply + set env + run codex (alias: r)
swixter codex edit <name>        # Edit existing profile (alias: update)
swixter codex current            # Show current active profile
swixter codex delete <name>      # Delete profile (alias: rm)
swixter codex install            # Install Codex CLI
swixter codex update-cli         # Update Codex CLI (alias: upgrade)
```

**Two ways to use Codex profiles**:

1. **Quick way** (recommended): `swixter codex r`
   - Automatically applies profile to config.toml
   - Sets environment variables
   - Runs codex in one command

2. **Manual way**: `swixter codex apply` → set env vars → `codex`
   - Good for debugging or custom setups

### For Qwen/Continue

```bash
swixter qwen create            # Create new profile
swixter qwen list               # List all profiles (alias: ls)
swixter qwen switch <name>      # Switch active profile (alias: sw)
swixter qwen apply              # Apply to Continue
swixter qwen run                # Run Qwen Code with current profile (alias: r)
swixter qwen edit <name>        # Edit existing profile (alias: update)
swixter qwen current            # Show current active profile
swixter qwen delete <name>      # Delete profile (alias: rm)
swixter qwen install            # Install Qwen Code CLI
swixter qwen update-cli         # Update Qwen Code CLI (alias: upgrade)
```

### Provider Management

```bash
swixter providers list          # List available providers
swixter providers add            # Add custom provider
swixter providers remove <id>   # Remove provider
swixter providers show <id>    # Show provider details
```

### Configuration

```bash
swixter ui                      # Launch Web UI
swixter ui --port <port>        # Launch Web UI on custom port
swixter export <file>           # Export configs
swixter export <file> --sanitize # Export without API keys
swixter import <file>           # Import configs
swixter import <file> --overwrite # Overwrite existing profiles
swixter completion bash          # Bash completion
swixter completion zsh           # Zsh completion
swixter completion fish          # Fish completion
```

## Model Configuration

### Claude Code Models

Set specific models per profile:

```bash
swixter claude create \
  --name production \
  --provider anthropic \
  --api-key sk-ant-xxx \
  --anthropic-model claude-sonnet-4-20250514 \
  --default-haiku-model claude-haiku-4-20250506 \
  --default-opus-model claude-opus-4-20250514 \
  --default-sonnet-model claude-sonnet-4-20250514
```

| Flag | Environment Variable | Description |
|------|---------------------|-------------|
| `--anthropic-model` | `ANTHROPIC_MODEL` | Default model |
| `--default-haiku-model` | `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku model |
| `--default-opus-model` | `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus model |
| `--default-sonnet-model` | `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet model |

### Codex/Qwen Models

```bash
swixter codex create \
  --name local-ollama \
  --provider ollama \
  --base-url http://localhost:11434 \
  --model qwen3:32b
```

## Configuration File

Configs are stored at:
- **Linux/macOS**: `~/.config/swixter/config.json`
- **Windows**: `~/swixter/config.json`

```json
{
  "profiles": {
    "my-profile": {
      "name": "my-profile",
      "providerId": "anthropic",
      "apiKey": "sk-ant-xxx",
      "authToken": "sk-ant-auth-xxx",
      "baseURL": "https://api.anthropic.com",
      "models": {
        "anthropicModel": "claude-sonnet-4-20250514",
        "defaultHaikuModel": "claude-haiku-4-20250506",
        "defaultOpusModel": "claude-opus-4-20250514",
        "defaultSonnetModel": "claude-sonnet-4-20250514"
      },
      "envKey": "CUSTOM_API_KEY",
      "headers": {
        "X-Custom-Header": "value"
      },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z"
    },
    "ollama-local": {
      "name": "ollama-local",
      "providerId": "ollama",
      "apiKey": "",
      "baseURL": "http://localhost:11434",
      "model": "qwen3:32b"
    }
  },
  "coders": {
    "claude": {
      "activeProfile": "my-profile"
    },
    "codex": {
      "activeProfile": "ollama-local"
    },
    "qwen": {
      "activeProfile": ""
    }
  }
}
```

## Add Custom Providers

```bash
# Interactive setup
swixter providers add

# With flags
swixter providers add \
  --id openrouter \
  --name "OpenRouter" \
  --display-name "OpenRouter" \
  --base-url "https://openrouter.ai/api/v1" \
  --auth-type bearer

# Then create a profile using it
swixter claude create --provider openrouter --api-key sk-or-xxx
```

## Examples

### Example 1: Switch between work and personal

```bash
# Setup work profile
swixter claude create --name work --provider anthropic --api-key sk-ant-work-xxx

# Setup personal profile
swixter claude create --name personal --provider anthropic --api-key sk-ant-personal-xxx

# Switch to work
swixter claude sw work && swixter claude apply

# Quick run
swixter claude r

# Switch to personal
swixter claude sw personal && swixter claude apply
swixter claude r
```

### Example 2: Try Qwen locally

```bash
# Add Ollama profile
swixter qwen create \
  --name local \
  --provider ollama \
  --base-url http://localhost:11434

# Switch and run
swixter qwen sw local
swixter qwen r
```

### Example 3: Use Codex with local Ollama

```bash
# Create Codex profile for Ollama
swixter codex create \
  --name ollama-local \
  --provider ollama \
  --base-url http://localhost:11434

# Quick way: All-in-one
swixter codex r

# Manual way
swixter codex apply
export OLLAMA_API_KEY=""
codex
```

### Example 4: Web UI workflow

```bash
# Launch Web UI
swixter ui

# In browser:
# 1. Go to Profiles → Create a new profile
# 2. Go to Dashboard → Select profile from dropdown
# 3. Click APPLY to write config
```

## Shell Completion

Enable auto-completion for faster typing:

### Bash

```bash
# Install
swixter completion bash > ~/.local/share/bash-completion/completions/swixter

# Reload
source ~/.bashrc
```

### Zsh

```bash
# Install
swixter completion zsh > ~/.zfunc/_swixter

# Reload
autoload -U compinit && compinit
```

### Fish

```bash
# Install
swixter completion fish > ~/.config/fish/completions/swixter.fish

# Reload
fish
```

## Command Aliases

Save keystrokes with short aliases:

| Alias | Full Command | Description |
|-------|-------------|-------------|
| `r` | `run` | Execute the AI coder |
| `ls` | `list` | List all profiles |
| `sw` | `switch` | Switch profiles |
| `rm` | `delete` | Delete profiles |
| `new` | `create` | Create new profile |
| `update` | `edit` | Edit existing profile |
| `upgrade` | `update-cli` | Update CLI tool |

## Architecture

```
swixter/
├── src/
│   ├── cli/           # CLI command handlers
│   ├── config/        # Config file management
│   ├── adapters/      # Coder-specific adapters (Claude, Codex, Continue)
│   ├── providers/     # Provider presets
│   ├── server/        # Web UI API server
│   └── utils/         # Shared utilities
├── ui/                # Web UI (React + Vite)
└── tests/             # Unit tests
```

**Data Flow**:
1. `swixter create/switch` → Updates `~/.config/swixter/config.json`
2. `swixter apply` → Writes to coder config (`~/.claude/settings.json`, etc.)
3. `swixter run` → Sets env vars + spawns coder CLI

## Development

Built with modern tools:

```bash
# Clone repo
git clone https://github.com/dawnswwwww/swixter.git
cd swixter

# Install dependencies
bun install

# Run CLI in dev mode (with hot reload)
bun run cli:dev

# Run tests
bun test

# Run specific test
bun test tests/adapters/claude.test.ts

# E2E tests (requires Docker)
bun run test:e2e

# Build
bun run build
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Bun |
| **Language** | TypeScript |
| **CLI UI** | @clack/prompts |
| **Validation** | Zod |
| **Version** | semver |
| **Web UI** | React + Vite + Tailwind CSS |
| **Testing** | Bun test, Docker E2E |

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## Roadmap

- [ ] Profile templates for common setups
- [ ] Configuration validation and migration tools
- [x] Web UI for profile management (v0.0.9+)
- [ ] Cloud sync for profiles (optional, planned)

## Contributing

Contributions welcome!

### Development Setup

```bash
git clone https://github.com/dawnswwwww/swixter.git
cd swixter
bun install
bun run cli:dev
bun test
bun run build
```

### Release Process

1. Update `CHANGELOG.md` under `[Unreleased]`
2. Run release command:
   ```bash
   bun run release:patch  # Bug fixes (0.0.10 → 0.0.11)
   bun run release:minor  # Features (0.0.10 → 0.1.0)
   bun run release:major  # Breaking changes
   ```
3. GitHub Actions automatically:
   - Runs tests on Linux/macOS/Windows
   - Publishes to npm
   - Creates GitHub Release with changelog

See [CLAUDE.md](CLAUDE.md) for detailed development documentation.

## License

MIT License - see [LICENSE](LICENSE)

## Links

- [GitHub](https://github.com/dawnswwwww/swixter)
- [npm](https://www.npmjs.com/package/swixter)
- [Issues](https://github.com/dawnswwwww/swixter/issues)

---

**Made with ❤️ to make AI coding tools more accessible**
