---
title: Proxy Gateway
description: Configure and use the Swixter proxy gateway to route AI API requests.
---

# Proxy Gateway

Swixter includes a local proxy gateway that can intercept and route API requests from AI coders.

## `start`

Start the proxy server.

```bash
swixter proxy start
```

The proxy listens on a local port (default: auto-assigned) and forwards requests to the configured provider's API. This lets you:

- **Inspect traffic**: View request/response logs
- **Switch backends**: Change the provider without restarting the coder
- **Add headers**: Inject custom authentication or routing headers

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
AI Coder → proxy (localhost:PORT) → Provider API
                ↓
          logs + monitoring
```

The proxy intercepts API calls from your AI coding assistant and forwards them to the actual provider. This enables transparent switching between providers without changing coder configuration.

## Configuration

Proxy settings are stored in `~/.config/swixter/config.json` under the `proxy` key:

```json
{
  "proxy": {
    "port": 0,
    "autoStart": false,
    "logLevel": "info"
  }
}
```

| Option | Description | Default |
|--------|-------------|---------|
| `port` | Port to listen on (0 = auto) | `0` |
| `autoStart` | Start proxy on profile apply | `false` |
| `logLevel` | Logging verbosity | `"info"` |

## See Also

- [Proxy advanced usage](/advanced/proxy) — custom routing and advanced configuration
