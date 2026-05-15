# Swixter

[![npm version](https://badge.fury.io/js/swixter.svg)](https://www.npmjs.com/package/swixter)
[![Test Status](https://github.com/dawnswwwww/swixter/actions/workflows/test.yml/badge.svg)](https://github.com/dawnswwwww/swixter/actions/workflows/test.yml)
[![Release Status](https://github.com/dawnswwwww/swixter/actions/workflows/release.yml/badge.svg)](https://github.com/dawnswwwww/swixter/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Website](https://img.shields.io/badge/Website-swixter.cc-4a4733)](https://swixter.cc)
[![Docs](https://img.shields.io/badge/Docs-docs.swixter.cc-4a4733)](https://docs.swixter.cc)

> Make AI coding tools effortlessly switchable

A lightweight CLI tool that makes it easy to switch between AI providers for Claude Code, Codex, Continue, and other AI coding assistants.

## Why Swixter?

- **Switch providers instantly** - Change between Anthropic, Ollama, or custom APIs with one command
- **Automatic failover** - Group profiles by priority, auto-retry on provider failure
- **Local proxy** - Transparent proxy with circuit breaker, your tools won't even notice a provider goes down
- **Cloud sync** - Encrypt and sync your profiles across devices with end-to-end encryption
- **Multiple coders** - Works with Claude Code, Codex, Continue
- **Web UI** - Browser-based interface for visual management
- **All local** - Your keys stay on your machine; cloud sync uses client-side encryption

## Installation

```bash
# npm (Recommended)
npm install -g swixter

# npx (No Install Needed)
npx swixter --help
```

| Platform | Status | Notes |
|----------|--------|-------|
| **Linux** | Full | |
| **macOS** | Full | |
| **Windows 10/11** | Full | Requires Node.js 18+ |

Config stored at:
- **Linux/macOS**: `~/.config/swixter/`
- **Windows**: `~/swixter/`

## Quick Start

```bash
swixter                          # Interactive mode
swixter claude create            # Create profile
swixter claude list              # List profiles
swixter claude switch my-profile # Switch profile
swixter claude apply             # Apply to Claude Code
swixter ui                       # Launch Web UI
```

## Built-in Providers

| Provider | API Type | Description |
|----------|----------|-------------|
| **Anthropic** | responses | Official Claude API |
| **Ollama** | chat | Run models locally |
| **OpenAI** | chat | OpenAI API |
| **OpenRouter** | chat | Unified access to 100+ models |
| **Custom** | chat | Any OpenAI-compatible API |

## Profile Management

Profiles are configuration templates containing provider, API key, base URL, and model settings. Each coder maintains its own active profile.

### Commands (take Claude Code as example)

```bash
swixter claude create              # Interactive creation (alias: new)
swixter claude create --quiet --name my --provider anthropic --api-key sk-ant-xxx  # Non-interactive
swixter claude list                # List profiles (alias: ls)
swixter claude switch <name>       # Switch active profile (alias: sw)
swixter claude apply               # Write config to ~/.claude/settings.json
swixter claude run                 # Run Claude Code with current profile (alias: r)
swixter claude edit <name>         # Edit profile (alias: update)
swixter claude current             # Show active profile
swixter claude delete <name>       # Delete profile (alias: rm)
swixter claude install             # Install Claude Code CLI
swixter claude update-cli          # Update CLI (alias: upgrade)
```

Codex and Qwen/Continue have the same command structure: `swixter codex <command>` / `swixter qwen <command>`.

### Model Configuration

**Claude Code** - set per-profile models:

```bash
swixter claude create \
  --name production \
  --provider anthropic \
  --api-key sk-ant-xxx \
  --anthropic-model claude-sonnet-4-20250514 \
  --default-haiku-model claude-haiku-4-20250506 \
  --default-opus-model claude-opus-4-20250514
```

| Flag | Env Variable | Description |
|------|-------------|-------------|
| `--anthropic-model` | `ANTHROPIC_MODEL` | Default model |
| `--default-haiku-model` | `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Haiku model |
| `--default-opus-model` | `ANTHROPIC_DEFAULT_OPUS_MODEL` | Opus model |
| `--default-sonnet-model` | `ANTHROPIC_DEFAULT_SONNET_MODEL` | Sonnet model |

**Codex/Qwen** - single model field:

```bash
swixter codex create --name local --provider ollama --model qwen3:32b
```

### Custom Providers

```bash
swixter providers add
swixter providers list
swixter providers remove <id>
swixter providers show <id>
```

## Groups (Failover)

Groups are ordered lists of profiles used for **automatic failover**. When one provider fails, the next profile in the group is tried automatically.

### How It Works

```
Request → Proxy → Profile 1 (Anthropic) → Fail! → Profile 2 (OpenRouter) → Success → Response
```

Each group defines a priority order. The proxy tries profiles from highest to lowest priority until one succeeds.

### Commands

```bash
swixter group create              # Interactive creation (alias: new)
swixter group list                # List groups (alias: ls)
swixter group show <name>         # Show group details with profile order (alias: info)
swixter group edit <name>         # Edit group name and profiles (alias: update)
swixter group set-default <name>  # Set as default group
swixter group delete <name>       # Delete group (alias: rm)
```

### Example

```bash
# Create profiles for different providers
swixter claude create --name anthropic-primary --provider anthropic --api-key sk-ant-xxx
swixter claude create --name openrouter-backup --provider openrouter --api-key sk-or-xxx
swixter claude create --name ollama-local --provider ollama

# Create a group with failover priority
swixter group create --name ha-group --profiles anthropic-primary,openrouter-backup,ollama-local

# Set as default
swixter group set-default ha-group
```

### Web UI

Manage groups visually with drag-and-drop profile reordering:

```bash
swixter ui   # Open Groups page to create/reorder groups
```

## Proxy

The local proxy server sits between your AI coding tools and upstream providers, enabling automatic failover, circuit breaking, and unified access.

### How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Claude Code  │────▶│  Swixter Proxy   │────▶│  Anthropic   │
│ Codex        │     │  (localhost)      │─ ─ ▶│  OpenRouter  │
│ Continue     │     │  Circuit Breaker  │─ ─ ▶│  Ollama      │
└─────────────┘     └──────────────────┘     └──────────────┘
```

Key capabilities:

- **Failover** - Tries profiles in group priority order, returns first successful response
- **Circuit Breaker** - Skips providers that failed 3 consecutive times, auto-recovers after 60s
- **Streaming** - Transparently forwards SSE/NDJSON streaming responses
- **API Format Conversion** - Automatically converts between Anthropic Messages and OpenAI Chat Completions APIs
- **Multi-format** - Supports both OpenAI Chat (`/v1/chat/completions`) and Anthropic (`/v1/messages`, `/v1/responses`) APIs
- **Model Rewriting** - Different providers in a group can use different model names; the proxy rewrites them automatically

### Commands

```bash
# Start proxy as a background service
swixter proxy start                        # Start with default group
swixter proxy start --group ha-group       # Start with specific group
swixter proxy start --profile groq-local   # Start with single profile (gateway mode)
swixter proxy start --port 8080            # Custom port (default: 15721)
swixter proxy start --daemon               # Run in background

# Stop proxy
swixter proxy stop                         # Stop default instance
swixter proxy stop run-15722               # Stop specific instance

# View status
swixter proxy status                       # Show all running instances

# One-shot: start proxy + run coder tool
swixter proxy run -- claude                # Proxy + Claude Code
swixter proxy run -- codex                 # Proxy + Codex
swixter proxy run --group ha-group -- claude  # With specific group
```

### The `proxy run` Command

The easiest way to use the proxy. It:

1. Starts a temporary proxy instance (on next available port)
2. Points the coder tool's API URL to the local proxy
3. Spawns the coder tool
4. Stops the proxy when the coder exits

```bash
swixter proxy run -- claude    # One command, everything automatic
```

### API Format Conversion

The proxy automatically converts between API formats. When Claude Code sends Anthropic Messages API requests to `/v1/messages`, but the target provider uses OpenAI Chat Completions format, the proxy handles the bidirectional conversion transparently — including request body, response body, and SSE streaming.

```bash
# Create a profile with explicit API format
swixter claude create groq-local \
  --provider groq \
  --api-key $GROQ_API_KEY \
  --api-format openai_chat

# Start proxy in single-profile gateway mode
swixter proxy start --profile groq-local --port 3456
```

Supported conversions: Anthropic Messages ↔ OpenAI Chat Completions (request, response, and SSE streaming).

### Circuit Breaker

Per-profile circuit breaker prevents wasting time on failing providers:

| State | Behavior | Transition |
|-------|----------|------------|
| **Closed** | Requests pass through | 3 consecutive failures → Open |
| **Open** | Requests skipped | After 60s → Half-Open |
| **Half-Open** | One probe request allowed | Success → Closed, Failure → Open |

### Monitoring (Web UI)

```bash
swixter ui   # Proxy page shows live status, request counts, and real-time logs
```

## Web UI

```bash
swixter ui                # Default port 3141
swixter ui --port 8080    # Custom port
```

### Pages

- **Dashboard** - All coders at a glance, quick switch and apply
- **Profiles** - CRUD for configuration profiles
- **Groups** - Manage failover groups with drag-and-drop priority
- **Proxy** - Start/stop proxy, live logs, status monitoring
- **Providers** - Manage custom providers
- **Settings** - Import/export configurations

## Cloud Sync

Sync your profiles and provider configs across devices with end-to-end encryption. API keys and other sensitive fields are encrypted client-side before uploading — the server never sees plaintext secrets.

### Quick Start

```bash
swixter auth register                    # Create account with email verification
swixter auth login                       # Sign in with email + password
swixter auth login --magic-link          # Sign in via magic link email
swixter sync push                        # Upload encrypted config to cloud
swixter sync pull                        # Download and merge from cloud
swixter sync status                      # Check sync state
```

### Auth Commands

```bash
swixter auth register              # Create a new account (email verification)
swixter auth login                 # Sign in with email + password
swixter auth login --magic-link    # Sign in via magic link (browser or manual token)
swixter auth logout                # Sign out
swixter auth status                # Check login status
swixter auth delete-account        # Delete your account and cloud data
```

### Registration Flow

Creating an account uses email verification:

1. Enter your email address
2. A 6-digit verification code is sent to your email
3. Enter the verification code
4. Create a login password (min 6 characters)
5. Optionally set a display name
6. After registration, set up **end-to-end encryption** with a master password (min 8 characters, separate from your login password)
7. Choose whether to save the encryption key locally for automatic sync

### Login Options

**Password Login:**
```bash
swixter auth login
# Enter email and password
```

**Magic Link Login:**
```bash
swixter auth login --magic-link
# Enter email → check email → click the link → CLI detects it automatically
# Or press Enter to enter the token manually
```

After magic link login, you'll be prompted to set a login password for future sign-ins.

### Sync Commands

```bash
swixter sync push                # Push local config to cloud
swixter sync push --force-local  # Force push (overwrite remote)
swixter sync pull                # Pull remote config to local
swixter sync pull --force-remote # Force pull (overwrite local)
swixter sync status              # Show sync status and versions
swixter sync enable              # Enable auto sync
swixter sync disable             # Disable auto sync
```

### Encryption & Security

```
Local Config → Derive Encryption Key → Encrypt Sensitive Fields → Upload to Cloud
                                                                               ↓
Cloud → Download → Decrypt → Merge with Local Config → Apply
```

- **End-to-end encryption**: Sensitive fields (API keys, auth tokens) are encrypted with AES-GCM using a key derived from your master password via PBKDF2 before leaving your machine
- **Master password**: Separate from your login password. Used only for encryption. If forgotten, your cloud data cannot be decrypted
- **Save encryption key**: You can save the derived key locally for convenience (automatic sync without re-entering master password), or enter it each time
- **Version-based conflict detection**: Local and remote versions are tracked to detect and handle conflicts
- **Selective push/pull**: Only profiles and custom providers are synced; local-only settings stay untouched
- **Switching accounts**: When logging in as a different user, you'll be prompted to pull their cloud data, push your local data, or skip

## Other Commands

```bash
swixter export <file>              # Export configs
swixter export <file> --sanitize   # Export without API keys
swixter import <file>              # Import configs
swixter import <file> --overwrite  # Overwrite existing
swixter completion bash            # Shell completions (zsh/fish supported)
```

## Command Aliases

| Alias | Full Command | Description |
|-------|-------------|-------------|
| `r` | `run` | Execute the AI coder |
| `ls` | `list` | List profiles/groups |
| `sw` | `switch` | Switch profiles |
| `rm` | `delete` | Delete profiles/groups |
| `new` | `create` | Create new |
| `update` | `edit` | Edit existing |
| `upgrade` | `update-cli` | Update CLI tool |

## Examples

### Switch between work and personal

```bash
swixter claude create --name work --provider anthropic --api-key sk-ant-work-xxx
swixter claude create --name personal --provider anthropic --api-key sk-ant-personal-xxx
swixter claude sw work && swixter claude apply
```

### Failover setup: Anthropic primary + OpenRouter backup

```bash
# Create profiles
swixter claude create --name primary --provider anthropic --api-key sk-ant-xxx
swixter claude create --name backup --provider openrouter --api-key sk-or-xxx

# Create failover group
swixter group create --name failover --profiles primary,backup

# Run with proxy (auto-failover)
swixter proxy run --group failover -- claude
```

### Run Codex with local Ollama

```bash
swixter codex create --name local --provider ollama --base-url http://localhost:11434
swixter codex r
```

## Architecture

```
swixter/
├── src/
│   ├── cli/           # CLI command handlers
│   ├── config/        # Config file management
│   ├── adapters/      # Coder adapters (Claude, Codex, Continue)
│   ├── providers/     # Provider presets + user-defined providers
│   ├── groups/        # Group management (failover profiles)
│   ├── proxy/         # Local proxy server (failover, circuit breaker)
│   ├── auth/          # Cloud auth (register, login, token management)
│   ├── sync/          # Cloud sync (push, pull, merge, auto-sync)
│   ├── crypto/        # End-to-end encryption (key derivation, field encryption)
│   ├── server/        # Web UI API server
│   └── utils/         # Shared utilities
├── ui/                # Web UI (React + Vite + Tailwind)
└── tests/             # Unit tests
```

## Development

```bash
git clone https://github.com/dawnswwwww/swixter.git
cd swixter
bun install
bun run cli:dev      # Dev mode with hot reload
bun test             # Run tests
bun run build        # Build all (UI + CLI)
```

### Release

```bash
# Update CHANGELOG.md first, then:
bun run release:patch   # Bug fixes (0.1.0 → 0.1.1)
bun run release:minor   # Features (0.1.0 → 0.2.0)
bun run release:major   # Breaking changes (0.1.0 → 1.0.0)
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Runtime** | Bun |
| **Language** | TypeScript |
| **CLI UI** | @clack/prompts |
| **Validation** | Zod |
| **Web UI** | React + Vite + Tailwind CSS |
| **Testing** | Bun test, Docker E2E |

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT License - see [LICENSE](LICENSE)
