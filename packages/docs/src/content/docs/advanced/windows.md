---
title: Windows Compatibility
description: Using Swixter on Windows — configuration paths, platform notes, and tips.
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

# Windows Compatibility

Swixter is ~90% compatible with Windows out of the box. All core CLI functionality works identically across platforms.

## Configuration Paths

Swixter uses a different config path on Windows for simplicity:

<Tabs>
<TabItem label="Swixter Config">

| Platform | Path |
|----------|------|
| **Windows** | `C:\Users\<username>\swixter\config.json` |
| **macOS/Linux** | `~/.config/swixter/config.json` |

</TabItem>
<TabItem label="Claude Code">

| Platform | Path |
|----------|------|
| **Windows** | `C:\Users\<username>\.claude\settings.json` |
| **macOS/Linux** | `~/.claude/settings.json` |

</TabItem>
<TabItem label="Codex">

| Platform | Path |
|----------|------|
| **Windows** | `C:\Users\<username>\.codex\config.toml` |
| **macOS/Linux** | `~/.codex/config.toml` |

Note: Codex recommends WSL for best Windows experience.

</TabItem>
<TabItem label="Continue.dev">

| Platform | Path |
|----------|------|
| **Windows** | `C:\Users\<username>\.continue\config.yaml` |
| **macOS/Linux** | `~/.continue/config.yaml` |

</TabItem>
</Tabs>

## Installation on Windows

```powershell
# npm (global)
npm install -g swixter

# or from source
git clone https://github.com/dawnswwwww/swixter.git
cd swixter
bun install
bun run build
```

## Limitations

### Shell Completions
- Bash, Zsh, and Fish completions are available
- PowerShell completion is not yet supported
- Workaround: Use Git Bash or WSL

### E2E Testing
- Docker-based tests require Docker Desktop + WSL2
- Native Windows test suite planned for future release

## Design Principles

Swixter uses cross-platform APIs throughout:

- `os.homedir()` — correct home directory on all platforms
- `path.join()` — proper path separators automatically
- Pure JavaScript parsing libraries (`smol-toml`, `js-yaml`) — no native deps

```typescript
// How Swixter handles cross-platform paths
import { homedir, platform } from "node:os";
import { join } from "node:path";

const configDir = platform() === "win32"
  ? join(homedir(), "swixter")
  : join(homedir(), ".config", "swixter");
```

## Common Issues

### `chmod: command not found`

The build script includes `chmod +x` which isn't available on Windows. This is harmless — the build succeeds without it.

### Shell completions not working in PowerShell

PowerShell completion is not yet implemented. Use Git Bash or WSL as alternatives.

### Path separator confusion

Always use `path.join()` instead of string concatenation with `/` or `\`:

```typescript
// Correct
const configPath = join(homedir(), ".claude", "settings.json");

// Avoid
const configPath = `${homedir()}/.claude/settings.json`;
```
