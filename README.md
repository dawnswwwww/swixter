# Swixter

[![npm version](https://badge.fury.io/js/swixter.svg)](https://www.npmjs.com/package/swixter)
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

- **Linux/macOS**: Full support
- **Windows**: Full support (Windows 10/11, requires Node.js 18+)
  - Config stored at `~/swixter/config.json` (e.g., `C:\Users\YourName\swixter\config.json`)
  - Docker Desktop + WSL2 recommended for E2E tests
  - See [docs/WINDOWS.md](docs/WINDOWS.md) for detailed Windows guide

## Quick Start

```bash
# Create your first profile
swixter claude create

# List all profiles
swixter claude list

# Switch between profiles
swixter claude switch my-profile

# Apply profile to Claude Code
swixter claude apply
```

## Built-in Providers

- **Anthropic** - Official Claude API
- **Ollama** - Run Qwen and other models locally
- **Custom** - Add any OpenAI-compatible API

## Add Custom Providers

Easily add any AI service:

```bash
# Interactive setup
swixter providers add

# Or use flags
swixter providers add \
  --id openrouter \
  --name "OpenRouter" \
  --base-url "https://openrouter.ai/api/v1" \
  --auth-type bearer
```

Supports OpenRouter, DeepSeek, MiniMax, and any OpenAI-compatible API.

## Features

✨ **Simple** - Minimal commands, maximum productivity
🚀 **Fast** - Built with Bun for instant operations
🎨 **Beautiful** - Clean, modern CLI interface
🔒 **Secure** - Keys stored locally, optional sanitization for sharing
🔧 **Flexible** - Works with any OpenAI-compatible API
📦 **Lightweight** - Small package size, zero bloat

## Commands

### For Claude Code

```bash
swixter claude create          # Create new profile
swixter claude list             # List all profiles (alias: ls)
swixter claude switch <name>    # Switch active profile (alias: sw)
swixter claude apply            # Apply to Claude Code
swixter claude run              # Run Claude Code with current profile (alias: r)
swixter claude delete <name>    # Delete profile (alias: rm)
```

### For Codex

```bash
swixter codex create          # Create new profile
swixter codex list             # List all profiles (alias: ls)
swixter codex switch <name>    # Switch active profile (alias: sw)
swixter codex apply            # Apply to Codex (writes ~/.codex/config.toml)
swixter codex run              # Apply + set env + run codex (alias: r, all-in-one)
swixter codex delete <name>    # Delete profile (alias: rm)
```

**Two ways to use Codex profiles**:

1. **Quick way** (recommended): `swixter codex r` (or `swixter codex run`)
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
swixter qwen delete <name>      # Delete profile (alias: rm)
```

### Provider Management

```bash
swixter providers list          # List available providers
swixter providers add           # Add custom provider
swixter providers remove <id>   # Remove provider
```

### Configuration

```bash
swixter export config.json      # Export configs
swixter import config.json      # Import configs
swixter completion bash         # Shell completion
```

## Configuration File

Configs are stored at `~/.config/swixter/config.json`

```json
{
  "profiles": {
    "my-profile": {
      "name": "my-profile",
      "providerId": "anthropic",
      "apiKey": "sk-ant-...",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "coders": {
    "claude": {
      "activeProfile": "my-profile"
    }
  }
}
```

## Examples

### Example 1: Switch between work and personal

```bash
# Setup work profile
swixter claude create --name work --provider anthropic --api-key sk-ant-work-xxx

# Setup personal profile
swixter claude create --name personal --provider anthropic --api-key sk-ant-personal-xxx

# Switch to work (using short alias)
swixter claude sw work && swixter claude apply

# Quick run with work profile (using ultra-short alias)
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

# Switch and run (using aliases)
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

# Quick way: All-in-one command (using ultra-short alias)
swixter codex r

# Or manual way:
swixter codex apply
export OLLAMA_API_KEY=""
codex

# Run with different profile temporarily
swixter codex run --profile other-profile
```

### Example 4: Add OpenRouter

```bash
# Add OpenRouter as custom provider
swixter providers add \
  --id openrouter \
  --base-url "https://openrouter.ai/api/v1" \
  --auth-type bearer

# Create profile using OpenRouter
swixter claude create \
  --name openrouter-profile \
  --provider openrouter \
  --api-key sk-or-v1-xxx
```

## Shell Completion

Enable auto-completion for faster typing:

```bash
# Bash
swixter completion bash > ~/.local/share/bash-completion/completions/swixter

# Zsh
swixter completion zsh > ~/.zfunc/_swixter

# Fish
swixter completion fish > ~/.config/fish/completions/swixter.fish
```

## Command Aliases

Save keystrokes with short aliases:

```bash
swixter claude r               # run (ultra-short!)
swixter claude ls              # list
swixter claude sw my-profile   # switch
swixter claude rm old-profile  # delete
swixter claude new             # create
```

Full command reference:
- `r` → `run` - Execute the AI coder
- `ls` → `list` - List all profiles
- `sw` → `switch` - Switch profiles
- `rm` → `delete` - Delete profiles
- `new` → `create` - Create new profile

## Help & Documentation

```bash
swixter --help                 # Global help
swixter claude --help          # Claude commands help
swixter providers --help       # Provider commands help
```

## Development

Built with modern tools for a great developer experience:

```bash
# Clone repo
git clone https://github.com/dawnswwwww/swixter.git
cd swixter

# Install dependencies
bun install

# Run in dev mode
bun run cli

# Run tests
bun test
```

## Tech Stack

- **Bun** - Fast JavaScript runtime
- **TypeScript** - Type safety
- **@clack/prompts** - Beautiful CLI prompts
- **Zod** - Schema validation

## Contributing

Contributions are welcome! Feel free to:

- 🐛 Report bugs
- 💡 Suggest features
- 🔧 Submit pull requests

Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines (if available).

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for a list of changes in each version.

## Roadmap

Future plans for Swixter:

- [ ] Support for more AI coding assistants
- [ ] Profile templates for common setups
- [ ] Configuration validation and migration tools
- [ ] Web UI for profile management
- [ ] Cloud sync for profiles (optional)

## License

MIT License - see [LICENSE](LICENSE)

## Links

- [GitHub](https://github.com/dawnswwwww/swixter)
- [npm](https://www.npmjs.com/package/swixter)
- [Issues](https://github.com/dawnswwwww/swixter/issues)

---

**Made with ❤️ to make AI coding tools more accessible**
