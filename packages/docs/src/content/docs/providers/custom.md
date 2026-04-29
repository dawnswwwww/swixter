---
title: Custom Providers
description: Define custom AI providers in Swixter for any API endpoint.
---

# Custom Providers

Custom providers let you define reusable configurations for any API endpoint.

## Adding a Custom Provider

```bash
swixter providers add <id>
```

The interactive prompt asks for name, base URL, wire API type, and default env_key.

### Non-Interactive

```bash
swixter providers add my-api \
  --name "My API" \
  --base-url https://api.example.com/v1 \
  --wire-api chat \
  --env-key MY_API_KEY
```

## Managing Custom Providers

```bash
# List all (built-in + user-defined)
swixter providers list

# Show details
swixter providers show my-api

# Remove
swixter providers remove my-api
```

## Provider Schema

User-defined providers are stored in `~/.config/swixter/providers.json`:

```json
{
  "providers": [
    {
      "id": "my-api",
      "name": "My API",
      "baseUrl": "https://api.example.com/v1",
      "wireApi": "chat",
      "envKey": "MY_API_KEY"
    }
  ]
}
```

## Overriding Built-in Providers

User-defined providers with the same ID as a built-in provider take precedence. This lets you customize the default behavior:

```bash
# Override the custom provider's default base URL
swixter providers add custom \
  --name "OpenAI" \
  --base-url https://my-proxy.example.com/v1 \
  --wire-api chat \
  --env-key OPENAI_API_KEY
```

## Wire API Field

| Value | Protocol | Use Case |
|-------|----------|----------|
| `chat` | OpenAI Chat Completions | Codex, Continue.dev, most providers |
| `responses` | Anthropic Responses | Claude Code with Anthropic |

Choose `chat` for maximum compatibility across all coders. Use `responses` only if you're targeting Claude Code with an Anthropic-compatible API.

## Using a Custom Provider

Once created, your custom provider appears in the provider list when creating profiles:

```bash
swixter claude create my-profile
# -> Select provider: ... my-api
```

Or skip the prompt:

```bash
swixter claude create my-profile --provider my-api --api-key xxx
```
