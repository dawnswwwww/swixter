---
title: Proxy Gateway
description: Configure and use the Swixter proxy gateway to route AI API requests, with automatic API format conversion, failover, and advanced configuration.
---

# Proxy Gateway

Swixter includes a local proxy gateway that can intercept and route API requests from AI coders. It supports **automatic API format conversion**, enabling Claude Code (Anthropic Messages API) to call OpenAI-compatible providers transparently.

## `start`

Start the proxy server.

```bash
swixter proxy start
```

The proxy listens on a local port (default: auto-assigned) and forwards requests to the configured provider's API. This lets you:

- **Inspect traffic**: View request/response logs
- **Switch backends**: Change the provider without restarting the coder
- **Add headers**: Inject custom authentication or routing headers
- **Format conversion**: Automatically convert between Anthropic Messages and OpenAI Chat Completions APIs

**Options:**

| Flag | Description |
|------|-------------|
| `--group <name>` | Use a specific failover group |
| `--profile <name>` | Use a single profile (gateway mode, no failover) |
| `--port <number>` | Custom listen port (default: auto-assigned) |
| `--daemon` | Run as background service |
| `--log-level <level>` | `debug`, `info`, `warn`, `error` |

## `stop`

Stop the running proxy server.

```bash
swixter proxy stop
```

## `status`

Check if the proxy is running.

```bash
swixter proxy status
```

Shows which coders are connected, the proxy port, and the active backend.

## `logs`

View proxy traffic logs.

```bash
swixter proxy logs
```

Shows recent requests with timing, status codes, and response sizes.

## How It Works

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│ AI Coder │ ──▶ │ Swixter Proxy│ ──▶ │ Provider API │
│ (client) │     │ (localhost)  │     │ (remote)     │
└──────────┘     └──────┬───────┘     └──────────────┘
                        │
                   ┌────▼────┐
                   │  Logger │
                   └─────────┘
```

The proxy intercepts API calls from your AI coding assistant and forwards them to the actual provider. This enables transparent switching between providers without changing coder configuration.

## Configuration

Full proxy configuration in `~/.config/swixter/config.json`:

```json
{
  "proxy": {
    "port": 18721,
    "host": "127.0.0.1",
    "autoStart": false,
    "logLevel": "debug",
    "timeout": 30000,
    "maxBodyLogSize": 4096,
    "headers": {
      "X-Custom-Header": "value"
    }
  }
}
```

| Option | Description | Default |
|--------|-------------|---------|
| `port` | Listen port (`0` = auto-assign) | `0` |
| `host` | Listen address | `"127.0.0.1"` |
| `autoStart` | Start proxy on profile apply | `false` |
| `logLevel` | `debug`, `info`, `warn`, `error` | `"info"` |
| `timeout` | Request timeout in ms | `30000` |
| `maxBodyLogSize` | Max bytes to log per request/response body | `4096` |
| `headers` | Additional headers to inject on all requests | `{}` |

## API Format Conversion

The proxy automatically converts between API formats based on the request endpoint and the target provider's supported format.

### How It Works

When Claude Code sends a request to `/v1/messages` (Anthropic Messages API) but the target provider expects OpenAI Chat Completions format, the proxy transparently converts:

```
Claude Code (Anthropic) ──▶ Proxy ──▶ Groq (OpenAI)
     /v1/messages              converts    /v1/chat/completions
     Anthropic format          request     OpenAI format
                               + response
```

**Supported conversions:**

| Client Format | Target Format | Direction |
|---------------|---------------|-----------|
| Anthropic Messages | OpenAI Chat Completions | Request + Response + SSE Streaming |

More conversions (OpenAI Responses, Gemini) will be added in future releases.

### Target Format Detection

The proxy infers the target format automatically:

1. **Profile-level override** — If `apiFormat` is set on the profile, it takes priority
2. **Provider `wire_api`** — `chat` → OpenAI Chat, `responses` → Anthropic Messages

To set a custom API format on a profile:

```bash
swixter claude create groq-local --provider groq --api-key $GROQ_KEY --api-format openai_chat
```

Or edit an existing profile:

```bash
swixter claude edit groq-local
# Select "API Format" and choose from the list
```

### Single-Profile Gateway Mode

Use `--profile` to start the proxy with a single profile, bypassing group failover logic. This is useful when you want to route all traffic through one provider with format conversion.

```bash
# Start proxy with a specific profile
swixter proxy start --profile groq-local --port 3456

# Claude Code will use http://localhost:3456/v1/messages
# Proxy converts to OpenAI Chat Completions and forwards to Groq
```

This mode does not use groups or circuit breakers — it forwards directly to the specified profile.

## Custom Routing

Route different models to different backends:

```json
{
  "proxy": {
    "routes": [
      {
        "match": { "model": "claude-*" },
        "upstream": "https://api.anthropic.com"
      },
      {
        "match": { "model": "gpt-*" },
        "upstream": "https://api.openai.com/v1"
      }
    ]
  }
}
```

Each route has:
- `match`: Criteria to match (`model`, `provider`)
- `upstream`: URL to forward matching requests to

## Header Injection

Add custom headers to proxied requests:

```json
{
  "proxy": {
    "headers": {
      "X-Environment": "development",
      "X-Request-Source": "swixter-proxy"
    }
  }
}
```

Useful for:
- API gateway routing keys
- Usage tracking per environment
- Custom authentication middleware

## Logging & Monitoring

### Log Levels

```bash
# Detailed debug output
swixter proxy start --log-level debug

# Production mode (errors only)
swixter proxy start --log-level error
```

### Log Format

Each request is logged with:

```json
{
  "timestamp": "2026-04-29T10:30:00.000Z",
  "method": "POST",
  "path": "/v1/messages",
  "status": 200,
  "duration_ms": 1234,
  "request_size": 2048,
  "response_size": 512
}
```

### Real-Time Logs

```bash
# Tail logs
swixter proxy logs --follow

# Filter by status code
swixter proxy logs --status 4xx

# Last 50 requests
swixter proxy logs --last 50
```

## Performance

The proxy adds minimal overhead (~1-5ms latency):

- Request/response body streaming (no buffering for large payloads)
- Connection pooling for upstream requests
- No TLS termination overhead (plain HTTP on localhost)

## Security

- Proxy binds to `127.0.0.1` by default (localhost only)
- No external network access
- Headers are sanitized (Hop-by-hop headers removed)
- Body logging truncation prevents sensitive data leaks in logs
