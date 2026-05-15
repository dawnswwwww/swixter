---
title: Claude Code
description: Manage Claude Code configurations with Swixter.
---

# Claude Code Commands

All Claude Code commands use the `swixter claude` prefix.

## `create`

Create a new profile for Claude Code.

```bash
swixter claude create <name>
```

The interactive prompt asks for provider, API key, base URL, model, and optional auth token.

**Options:**
| Flag | Description |
|------|-------------|
| `-p, --provider <id>` | Provider ID (skip prompt) |
| `-k, --api-key <key>` | API key (skip prompt) |
| `-u, --base-url <url>` | Custom base URL |
| `-m, --model <model>` | Default model |
| `-t, --auth-token <token>` | Auth token for ANTHROPIC_AUTH_TOKEN |
| `--api-format <format>` | Target API format (`anthropic_messages`, `openai_chat`, etc.) |

```bash
# Non-interactive
swixter claude create work \
  --provider anthropic \
  --api-key sk-ant-... \
  --model claude-sonnet-4-6
```

## `switch`

Set the active profile for Claude Code.

```bash
swixter claude switch <name>
```

## `list`

List all Claude Code profiles.

```bash
swixter claude list
```

Shows all profiles with the active one highlighted.

## `apply`

Write the active profile to `~/.claude/settings.json`.

```bash
swixter claude apply
```

This writes the API key, base URL, and model settings to Claude Code's config. Non-API settings (MCP servers, approval policies) are preserved.

## `run`

Launch Claude Code with the active profile.

```bash
swixter claude run
```

Spawns the `claude` CLI. Passes any additional arguments through:

```bash
swixter claude run --print "explain this code"
```

## `edit`

Modify an existing profile.

```bash
swixter claude edit <name>
```

Opens an interactive prompt showing current values. Press Enter to keep, type new value to change.

## `delete`

Remove a profile.

```bash
swixter claude delete <name>
```

You cannot delete the currently active profile. Switch to another first.

## `install`

Install the Claude Code CLI using the recommended method for your platform.

```bash
swixter claude install
```

Shows available installation methods and picks the recommended one.

## `update-cli`

Update the Claude Code CLI to the latest version.

```bash
swixter claude update-cli
```

Alias: `swixter claude upgrade`
