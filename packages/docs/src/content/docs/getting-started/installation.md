---
title: Installation
description: Install Swixter on Linux, macOS, or Windows.
---

# Installation

Swixter is a single native binary — no Node.js or other runtime required. Pick whichever channel fits your setup.

## Quick Install

```bash
# Shell installer (macOS / Linux)
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/dawnswwwww/swixter/releases/latest/download/swixter-installer.sh | sh
# Installs to ~/.cargo/bin; make sure it is on your PATH

# Homebrew
brew install dawnswwwww/tap/swixter

# npm (downloads the platform binary from GitHub Releases at install time;
# use the shell installer instead in --ignore-scripts environments)
npm install -g swixter

# Cargo
cargo install swixter

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "irm https://github.com/dawnswwwww/swixter/releases/latest/download/swixter-installer.ps1 | iex"
```

Verify the installation:

```bash
swixter version
```

Prebuilt binaries are published for Linux (x86_64/aarch64, gnu & musl), macOS (Apple Silicon/Intel), and Windows (x86_64 MSVC).

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
