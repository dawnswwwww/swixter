---
title: Quick Start
description: Create your first profile and start using Swixter in minutes.
---

# Quick Start

This guide walks you through creating your first Swixter profile and applying it to an AI coding assistant.

## 1. Install Swixter

```bash
npm install -g swixter
```

## 2. List Available Providers

Swixter comes with built-in providers and supports user-defined ones:

```bash
swixter providers list
```

Output shows built-in and user-defined providers, including their `wire_api` type (used for Codex compatibility).

## 3. Create a Profile

A profile bundles a provider with your API key and settings:

```bash
swixter claude create my-profile
```

The interactive prompt asks for:
- **Provider**: Choose from Anthropic, Ollama, or custom providers
- **API Key**: Your provider's API key (stored locally)
- **Base URL**: Optional custom endpoint (for Ollama or proxies)
- **Model**: Optional default model
- **Auth Token**: (Claude only) Optional `ANTHROPIC_AUTH_TOKEN`

## 4. Switch to Your Profile

Set the profile as active for a coder:

```bash
swixter claude switch my-profile
```

Profiles are per-coder — you can have different active profiles for Claude Code vs Codex.

## 5. Apply the Profile

Write the active profile to the coder's config file:

```bash
swixter claude apply
```

This writes the configuration to the coder's native config file (e.g., `~/.claude/settings.json` for Claude Code).

## 6. Launch Your Coder

```bash
claude
```

Your coder is now using the Swixter-managed configuration.

## Common Workflow

```bash
# Create profiles for different providers
swixter claude create work-profile    # Anthropic
swixter claude create local-profile   # Ollama

# Switch between them
swixter claude switch work-profile
swixter claude apply

# List all profiles
swixter claude list

# Edit a profile
swixter claude edit work-profile
```

## Using with Codex

Codex requires environment variables set before launch. Use the `run` command:

```bash
swixter codex create codex-profile
swixter codex switch codex-profile
swixter codex run  # applies profile, sets env vars, launches codex
```

## Next Steps

- [Configuration details](/getting-started/configuration) — understand config file structure
- [Commands reference](/commands/claude) — explore all CLI commands
- [Provider setup](/providers/anthropic) — configure specific AI providers
