# Cloud Sync Design

## Overview

Add optional cloud sync to Swixter, allowing users to sync their full configuration (profiles, coder preferences, groups, user-defined providers) across devices. Features user authentication (email+password, magic link, OAuth) with end-to-end encryption for sensitive fields (API keys, auth tokens).

## Requirements

- **Sync scope**: Full config — profiles, coder preferences, groups, user-defined providers
- **Security**: End-to-end encryption for sensitive fields (API keys, auth tokens), server never sees plaintext secrets
- **Auth methods**: Email+password, magic link, OAuth (GitHub/Google) — all supported from day one
- **Sync modes**: Manual (`swixter sync push/pull`) and automatic (on config save/load)
- **Target scale**: Personal/small-scale, zero-cost within free tiers
- **Optional**: Login and sync are entirely optional, no impact on existing functionality when not logged in

## Architecture

```
┌─────────────┐         ┌──────────────────────┐         ┌─────────┐
│  Swixter CLI │  HTTPS  │  Cloudflare Workers   │   API   │  D1 DB  │
│  (客户端)     │ ◄─────► │  (API 服务)           │ ◄─────► │ (存储)   │
└─────────────┘         └──────────────────────┘         └─────────┘
```

- **Cloudflare Workers + D1**: Independent API service, deployed via `wrangler deploy`
- **Workers framework**: Hono (lightweight, designed for Cloudflare Workers)
- **Separate repository**: `swixter-cloud` repo, not part of main swixter package
- **CLI never accesses D1 directly**: All requests go through Workers API

### Workers API Routes

```
POST /api/auth/register         # Register with email+password
POST /api/auth/login            # Login with email+password
POST /api/auth/magic-link/send  # Send magic link email
POST /api/auth/magic-link/verify # Verify magic link token
GET  /api/auth/oauth/:provider  # Redirect to OAuth provider
GET  /api/auth/oauth/:provider/callback  # OAuth callback
POST /api/auth/refresh          # Refresh access token
POST /api/auth/logout           # Revoke session

GET    /api/sync/status         # Get remote versions and timestamps
GET    /api/sync/pull           # Pull encrypted config data
POST   /api/sync/push           # Push encrypted config data (with optimistic locking)
DELETE /api/sync/data           # Delete all synced data (keep account)
```

**Middleware**: JWT verification on all `/api/sync/*` routes. Rate limiting via KV (30 requests/minute per user).

## Database Schema (D1 / SQLite)

### users

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  encryption_salt TEXT NOT NULL,  -- PBKDF2 salt for E2E encryption
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### credentials (email+password auth)

```sql
CREATE TABLE credentials (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id)
);
```

One-to-one with users. Absent for OAuth-only users.

### oauth_accounts (GitHub/Google auth)

```sql
CREATE TABLE oauth_accounts (
  provider TEXT NOT NULL,
  provider_uid TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (provider, provider_uid)
);
```

One user can have multiple OAuth providers.

### magic_link_tokens (magic link auth)

```sql
CREATE TABLE magic_link_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Single-use, 10-minute expiry. Periodic cleanup of expired tokens.

### sessions (unified across all auth methods)

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash TEXT UNIQUE NOT NULL,
  auth_method TEXT NOT NULL,  -- 'password', 'magic_link', 'github', 'google'
  device_info TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

All three auth methods converge here: JWT is issued with `user_id` only, regardless of login method.

### sync_data (encrypted user config)

```sql
CREATE TABLE sync_data (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  data_key TEXT NOT NULL,        -- 'config' or 'providers'
  encrypted_data TEXT NOT NULL,
  data_version INTEGER NOT NULL,
  client_timestamp TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, data_key)
);
```

`data_version` enables optimistic locking for conflict detection.

## Authentication Design

### Unified Auth Flow

All three methods converge to the same outcome: JWT access_token + refresh_token written to sessions table.

```
Email+Password:  email+password → verify credentials → issue JWT
Magic Link:      email → generate token → send email → user enters code → issue JWT
OAuth:           open browser → provider auth → callback → find/create oauth_account → issue JWT
```

### JWT & Token Management

- **Access token**: 7-day expiry, carried in `Authorization: Bearer <token>` header
- **Refresh token**: 30-day expiry, stored hashed in sessions table
- **Auto-refresh**: CLI checks expiry before each request, transparently refreshes
- **Refresh failure**: Clear local auth.json, prompt user to re-login

### Local Auth State (`~/.config/swixter/auth.json`)

```json
{
  "accessToken": "eyJ...",
  "refreshToken": "...",
  "encryptionKey": "base64-encoded-derived-key",
  "authMethod": "password",
  "expiresAt": "2026-04-29T10:00:00Z"
}
```

`encryptionKey` is optional — only present when user chooses "remember encryption key". If absent, user must enter master password before each sync operation.

### OAuth Flow in CLI

1. CLI starts a temporary local HTTP server on a random port
2. Opens browser to `/api/auth/oauth/github?callback=http://localhost:<port>`
3. User authorizes on GitHub/Google
4. Workers callback redirects to local server with tokens
5. CLI receives tokens, stores in auth.json

## End-to-End Encryption

### Scheme

```
Master password (user-chosen, separate from login password)
      │
      ▼
  PBKDF2 (salt from users table, 100K iterations)
      │
      ▼
  AES-256-GCM derived key
      │
      ├── encrypt: plaintext field → IV + ciphertext + auth tag
      └── decrypt: IV + ciphertext + auth tag → plaintext field
```

### What Gets Encrypted

Only sensitive fields are encrypted per-field. Non-sensitive config is synced in plaintext.

**Encrypted fields**: `apiKey`, `authToken`
**Plaintext fields**: everything else (providerId, baseURL, model, groups, coder preferences, etc.)

### Benefits of Field-Level Encryption

1. Server can see config structure for debugging/status display without seeing secrets
2. Conflict resolution works on plaintext fields without needing decryption
3. Lost encryption key only requires re-entering API keys, not losing entire config

### Encryption Salt

Generated at registration, stored in `users.encryption_salt` (plaintext, not secret). Same salt used across all devices — user only needs master password to derive the key.

## Sync Flow

### Push (local → cloud)

```
1. Load local config.json + providers.json
2. Encrypt sensitive fields (apiKey, authToken)
3. GET /api/sync/status → get remote data_version
4. Compare local sync_version with remote data_version
   ├── Match (no conflict) → POST /api/sync/push → data_version + 1
   └── Mismatch (conflict) → enter conflict resolution
```

### Pull (cloud → local)

```
1. GET /api/sync/pull → get encrypted data + data_version
2. Decrypt sensitive fields
3. Compare with local config
   ├── Local unchanged since last sync → overwrite directly
   └── Local changed since last sync → enter conflict resolution
4. Write merged config to local files, update sync_version
```

### Conflict Resolution

**Manual sync** (default):
- `--force-local`: Local overwrites remote
- `--force-remote`: Remote overwrites local
- Default (no flag): Field-level merge — newer timestamp wins for non-sensitive fields, local wins for sensitive fields when both sides have values

**Auto sync**:
- Silent local-first strategy — don't interrupt user workflow
- Log conflicts to `~/.config/swixter/sync-log.json` for later review

### Version Tracking (syncMeta in config.json)

```json
{
  "syncMeta": {
    "lastSyncAt": "2026-04-22T10:00:00Z",
    "configVersion": 15,
    "providersVersion": 8,
    "localUpdatedAt": "2026-04-22T09:30:00Z"
  }
}
```

`syncMeta` is optional (`syncMeta?` in TypeScript). Old config files without it work fine.

### Auto Sync

Enabled via `swixter sync enable`. Hooks into existing ConfigManager:

- **On save**: `saveConfig()` → write file → if auto-sync on → push
- **On load**: if auto-sync on → pull → then `loadConfig()` reads file

Auto sync wraps existing functions, does not change their interfaces.

## CLI Commands

### Auth Commands

```
swixter auth register                  # Register with email+password
swixter auth login                     # Login (interactive, or --email / --github / --google)
swixter auth login --email             # Force email login
swixter auth login --github            # Login via GitHub OAuth
swixter auth login --google            # Login via Google OAuth
swixter auth logout                    # Revoke session, clear local tokens
swixter auth status                    # Show current login state
swixter auth delete-account            # Delete cloud data and account
```

### Sync Commands

```
swixter sync push                      # Push local config to cloud
swixter sync push --force-local        # Force push, overwrite remote
swixter sync pull                      # Pull cloud config to local
swixter sync pull --force-remote       # Force pull, overwrite local
swixter sync status                    # Show sync state (local vs remote versions)
swixter sync enable                    # Enable auto sync
swixter sync disable                   # Disable auto sync
```

## Code Structure (Swixter Main Repo)

### New Files

```
src/
├── auth/
│   ├── client.ts        # Auth API client (login, register, refresh, etc.)
│   ├── oauth.ts         # OAuth flow (local callback server, token exchange)
│   ├── token.ts         # Local token management (read/write auth.json, auto-refresh)
│   └── types.ts         # Auth type definitions
│
├── sync/
│   ├── client.ts        # Sync API client (push, pull, status)
│   ├── conflict.ts      # Conflict detection and resolution
│   ├── merge.ts         # Config merging (field-level comparison, timestamp strategy)
│   ├── auto-sync.ts     # Auto sync hooks (wrap saveConfig / loadConfig)
│   └── types.ts         # Sync type definitions
│
├── crypto/
│   ├── derive.ts        # PBKDF2 key derivation
│   ├── encrypt.ts       # AES-256-GCM encrypt/decrypt
│   └── fields.ts        # Sensitive field identification and batch encrypt/decrypt
│
├── cli/
│   ├── auth.ts          # swixter auth * command handlers
│   └── sync.ts          # swixter sync * command handlers
```

### Existing Files Modified

| File | Change |
|------|--------|
| `src/config/manager.ts` | Add optional sync hooks around saveConfig/loadConfig |
| `src/cli/index.ts` | Add `auth` and `sync` command routing |
| `src/types.ts` | Add `SyncMeta` type, extend `ConfigFile` with optional `syncMeta` |
| `src/cli/help.ts` | Add help text for auth/sync commands |
| `src/cli/completions.ts` | Add shell completions for new commands |
| `src/constants/messages.ts` | Add auth/sync UI messages |

### No New npm Dependencies

- HTTP: Bun built-in `fetch`
- Crypto: Web Crypto API (built into Bun/Node)
- All encryption primitives are platform-native

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Network unavailable | Show "network error, check connection", no impact on local operations |
| Access token expired | Auto-refresh with refresh token |
| Refresh token expired | Clear auth.json, prompt re-login |
| Push version conflict (HTTP 409) | Prompt user to choose --force-local / --force-remote / pull first |
| Server error (5xx) | Show "service temporarily unavailable, try again later" |
| Encryption key lost | Config structure preserved, sensitive fields empty, prompt user to re-enter API keys |
| Corrupted local config | Zod validation before push, reject invalid data |

## Testing Strategy

### Unit Tests (Swixter main repo, `tests/`)

- `tests/crypto/derive.test.ts` — PBKDF2 key derivation consistency
- `tests/crypto/encrypt.test.ts` — AES-256-GCM encrypt/decrypt round-trip
- `tests/crypto/fields.test.ts` — Sensitive field identification, batch operations
- `tests/sync/merge.test.ts` — Field-level merge with timestamp comparison
- `tests/sync/conflict.test.ts` — Version conflict detection
- `tests/auth/token.test.ts` — Token refresh, expiry handling

### Workers API Tests (swixter-cloud repo)

- Vitest + Miniflare for local Cloudflare Workers simulation
- Test all API endpoints, JWT verification, rate limiting, optimistic locking

### Integration Tests

- Test server simulating Workers API
- Full CLI push/pull round-trip tests

## Edge Cases

| Case | Handling |
|------|----------|
| New device | login → pull → enter master password to decrypt → config restored |
| Delete account | `swixter auth delete-account` → API deletes remote data → clear local auth.json |
| Offline use | No impact, core Swixter features work without cloud |
| Corrupted config | Zod validation rejects push, sync rejects invalid data |
| Multiple devices, rapid switching | Optimistic locking (data_version) prevents data loss |

## Cloudflare Workers Free Tier Limits

| Resource | Free Tier | Expected Usage |
|----------|-----------|----------------|
| Requests | 100K/day | < 1K/day for small scale |
| D1 storage | 5 GB | < 10 MB for thousands of users |
| D1 reads | 5M/day | < 50K/day |
| D1 writes | 100K/day | < 5K/day |
| KV reads | 100K/day | Rate limiting only |
| KV writes | 1K/day | Rate limiting only |

All well within free tier for personal/small-scale use.

## Implementation Order

1. **Crypto module** — foundation for everything else, no external dependencies
2. **Workers API (auth)** — register, login, token management in swixter-cloud repo
3. **Auth module (CLI)** — client, token management, auth commands
4. **Workers API (sync)** — push, pull, status endpoints
5. **Sync module (CLI)** — client, merge, conflict resolution, sync commands
6. **Auto sync** — hooks into ConfigManager
7. **OAuth support** — GitHub/Google flows (can be deferred)
8. **Magic link support** — email-based passwordless login (can be deferred)
