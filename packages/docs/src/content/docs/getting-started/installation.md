---
title: Installation
description: Install Swixter on Linux, macOS, or Windows.
---

import { Tabs, TabItem } from '@astrojs/starlight/components';

# Installation

Swixter is distributed as an npm package and requires **Node.js >= 18.0.0**.

## Quick Install

```bash
npm install -g swixter
```

Verify the installation:

```bash
swixter version
```

## Prerequisites

| Requirement | Version |
|-------------|---------|
| Node.js | >= 18.0.0 |
| npm | >= 9.0.0 (ships with Node) |

<Tabs>
<TabItem label="Check Node version">

```bash
node --version
# Should output: v18.x.x or higher
```

</TabItem>
<TabItem label="Install Node via nvm">

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20
nvm use 20
```

</TabItem>
</Tabs>

## Platform Notes

### macOS / Linux

Swixter stores its configuration in `~/.config/swixter/`. No additional setup required.

### Windows

Swixter stores its configuration in `~/swixter/` (e.g., `C:\Users\name\swixter\`). Works with PowerShell, Command Prompt, and Git Bash.

See the [Windows compatibility guide](/advanced/windows) for details.

## Installing the Managed Coders

Swixter manages profiles for different AI coding tools. You'll need at least one coder CLI installed:

```bash
# Claude Code
swixter claude install

# Codex
swixter codex install

# Continue.dev VS Code extension (install via VS Code marketplace)
```

Each coder's `install` and `update-cli` commands use the recommended installation method for your platform.

## Shell Completions

Generate shell completions for bash, zsh, or fish:

```bash
swixter completions zsh > ~/.zfunc/_swixter
```

Or source directly in your shell config:

```bash
# Add to ~/.zshrc
source <(swixter completions zsh)
```

## Next Steps

Continue to [Quick Start](/getting-started/quick-start) to create your first profile.
