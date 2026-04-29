---
title: Ollama Provider
description: Configure Ollama for local AI models in Swixter.
---

# Ollama Provider

The Ollama provider connects Swixter to a local Ollama instance for running models locally.

## Configuration

```bash
swixter claude create my-ollama-profile \
  --provider ollama \
  --base-url http://localhost:11434/v1 \
  --model llama3
```

## Provider Details

| Field | Value |
|-------|-------|
| Provider ID | `ollama` |
| Wire API | `chat` |
| Default Base URL | `http://localhost:11434/v1` |
| Env Key | `OLLAMA_API_KEY` |

## Setup

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull llama3`
3. Create a Swixter profile:

```bash
swixter claude create local \
  --provider ollama \
  --base-url http://localhost:11434/v1 \
  --model llama3
```

## Base URL

Ollama typically runs on port 11434. The API path is `/v1` for OpenAI-compatible endpoints:

```
http://localhost:11434/v1
```

If you're running Ollama on a different machine, update the base URL:

```bash
swixter claude create remote-ollama \
  --provider ollama \
  --base-url http://192.168.1.100:11434/v1
```

## API Key

Ollama doesn't require an API key by default. Swixter uses `OLLAMA_API_KEY` as the environment variable name for compatibility, but you can leave it empty or set a placeholder.

## Compatibility

- Compatible with Claude Code, Codex, and Continue.dev
- `wire_api: "chat"` type works with all coders
- For Codex, the env_key defaults to `OLLAMA_API_KEY`

## Custom env_key for Codex

```bash
swixter codex create ollama-codex \
  --provider ollama \
  --env-key MY_CUSTOM_KEY
```
