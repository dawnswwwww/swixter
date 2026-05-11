---
title: Continue.dev Commands
description: Manage Continue.dev configurations with Swixter.
---

# Continue.dev Commands

All Continue.dev commands use the `swixter qwen` prefix. Despite the name, these commands target the **Continue.dev VS Code extension**, not the Qwen Code CLI.

## `create`

Create a new profile for Continue.dev.

```bash
swixter qwen create <name>
```

Creates a profile targeting Continue.dev's `~/.continue/config.yaml`.

**Options:**
| Flag | Description |
|------|-------------|
| `-p, --provider <id>` | Provider ID |
| `-k, --api-key <key>` | API key |
| `-u, --base-url <url>` | Custom base URL |
| `-m, --model <model>` | Default model |

## `switch`

Set the active profile for Continue.dev.

```bash
swixter qwen switch <name>
```

## `list`

List all profiles.

```bash
swixter qwen list
```

## `apply`

Write the active profile to `~/.continue/config.yaml`.

```bash
swixter qwen apply
```

Modifies the YAML config with `model` and `apiKey` fields. Preserves other Continue settings.

## `run`

Launch with the active profile.

```bash
swixter qwen run
```

Spawns `qwen-code` CLI (if installed).

## `edit`

Modify an existing profile.

```bash
swixter qwen edit <name>
```

## `delete`

Remove a profile.

```bash
swixter qwen delete <name>
```

## `install`

Install Continue.dev / Qwen Code CLI.

```bash
swixter qwen install
```

## `update-cli`

Update the installed CLI.

```bash
swixter qwen update-cli
```
