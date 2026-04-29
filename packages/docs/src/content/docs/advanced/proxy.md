---
title: Proxy Advanced Usage
description: Advanced proxy gateway configuration, custom routing, and monitoring.
---

# Proxy Advanced Usage

The Swixter proxy gateway supports advanced routing, header injection, and traffic monitoring beyond the basic usage covered in [Proxy Gateway commands](/commands/proxy).

## Architecture

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
| `headers` | Additional headers to inject | `{}` |

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
