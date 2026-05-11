---
title: Provider Management
description: Add, remove, and manage AI providers in Swixter.
---

# Provider Management

Provider management commands use the `swixter providers` prefix.

## `list`

List all available providers.

```bash
swixter providers list
```

Shows built-in providers and user-defined providers with their details:

```
Built-in providers:
  anthropic     Anthropic Claude API     wire_api: responses
  ollama        Local Ollama             wire_api: chat
  custom        OpenAI-compatible API    wire_api: chat

User-defined providers:
  my-provider   Custom endpoint          wire_api: chat
```

## `add`

Define a custom provider.

```bash
swixter providers add <id>
```

The interactive prompt asks for:
- **Name**: Display name
- **Base URL**: API endpoint
- **Wire API**: `chat` or `responses`
- **Default env_key**: Environment variable for API key (e.g., `OPENAI_API_KEY`)

**Example:**

```bash
swixter providers add deepseek \
  --name "DeepSeek" \
  --base-url https://api.deepseek.com/v1 \
  --wire-api chat \
  --env-key DEEPSEEK_API_KEY
```

User-defined providers are stored in `~/.config/swixter/providers.json`.

## `show`

View details of a specific provider.

```bash
swixter providers show <id>
```

## `remove`

Delete a user-defined provider.

```bash
swixter providers remove <id>
```

Built-in providers cannot be removed.

## Wire API Types

| Type | Description | Compatible Coders |
|------|-------------|-------------------|
| `chat` | OpenAI-compatible chat completions endpoint | Codex, Continue.dev |
| `responses` | Anthropic Responses API | Claude Code |

When creating Codex profiles, only `wire_api: "chat"` providers are available. The Anthropic provider (`wire_api: "responses"`) is filtered out.

## Supported Providers

Swixter ships with three built-in providers and supports user-defined custom providers.

### Anthropic

The Anthropic provider connects to Anthropic's Claude API using the Responses API protocol. It is **only compatible with Claude Code**.

| Field | Value |
|-------|-------|
| Provider ID | `anthropic` |
| Wire API | `responses` |
| Default Base URL | `https://api.anthropic.com` |
| Env Key | `ANTHROPIC_API_KEY` |

```bash
# Create a profile using Anthropic
swixter claude create my-profile \
  --provider anthropic \
  --api-key sk-ant-api03-... \
  --model claude-sonnet-4-6
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

**Model fields:** Claude Code profiles can specify multiple model environment variables via `--model` (`ANTHROPIC_MODEL`), plus individual defaults for Haiku, Opus, and Sonnet. See [Claude Code commands](/commands/claude#edit) for details.

**Auth token:** An optional auth token is supported via `--auth-token`, which sets `ANTHROPIC_AUTH_TOKEN`.

**Compatibility:** Claude Code only. Not available for Codex (requires `wire_api: "chat"`).

### Ollama

The Ollama provider connects to a local Ollama instance for running models locally. It uses `wire_api: "chat"` and is compatible with all coders.

| Field | Value |
|-------|-------|
| Provider ID | `ollama` |
| Wire API | `chat` |
| Default Base URL | `http://localhost:11434/v1` |
| Env Key | `OLLAMA_API_KEY` |

```bash
# Create a profile using Ollama
swixter claude create local \
  --provider ollama \
  --base-url http://localhost:11434/v1 \
  --model llama3
```

**Setup:** Install [Ollama](https://ollama.com), pull a model (`ollama pull llama3`), then create a Swixter profile. Ollama runs on port 11434 by default; the API path is `/v1` for OpenAI-compatible endpoints.

**API key:** Ollama does not require an API key. Leave it empty or set a placeholder -- Swixter uses `OLLAMA_API_KEY` as the env variable name for compatibility.

**Compatibility:** Works with Claude Code, Codex, and Continue.dev. For Codex, the env_key defaults to `OLLAMA_API_KEY` but can be overridden with `--env-key`.

### OpenAI-Compatible (Built-in `custom`)

The built-in `custom` provider works with any OpenAI-compatible Chat Completions API. It is compatible with all coders.

| Field | Value |
|-------|-------|
| Provider ID | `custom` |
| Wire API | `chat` |
| Default Base URL | `https://api.openai.com/v1` |
| Env Key | `OPENAI_API_KEY` |

```bash
# Create a profile using OpenAI
swixter claude create openai-profile \
  --provider custom \
  --api-key sk-... \
  --base-url https://api.openai.com/v1 \
  --model gpt-4o
```

**Supported services:** Any service with an OpenAI-compatible `/v1/chat/completions` endpoint works, including:

| Service | Base URL |
|---------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Together AI | `https://api.together.xyz/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| Fireworks | `https://api.fireworks.ai/inference/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |

**Compatibility:** Works with all coders. For Codex, customize the env_key with `--env-key` (e.g., `--env-key GROQ_API_KEY`).

### User-Defined Providers

You can define your own reusable providers for any API endpoint using `swixter providers add`.

```bash
swixter providers add my-api \
  --name "My API" \
  --base-url https://api.example.com/v1 \
  --wire-api chat \
  --env-key MY_API_KEY
```

User-defined providers are stored in `~/.config/swixter/providers.json` and appear in the provider list when creating profiles. Providers with the same ID as a built-in provider take precedence, allowing you to override defaults.

| Wire API | Protocol | Best For |
|----------|----------|----------|
| `chat` | OpenAI Chat Completions | Codex, Continue.dev, maximum compatibility |
| `responses` | Anthropic Responses | Claude Code with Anthropic-compatible APIs |

Choose `chat` for maximum compatibility across all coders.
