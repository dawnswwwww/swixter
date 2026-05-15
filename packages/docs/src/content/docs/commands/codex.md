---
title: Codex
description: Manage Codex configurations with Swixter.
---

# Codex Commands

All Codex commands use the `swixter codex` prefix. Codex uses TOML config with environment variable references.

## `create`

Create a new profile for Codex.

```bash
swixter codex create <name>
```

**Important:** Codex only supports `wire_api: "chat"` providers (OpenAI-compatible). Anthropic is filtered out.

The interactive prompt includes an additional `envKey` option for customizing the environment variable used for the API key.

**Options:**
| Flag | Description |
|------|-------------|
| `-p, --provider <id>` | Provider ID |
| `-k, --api-key <key>` | API key |
| `-u, --base-url <url>` | Custom base URL |
| `-m, --model <model>` | Default model |
| `-e, --env-key <key>` | Custom environment variable name |
| `--api-format <format>` | Target API format (`anthropic_messages`, `openai_chat`, etc.) |

## `switch`

Set the active profile for Codex.

```bash
swixter codex switch <name>
```

## `list`

List all Codex profiles.

```bash
swixter codex list
```

## `apply`

Write the active profile to `~/.codex/config.toml`.

```bash
swixter codex apply
```

Creates `[model_providers.swixter-<name>]` and `[profiles.swixter-<name>]` tables. Uses `env_key` references instead of storing plaintext keys.

## `run`

Apply the profile, set environment variables, and launch Codex — all in one command.

```bash
swixter codex run
```

This is the recommended way to use Codex with Swixter. It:
1. Applies the active profile to `config.toml`
2. Exports the API key as the required environment variable
3. Spawns `codex`

## `edit`

Modify an existing profile.

```bash
swixter codex edit <name>
```

## `delete`

Remove a profile.

```bash
swixter codex delete <name>
```

## `install`

Install the Codex CLI.

```bash
swixter codex install
```

## `update-cli`

Update the Codex CLI.

```bash
swixter codex update-cli
```

## Environment Variables

Codex profiles use an environment variable reference (`env_key`) to reference the API key:

| Priority | Source |
|----------|--------|
| 1 | Profile-specific `envKey` (if set) |
| 2 | Provider default `env_key` (e.g., `OLLAMA_API_KEY` for Ollama) |
| 3 | `OPENAI_API_KEY` (fallback) |

To see what env vars your profile uses:

```bash
swixter codex env
```

This outputs export commands for setting up your environment.
