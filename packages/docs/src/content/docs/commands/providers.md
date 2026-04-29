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
