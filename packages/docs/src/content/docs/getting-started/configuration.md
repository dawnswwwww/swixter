---
title: Configuration
description: Understand Swixter configuration files, profiles, and storage locations.
---

# Configuration

## Config File Locations

Swixter stores its own config in a platform-specific directory. AI coder configs use their standard locations.

### Swixter Config

| Platform | Path |
|----------|------|
| **Linux/macOS** | `~/.config/swixter/config.json` |
| **Windows** | `~/swixter/config.json` (e.g., `C:\Users\name\swixter\config.json`) |

### AI Coder Configs

| Coder | Path | Format |
|-------|------|--------|
| **Claude Code** | `~/.claude/settings.json` | JSON |
| **Codex** | `~/.codex/config.toml` | TOML |
| **Continue.dev** | `~/.continue/config.yaml` | YAML |

## Profile Structure

A Swixter profile contains:

```json
{
  "providerId": "anthropic",
  "apiKey": "sk-ant-...",
  "baseUrl": "https://api.anthropic.com",
  "model": "claude-sonnet-4-6",
  "authToken": "",
  "envKey": "ANTHROPIC_API_KEY"
}
```

| Field | Description | Required |
|-------|-------------|----------|
| `providerId` | Which provider preset to use | Yes |
| `apiKey` | API key for the provider | Yes |
| `baseUrl` | Override the default API endpoint | No |
| `model` | Default model name | No |
| `authToken` | (Claude only) `ANTHROPIC_AUTH_TOKEN` | No |
| `envKey` | (Codex only) Environment variable name for API key | No |

## Provider System

Swixter has a two-tier provider system:

### Built-in Providers
Hardcoded in Swixter. Currently includes:
- `anthropic` — Anthropic Claude API (`wire_api: "responses"`)
- `ollama` — Local Ollama (`wire_api: "chat"`)
- `custom` — Generic OpenAI-compatible (`wire_api: "chat"`)

### User-Defined Providers
Stored in `~/.config/swixter/providers.json`. You can create custom providers:

```bash
swixter providers add my-provider --base-url https://api.example.com/v1
```

User providers can override built-in ones with the same ID.

### Wire API Types

The `wire_api` field determines compatibility:

| Type | Description | Compatible with |
|------|-------------|-----------------|
| `chat` | OpenAI-compatible chat API | Codex, Continue.dev |
| `responses` | Anthropic Responses API | Claude Code |

Codex only supports `wire_api: "chat"` providers. Anthropic is filtered out in Codex flows.

## Profile Naming Rules

Profile names must be alphanumeric with dashes/underscores only:
- Letters, numbers, dashes (`-`), underscores (`_`)
- No spaces or special characters
- Cannot start with a dash

Valid: `my-profile`, `work_config`, `test1`
Invalid: `my profile`, `-test`, `hello@world`

## Active Profile

Each coder has exactly one active profile at a time. Use `switch` to change it:

```bash
swixter claude switch my-profile  # sets active
swixter claude apply              # writes to coder config
```

The `apply` command reads the active profile and writes it to the coder's native config file. It preserves any non-API settings the coder has (MCP servers, approval policies, etc.).

## Coder-Specific Behaviors

### Claude Code
- Full replacement of API-related env vars in `settings.json`
- Only fields present in the profile are written; undefined fields are removed
- Writes model environment variables (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`, etc.)
- Supports `authToken` field

### Codex
- Uses environment variable references (`env_key`) per official Codex spec
- Creates `[model_providers.swixter-<name>]` and `[profiles.swixter-<name>]` tables
- API keys must be set as environment variables before running Codex (or use `swixter codex run`)
- Supports custom `env_key` per profile

### Continue.dev
- Modifies `config.yaml` with `model`/`apiKey` fields
- Accessed via `swixter qwen` commands (historical naming)

## Next Steps

- [Claude Code commands](/commands/claude)
- [Codex commands](/commands/codex)
- [Provider configuration](/providers/anthropic)
