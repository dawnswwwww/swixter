# Swixter

> Make AI coding tools effortlessly switchable

A lightweight CLI tool that makes it easy to switch between AI providers for Claude Code and other AI coding assistants.

## Why Swixter?

Working with AI coding tools shouldn't be complicated. Swixter lets you:

- **Switch providers instantly** - Change between Anthropic, Ollama, or custom APIs with one command
- **Manage multiple configs** - Keep separate profiles for work, personal, or experimental setups
- **Add custom providers** - Easily integrate any AI service with a simple configuration
- **Stay in control** - All configs stored locally, no cloud dependencies

## Installation

```bash
npm install -g swixter
```

Or use with npx (no install needed):

```bash
npx swixter --help
```

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
swixter claude list             # List all profiles
swixter claude switch <name>    # Switch active profile
swixter claude apply            # Apply to Claude Code
swixter claude delete <name>    # Delete profile
```

### For Qwen (or other coders)

```bash
swixter qwen create
swixter qwen list
swixter qwen switch <name>
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

# Switch to work
swixter claude switch work && swixter claude apply

# Switch to personal
swixter claude switch personal && swixter claude apply
```

### Example 2: Try Qwen locally

```bash
# Add Ollama profile
swixter qwen create \
  --name local \
  --provider ollama \
  --base-url http://localhost:11434

# Switch and use
swixter qwen switch local
```

### Example 3: Add OpenRouter

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
swixter claude ls              # list
swixter claude sw my-profile   # switch
swixter claude rm old-profile  # delete
swixter claude new             # create
```

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

## License

MIT License - see [LICENSE](LICENSE)

## Links

- [GitHub](https://github.com/dawnswwwww/swixter)
- [npm](https://www.npmjs.com/package/swixter)
- [Issues](https://github.com/dawnswwwww/swixter/issues)

---

**Made with ❤️ to make AI coding tools more accessible**
