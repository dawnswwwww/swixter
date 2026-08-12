# Windows Compatibility Guide

> **Note (v0.2.0):** Swixter has been rewritten in Rust. The "Code Architecture" and "Developer Notes" sections below still describe the former TypeScript implementation and are kept for historical reference. Installation and build instructions in this document have been updated for the Rust codebase.

This document provides comprehensive information about Swixter's Windows support, including current status, configuration paths, testing strategies, and future enhancements.

## Current Status

**Swixter v0.2.0 (the Rust rewrite) works on Windows 10/11 out of the box.** Every GitHub Release ships a prebuilt x86_64 (MSVC) binary, installable via the PowerShell one-liner, npm, or Cargo.

### ✅ What Works on Windows

1. **Core CLI functionality**
   - All commands (create, list, switch, apply, run, delete, etc.)
   - Command aliases (r, ls, sw, rm, new)
   - Interactive menus
   - Profile management

2. **Configuration file handling**
   - JSON, YAML, and TOML parsing
   - Cross-platform path resolution (home directory located via the `dirs` crate)
   - All three AI coder adapters (Claude, Codex, Continue)

3. **AI Coder Integration**
   - Claude Code: Full support (uses `~/.claude/settings.json`)
   - Codex: Early support (uses `~/.codex/config.toml`)
   - Continue/Qwen: Full support (uses `~/.continue/config.yaml`)

4. **Launching coder CLIs (`run`, `proxy run`)**
   - npm-installed global CLIs are `.cmd` shims (not `.exe`); Swixter launches them via `cmd /C` so they resolve correctly on Windows
   - Install-method detection (`which` lookup) honors `PATHEXT` extensions (`.exe`/`.cmd`/`.bat`)

### ⚠️ What Has Limitations

1. **Shell Completion**
   - ✅ Bash/Zsh/Fish completions available
   - ❌ PowerShell completion not yet implemented

2. **E2E Testing**
   - ✅ Unit/integration tests (`cargo test --workspace`) run natively on Windows in CI (`windows-latest`)
   - ✅ Docker-based E2E tests work on Windows (requires Docker Desktop + WSL2)
   - ❌ Docker E2E scenarios themselves still run inside a Linux container

3. **Build**
   - ✅ Rust build works (`cargo build --release`)
   - ✅ Prebuilt Windows binaries ship with every GitHub Release

## Configuration File Paths

### Swixter Configuration

| Platform | Path | Notes |
|----------|------|-------|
| **Windows** | `C:\Users\<username>\swixter\config.json` | Simple, consistent with AI tools |
| **macOS** | `~/.config/swixter/config.json` | XDG Base Directory spec |
| **Linux** | `~/.config/swixter/config.json` | XDG Base Directory spec |

**Implementation:** `packages/cli/crates/core/src/paths.rs`

### AI Coder Tool Paths (Cross-Platform)

All AI coder tools use `~/.tool-name` format which works identically on Windows via Node.js `os.homedir()`:

#### Claude Code
| Platform | User Config | Enterprise Managed |
|----------|-------------|-------------------|
| **Windows** | `C:\Users\<username>\.claude\settings.json` | `C:\ProgramData\ClaudeCode\managed-settings.json` |
| **macOS** | `~/.claude/settings.json` | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| **Linux** | `~/.claude/settings.json` | `/etc/claude-code/managed-settings.json` |

#### Codex
| Platform | Path |
|----------|------|
| **Windows** | `C:\Users\<username>\.codex\config.toml` |
| **macOS/Linux** | `~/.codex/config.toml` |

**Note:** Codex Windows support is early stage. The tool recommends using WSL for best experience.

#### Continue/Qwen
| Platform | User Config | System Config |
|----------|-------------|---------------|
| **Windows** | `C:\Users\<username>\.continue\config.yaml` | `C:\ProgramData\qwen-code\settings.json` |
| **macOS** | `~/.continue/config.yaml` | `/Library/Application Support/QwenCode/settings.json` |
| **Linux** | `~/.continue/config.yaml` | `/etc/qwen-code/settings.json` |

**Important Clarification:** There are two different tools:
- **Continue.dev** - VS Code extension that uses `~/.continue/config.yaml` (OpenAI API format)
- **Qwen Code CLI** - Standalone CLI that uses `~/.qwen/settings.json` (Qwen-specific format)

Currently, `swixter qwen` targets Continue.dev, not Qwen Code CLI.

## Code Architecture for Cross-Platform Support

### Key Design Principles

1. **Use Node.js built-in APIs**
   ```typescript
   import { homedir, platform } from "node:os";
   import { join } from "node:path";
   ```

2. **Centralized path configuration**
   - All path logic in `src/constants/paths.ts`
   - Platform detection via `platform() === "win32"`
   - Path joining with `path.join()` (handles `/` vs `\` automatically)

3. **Tested cross-platform modules**
   - ✅ `fs/promises` - File operations work identically
   - ✅ `os.homedir()` - Returns correct user home on all platforms
   - ✅ `path.join()` - Uses correct path separator
   - ✅ `smol-toml` - TOML parsing (pure JS, no native deps)
   - ✅ `js-yaml` - YAML parsing (pure JS, no native deps)

### Adapter Pattern (Already Cross-Platform)

All three adapters use `os.homedir()` + `path.join()`, making them automatically Windows-compatible:

**Example from `src/adapters/claude.ts`:**
```typescript
configPath = getConfigPath("claude");  // Uses os.homedir() internally
```

**Example from `src/adapters/codex.ts`:**
```typescript
this.configPath = join(homedir(), ".codex", "config.toml");
```

No adapter-specific changes needed for Windows support!

## Testing on Windows

### Option 1: Docker Desktop (Recommended for CI/CD)

**Pros:**
- Reuses existing bash test scripts (8 scenarios)
- Tests Linux-like environment (most users use WSL anyway)
- Consistent with CI/CD pipeline

**Requirements:**
- Docker Desktop for Windows
- WSL2 backend enabled

**How to run:**
```powershell
# From PowerShell or Command Prompt (requires a Rust toolchain)
cd packages\cli
bash test/e2e-docker.sh
```

**How it works:**
1. Builds the Rust binary with `cargo build --release`
2. Creates a Linux container
3. Copies the binary and test scripts into the container
4. Runs 18 bash test scenarios inside the container
5. Reports results

### Option 2: Native Windows Testing (Future)

**Status:** Superseded — since the v0.2.0 Rust rewrite, `cargo test --workspace` runs natively on Windows CI. A Docker-free E2E variant exercising real Windows paths remains future work.

**Approach:** Rewrite test scenarios in Node.js/TypeScript for true cross-platform tests.

**Benefits:**
- Tests real Windows paths (C:\Users\... instead of /home/...)
- No Docker dependency
- Single test codebase for all platforms

**Estimated effort:** 16-20 hours

**Example structure:**
```typescript
// test/scenarios/create.test.ts
import { test, expect } from "bun:test";
import { platform } from "node:os";
import { join } from "node:path";

test("create profile on Windows", () => {
  const configPath = platform() === "win32"
    ? join(process.env.USERPROFILE!, "swixter", "config.json")
    : join(process.env.HOME!, ".config/swixter", "config.json");

  // Test logic...
});
```

## Windows Installation

### Prerequisites

- **Rust toolchain** (for building from source only)
- Windows 10/11

### Installation Methods

#### Method 1: PowerShell installer
```powershell
powershell -ExecutionPolicy Bypass -c "irm https://github.com/dawnswwwww/swixter/releases/latest/download/swixter-installer.ps1 | iex"
```

#### Method 2: npm (Global)
```powershell
npm install -g swixter
```

#### Method 3: Cargo
```powershell
cargo install swixter
```

#### Method 4: From source
```powershell
git clone https://github.com/dawnswwwww/swixter.git
cd swixter\packages\cli
cargo build --release
# Binary: target\release\swixter.exe
```

### Verify Installation

```powershell
swixter --help
swixter claude --help
```

## Common Windows Issues & Solutions

### Issue 1: Shell completions not working in PowerShell

**Status:** PowerShell completions not yet implemented.

**Workaround:** Use Git Bash or WSL for completion support.

**Planned fix:** Add a PowerShell completion generator:
```powershell
swixter completion powershell > $PROFILE\..\Completions\swixter.ps1
```

### Issue 2: Path not found errors

**Cause:** Mixing forward slashes `/` and backslashes `\` in paths.

**Solution:** Always use `path.join()` - it handles platform differences automatically.

**Example:**
```typescript
// ❌ Don't do this
const configPath = `${homedir()}/.config/swixter/config.json`;

// ✅ Do this
const configPath = join(homedir(), ".config", "swixter", "config.json");
```

## Roadmap: Full Windows Support

### v0.0.2 - v0.0.8 (Completed) ✅
- [x] Fix Swixter config path to use `~/swixter` on Windows
- [x] Document Windows compatibility
- [x] Verify all adapters work on Windows
- [x] Install and update CLI commands with platform-specific methods (WinGet, PowerShell)
- [x] Model configuration support for all coders
- [x] Edit profile enhancements

### v0.2.0 (Current) ✅
- [x] Prebuilt Windows binaries (x86_64 MSVC) on every GitHub Release
- [x] PowerShell installer (`swixter-installer.ps1`)
- [x] Windows CI: `cargo test --workspace` runs on `windows-latest`
- [x] Rust build instructions (`cargo build --release` / `cargo install`)

### Future
- [ ] Add PowerShell completion generator
- [ ] Windows package manager support (Chocolatey, Scoop, winget)
- [ ] Windows-specific installer (`.exe` with NSIS)
- [ ] Docker-free E2E scenarios that exercise native Windows paths
- [ ] Test on Windows 10/11 real machines

## Developer Notes

### Testing Your Changes on Windows

1. **Local testing**
   ```powershell
   cd packages\cli
   cargo run -p swixter -- claude create
   ```

2. **Check generated paths**
   ```powershell
   # Swixter config should be at:
   dir $env:USERPROFILE\swixter\config.json

   # Claude config should be at:
   dir $env:USERPROFILE\.claude\settings.json
   ```

3. **Run Docker-based E2E tests**
   ```powershell
   # Requires Docker Desktop + WSL2
   cd packages\cli
   bash test/e2e-docker.sh
   ```

### Adding New Features (Windows Checklist)

When adding new features, ensure Windows compatibility:

- [ ] Use `os.homedir()` instead of `~` or `$HOME`
- [ ] Use `path.join()` instead of string concatenation
- [ ] Use `path.sep` instead of hardcoded `/` or `\`
- [ ] Test on Windows if modifying file paths
- [ ] Update this document if adding Windows-specific behavior

### Platform Detection Pattern

```typescript
import { platform } from "node:os";

if (platform() === "win32") {
  // Windows-specific code
} else if (platform() === "darwin") {
  // macOS-specific code
} else {
  // Linux/Unix-specific code
}
```

## Resources

### Official Documentation
- [Claude Code Settings](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Codex Windows Support](https://github.com/openai/codex/blob/main/docs/windows.md)
- [Continue.dev Configuration](https://docs.continue.dev/reference/config)
- [Qwen Code Configuration](https://qwen-code.dev/docs/configuration)

### Node.js APIs
- [os.homedir()](https://nodejs.org/api/os.html#oshomedir)
- [os.platform()](https://nodejs.org/api/os.html#osplatform)
- [path.join()](https://nodejs.org/api/path.html#pathjoinpaths)

## Contributing

If you encounter Windows-specific issues:

1. Check this document first
2. Search existing issues on GitHub
3. Create a new issue with:
   - Windows version (10/11)
   - Node.js/Bun version
   - Full error message
   - Steps to reproduce

---

**Last Updated:** 2026-08-12 (v0.2.0)
**Status:** Active development - Windows support improving with each release
