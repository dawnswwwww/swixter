---
title: Anthropic Provider
description: Configure Anthropic (Claude) as your AI provider in Swixter.
---

# Anthropic Provider

The Anthropic provider connects Swixter to Anthropic's Claude API using the Responses API protocol.

## Configuration

```bash
swixter claude create my-anthropic-profile \
  --provider anthropic \
  --api-key sk-ant-api03-... \
  --model claude-sonnet-4-6
```

## Provider Details

| Field | Value |
|-------|-------|
| Provider ID | `anthropic` |
| Wire API | `responses` |
| Default Base URL | `https://api.anthropic.com` |
| Env Key | `ANTHROPIC_API_KEY` |

## API Key

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

The API key is written to `~/.claude/settings.json` as an environment variable when you run `swixter claude apply`.

## Models

You can specify a default model when creating or editing a profile:

```bash
swixter claude edit my-anthropic-profile -m claude-opus-4-6
```

Supported model fields for Claude Code:

| Model Field | Environment Variable |
|-------------|---------------------|
| Model | `ANTHROPIC_MODEL` |
| Default Haiku | `ANTHROPIC_DEFAULT_HAIKU_MODEL` |
| Default Opus | `ANTHROPIC_DEFAULT_OPUS_MODEL` |
| Default Sonnet | `ANTHROPIC_DEFAULT_SONNET_MODEL` |

## Auth Token

Claude Code profiles support an optional auth token:

```bash
swixter claude create profile-with-token \
  --provider anthropic \
  --api-key sk-ant-... \
  --auth-token your-auth-token
```

This sets `ANTHROPIC_AUTH_TOKEN` in the Claude Code config.

## Compatibility

- Compatible with Claude Code
- **Not** compatible with Codex (requires `wire_api: "chat"`)

For Codex, use a `wire_api: "chat"` provider like Ollama or a custom OpenAI-compatible provider.
