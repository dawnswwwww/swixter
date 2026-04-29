---
title: Cloud Sync
description: Sync your Swixter profiles across machines.
---

# Cloud Sync

Cloud Sync keeps your Swixter profiles synchronized across multiple machines.

## `login`

Authenticate with the Swixter sync service.

```bash
swixter sync login
```

Opens a browser for authentication. After login, your profiles are automatically synced.

## `logout`

Sign out and stop syncing.

```bash
swixter sync logout
```

Local profiles are preserved after logout.

## `status`

Check sync status.

```bash
swixter sync status
```

Shows:
- Login status
- Last sync time
- Number of synced profiles
- Any sync errors

## `push`

Manually push local changes.

```bash
swixter sync push
```

## `pull`

Manually pull remote changes.

```bash
swixter sync pull
```

## Auto-Sync

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

## See Also

- [Cloud Sync details](/advanced/cloud-sync) — encryption, conflict resolution, and troubleshooting
