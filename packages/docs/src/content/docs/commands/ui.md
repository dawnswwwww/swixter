---
title: Web UI
description: Launch and use the Swixter Web UI for visual profile management.
---

# Web UI

Swixter includes a local web interface for managing profiles visually.

## `launch`

Start the Web UI server.

```bash
swixter ui
```

Opens a local web server (React + Vite) at `http://localhost:PORT`. The UI provides:

- **Dashboard**: Overview of all profiles, groups, and active configurations
- **Profile Editor**: Create and edit profiles with form validation
- **Provider Manager**: Add and manage custom providers
- **Coder Status**: See which coders have active profiles
- **Sync Status**: Cloud sync status and controls

## Features

### Visual Profile Management
- Drag-and-drop profile reordering
- Visual provider selection with details
- Copy profiles between coders
- Bulk operations on groups

### Real-Time Status
- See which profiles are active
- Proxy status and logs
- Sync status and history

### Configuration
Web UI settings are in `~/.config/swixter/config.json`:

```json
{
  "ui": {
    "port": 0,
    "openBrowser": true
  }
}
```

| Option | Description | Default |
|--------|-------------|---------|
| `port` | Port for the web server (0 = auto) | `0` |
| `openBrowser` | Auto-open browser on launch | `true` |
