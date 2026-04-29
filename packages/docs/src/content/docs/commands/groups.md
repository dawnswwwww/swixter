---
title: Groups
description: Manage profile groups for batch operations.
---

# Groups

Profile groups let you apply the same configuration across multiple coders at once.

## `create`

Create a new group.

```bash
swixter group create <name>
```

A group bundles profiles from different coders. When you switch to a group, it sets the specified profile as active for each coder simultaneously.

## `switch`

Set a group as active for all contained coders.

```bash
swixter group switch <name>
```

This sets the active profile for each coder in the group.

## `list`

List all groups.

```bash
swixter group list
```

## `apply`

Apply all profiles in the active group.

```bash
swixter group apply
```

Writes the active profile to each coder's config file.

## `edit`

Modify an existing group.

```bash
swixter group edit <name>
```

## `delete`

Remove a group.

```bash
swixter group delete <name>
```

## Example Workflow

```bash
# Create individual profiles
swixter claude create work-claude -p anthropic
swixter codex create work-codex -p ollama

# Group them
swixter group create work
# ... select claude=work-claude, codex=work-codex

# Apply all at once
swixter group switch work
swixter group apply
```
