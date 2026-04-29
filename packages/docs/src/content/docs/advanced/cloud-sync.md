---
title: Cloud Sync Details
description: Advanced cloud sync configuration, encryption, conflict resolution, and troubleshooting.
---

# Cloud Sync Details

Cloud Sync encrypts and synchronizes your Swixter profiles across machines via a secure API.

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
