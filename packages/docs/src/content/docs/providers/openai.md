---
title: OpenAI-Compatible Providers
description: Configure OpenAI-compatible APIs in Swixter.
---

# OpenAI-Compatible Providers

The built-in `custom` provider works with any OpenAI-compatible API using the Chat Completions endpoint.

## Configuration

```bash
swixter claude create openai-profile \
  --provider custom \
  --api-key sk-... \
  --base-url https://api.openai.com/v1 \
  --model gpt-4o
```

## Provider Details

| Field | Value |
|-------|-------|
| Provider ID | `custom` |
| Wire API | `chat` |
| Default Base URL | `https://api.openai.com/v1` |
| Env Key | `OPENAI_API_KEY` |

## Supported Services

Any service with an OpenAI-compatible `/v1/chat/completions` endpoint works:

| Service | Base URL |
|---------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Together AI | `https://api.together.xyz/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Fireworks | `https://api.fireworks.ai/inference/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |

## Creating a Provider for Each Service

For frequently used services, create a user-defined provider:

```bash
swixter providers add deepseek \
  --name "DeepSeek" \
  --base-url https://api.deepseek.com/v1 \
  --wire-api chat \
  --env-key DEEPSEEK_API_KEY
```

Then use it when creating profiles:

```bash
swixter claude create deepseek-profile --provider deepseek
```

## Compatibility

- Compatible with all coders (Claude Code, Codex, Continue.dev)
- `wire_api: "chat"` type works universally

## Custom env_key

Customize the environment variable used for the API key (especially useful for Codex):

```bash
swixter codex create my-profile \
  --provider custom \
  --env-key GROQ_API_KEY
```
