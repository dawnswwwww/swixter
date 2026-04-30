# Docs Sidebar Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the Starlight docs sidebar — merge provider pages, merge sync pages, merge proxy pages, add Reference group with changelog, delete 7 stale files.

**Architecture:** Content-only change. Modify 3 doc pages (expand providers, sync, proxy), delete 7 stale pages, update 1 sidebar config in astro.config.mjs. No code changes, no dependencies.

**Tech Stack:** Astro Starlight, Markdown/MDX, JavaScript (astro.config.mjs)

---

### Task 1: Merge provider pages into commands/providers.md

**Files:**
- Modify: `packages/docs/src/content/docs/commands/providers.md`
- Delete: `packages/docs/src/content/docs/providers/anthropic.md`
- Delete: `packages/docs/src/content/docs/providers/ollama.md`
- Delete: `packages/docs/src/content/docs/providers/openai.md`
- Delete: `packages/docs/src/content/docs/providers/custom.md`

- [ ] **Step 1: Add supported providers section to commands/providers.md**

Replace the entire file content with the expanded version that includes a "Supported Providers" section after the Wire API Types table:

```markdown
---
title: Providers
description: Manage AI providers in Swixter — list, add, show, and remove providers.
---

# Providers

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

### Anthropic

| Field | Value |
|-------|-------|
| Provider ID | `anthropic` |
| Wire API | `responses` |
| Default Base URL | `https://api.anthropic.com` |
| Env Key | `ANTHROPIC_API_KEY` |

```bash
swixter claude create my-profile \
  --provider anthropic \
  --api-key sk-ant-api03-... \
  --model claude-sonnet-4-6
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/). Compatible only with Claude Code. Not compatible with Codex (requires `wire_api: "chat"`).

### Ollama

| Field | Value |
|-------|-------|
| Provider ID | `ollama` |
| Wire API | `chat` |
| Default Base URL | `http://localhost:11434/v1` |
| Env Key | `OLLAMA_API_KEY` |

```bash
swixter claude create local \
  --provider ollama \
  --base-url http://localhost:11434/v1 \
  --model llama3
```

Ollama doesn't require an API key by default. Compatible with all coders.

### OpenAI-Compatible (custom)

| Field | Value |
|-------|-------|
| Provider ID | `custom` |
| Wire API | `chat` |
| Default Base URL | `https://api.openai.com/v1` |
| Env Key | `OPENAI_API_KEY` |

Works with any OpenAI-compatible API:

| Service | Base URL |
|---------|----------|
| OpenAI | `https://api.openai.com/v1` |
| Groq | `https://api.groq.com/openai/v1` |
| Together AI | `https://api.together.xyz/v1` |
| DeepSeek | `https://api.deepseek.com/v1` |
| OpenRouter | `https://openrouter.ai/api/v1` |

```bash
swixter claude create openai-profile \
  --provider custom \
  --api-key sk-... \
  --base-url https://api.openai.com/v1 \
  --model gpt-4o
```

Compatible with all coders.

### Custom User-Defined Providers

User-defined providers let you define reusable configurations for any API endpoint:

```bash
swixter providers add my-api \
  --name "My API" \
  --base-url https://api.example.com/v1 \
  --wire-api chat \
  --env-key MY_API_KEY
```

User-defined providers with the same ID as a built-in provider take precedence, allowing customization of default behavior.

Provider data is stored in `~/.config/swixter/providers.json`:

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

Choose `chat` for maximum compatibility across all coders. Use `responses` only for Anthropic-compatible APIs targeting Claude Code.
```

- [ ] **Step 2: Delete the 4 individual provider pages**

```bash
rm packages/docs/src/content/docs/providers/anthropic.md
rm packages/docs/src/content/docs/providers/ollama.md
rm packages/docs/src/content/docs/providers/openai.md
rm packages/docs/src/content/docs/providers/custom.md
```

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/content/docs/commands/providers.md
git add packages/docs/src/content/docs/providers/
git commit -m "docs: merge provider pages into single providers page"
```

---

### Task 2: Merge sync pages into advanced/cloud-sync.md

**Files:**
- Modify: `packages/docs/src/content/docs/advanced/cloud-sync.md`
- Delete: `packages/docs/src/content/docs/commands/sync.md`

- [ ] **Step 1: Prepend sync command reference to advanced/cloud-sync.md**

Insert the command reference content from `commands/sync.md` at the top of `advanced/cloud-sync.md`, after the frontmatter and heading. Read the current file, then replace the entire content with the merged version:

```markdown
---
title: Cloud Sync
description: Sync your Swixter profiles across machines — commands, encryption, conflict resolution, and troubleshooting.
---

# Cloud Sync

Cloud Sync keeps your Swixter profiles synchronized across multiple machines.

## Commands

### `login`

Authenticate with the Swixter sync service.

```bash
swixter sync login
```

Opens a browser for authentication. After login, your profiles are automatically synced.

### `logout`

Sign out and stop syncing.

```bash
swixter sync logout
```

Local profiles are preserved after logout.

### `status`

Check sync status.

```bash
swixter sync status
```

Shows:
- Login status
- Last sync time
- Number of synced profiles
- Any sync errors

### `push`

Manually push local changes.

```bash
swixter sync push
```

### `pull`

Manually pull remote changes.

```bash
swixter sync pull
```

### Auto-Sync

Once logged in, Swixter automatically syncs:
- When you create, edit, or delete a profile
- When you switch active profiles
- On a configurable interval

Auto-sync can be configured in `~/.config/swixter/config.json`:

```json
{
  "sync": {
    "autoSync": true,
    "interval": 300
  }
}
```

## How It Works

1. **Profiles are encrypted** locally before upload
2. **Encrypted data** is sent to the Swixter sync API
3. **Other machines** pull and decrypt changes
4. **Conflict resolution** determines which version wins when profiles change on multiple machines

## Configuration

```json
{
  "sync": {
    "autoSync": true,
    "interval": 300,
    "conflictStrategy": "lastWriteWins",
    "endpoint": "https://sync.swixter.cc"
  }
}
```

| Option | Description | Default |
|--------|-------------|---------|
| `autoSync` | Automatically sync on profile changes | `true` |
| `interval` | Background sync interval in seconds | `300` |
| `conflictStrategy` | How to resolve conflicts | `"lastWriteWins"` |
| `endpoint` | Sync API endpoint | `"https://sync.swixter.cc"` |

## Encryption

Profiles are encrypted using AES-256-GCM before transmission:

- **Key derivation**: PBKDF2 with 100,000 iterations
- **Master key**: Derived from your authentication token
- **Per-profile IV**: Unique initialization vector for each profile

API keys in profiles are encrypted at rest on the server. The server never sees plaintext API keys.

## Conflict Resolution

When the same profile is modified on two machines before syncing:

| Strategy | Behavior |
|----------|----------|
| `lastWriteWins` | Most recent modification takes precedence |
| `manual` | Prompt user to choose which version to keep |

### Manual Resolution

When `manual` strategy is active, conflicting profiles appear in:

```bash
swixter sync status
# Shows: 2 profiles with conflicts
```

Review and resolve:

```bash
swixter sync resolve <profile-name>
# Shows diff between versions
# Choose: local / remote / merge
```

## Sync Scope

The following data is synced:

- Profiles (API keys, provider settings, models)
- Active profile assignments per coder
- User-defined providers
- Groups

Not synced:

- Coder CLI installations (use `swixter <coder> install` on each machine)
- Proxy configuration
- Web UI preferences

## Troubleshooting

### Sync not working

```bash
# Check status
swixter sync status

# Force re-authentication
swixter sync logout
swixter sync login
```

### Profile not appearing on other machine

```bash
# Force a pull
swixter sync pull

# Check for conflicts
swixter sync status
```

### Reset sync state

```bash
swixter sync logout
# This removes auth tokens. Local profiles are preserved.
swixter sync login
# Re-authenticate and re-sync.
```

## Self-Hosted Sync

For teams or users who want to run their own sync server, the sync endpoint can be customized:

```json
{
  "sync": {
    "endpoint": "https://sync.my-company.com"
  }
}
```

The sync API is a Workers-compatible REST API. See the [Swixter GitHub repository](https://github.com/dawnswwwww/swixter) for API documentation.
```

- [ ] **Step 2: Delete the old commands/sync.md**

```bash
rm packages/docs/src/content/docs/commands/sync.md
```

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/content/docs/advanced/cloud-sync.md
git add packages/docs/src/content/docs/commands/sync.md
git commit -m "docs: merge sync command reference into cloud-sync page"
```

---

### Task 3: Merge proxy pages into commands/proxy.md

**Files:**
- Modify: `packages/docs/src/content/docs/commands/proxy.md`
- Delete: `packages/docs/src/content/docs/advanced/proxy.md`

- [ ] **Step 1: Append advanced proxy content to commands/proxy.md**

Replace the "See Also" section at the end of `commands/proxy.md` (lines 82-84) with the full advanced content from `advanced/proxy.md`. Replace the entire file with the merged version:

```markdown
---
title: Proxy Gateway
description: Configure and use the Swixter proxy gateway to route and monitor AI API requests.
---

# Proxy Gateway

Swixter includes a local proxy gateway that can intercept and route API requests from AI coders.

## Commands

### `start`

Start the proxy server.

```bash
swixter proxy start
```

The proxy listens on a local port (default: auto-assigned) and forwards requests to the configured provider's API. This lets you:

- **Inspect traffic**: View request/response logs
- **Switch backends**: Change the provider without restarting the coder
- **Add headers**: Inject custom authentication or routing headers

### `stop`

Stop the running proxy server.

```bash
swixter proxy stop
```

### `status`

Check if the proxy is running.

```bash
swixter proxy status
```

Shows which coders are connected, the proxy port, and the active backend.

### `logs`

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
    "host": "127.0.0.1",
    "autoStart": false,
    "logLevel": "info",
    "timeout": 30000,
    "maxBodyLogSize": 4096,
    "headers": {}
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

Useful for API gateway routing keys, usage tracking, and custom authentication middleware.

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
```

- [ ] **Step 2: Delete the old advanced/proxy.md**

```bash
rm packages/docs/src/content/docs/advanced/proxy.md
```

- [ ] **Step 3: Commit**

```bash
git add packages/docs/src/content/docs/commands/proxy.md
git add packages/docs/src/content/docs/advanced/proxy.md
git commit -m "docs: merge advanced proxy content into proxy gateway page"
```

---

### Task 4: Update sidebar config in astro.config.mjs

**Files:**
- Modify: `packages/docs/astro.config.mjs:60-99`

- [ ] **Step 1: Replace the sidebar array**

Replace the entire `sidebar` array in `packages/docs/astro.config.mjs` (lines 60-99) with the new structure:

```javascript
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { slug: 'getting-started/installation' },
            { slug: 'getting-started/quick-start' },
            { slug: 'getting-started/configuration' },
          ],
        },
        {
          label: 'Commands',
          items: [
            { slug: 'commands/claude' },
            { slug: 'commands/codex' },
            { slug: 'commands/qwen' },
            { slug: 'commands/providers' },
            { slug: 'commands/groups' },
            { slug: 'commands/proxy' },
            { slug: 'commands/ui' },
          ],
        },
        {
          label: 'Advanced',
          items: [
            { slug: 'advanced/cloud-sync' },
            { slug: 'advanced/windows' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'reference/changelog' },
          ],
        },
      ],
```

- [ ] **Step 2: Commit**

```bash
git add packages/docs/astro.config.mjs
git commit -m "docs: update sidebar config with reorganized menu structure"
```

---

### Task 5: Build and verify

**Files:** None (verification only)

- [ ] **Step 1: Build the docs package**

```bash
cd packages/docs && bun run build
```
Expected: Build completes without errors.

- [ ] **Step 2: Verify no broken links in build output**

```bash
ls packages/docs/dist/
```
Expected: `dist/` directory exists with built HTML files.

- [ ] **Step 3: Commit any fixups if needed, otherwise done**

---

## Deletion Summary

These 7 files are removed across Tasks 1-3:

| File | Task |
|------|------|
| `providers/anthropic.md` | Task 1 |
| `providers/ollama.md` | Task 1 |
| `providers/openai.md` | Task 1 |
| `providers/custom.md` | Task 1 |
| `commands/sync.md` | Task 2 |
| `advanced/proxy.md` | Task 3 |

After deletion, the empty directories `providers/` can optionally be removed (Task 1 will leave it empty; git does not track empty directories).
