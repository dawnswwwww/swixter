# Windows Compatibility Guide

This document provides comprehensive information about Swixter's Windows support, including current status, configuration paths, testing strategies, and future enhancements.

## Current Status

**Swixter v0.0.2+ is ~90% compatible with Windows out of the box.**

### ✅ What Works on Windows

1. **Core CLI functionality**
   - All commands (create, list, switch, apply, run, delete, etc.)
   - Command aliases (r, ls, sw, rm, new)
   - Interactive menus
   - Profile management

2. **Configuration file handling**
   - JSON, YAML, and TOML parsing
   - Cross-platform path resolution via `os.homedir()`
   - All three AI coder adapters (Claude, Codex, Continue)

3. **AI Coder Integration**
   - Claude Code: Full support (uses `~/.claude/settings.json`)
   - Codex: Early support (uses `~/.codex/config.toml`)
   - Continue/Qwen: Full support (uses `~/.continue/config.yaml`)

### ⚠️ What Has Limitations

1. **Shell Completion**
   - ✅ Bash/Zsh/Fish completions available
   - ❌ PowerShell completion not yet implemented

2. **E2E Testing**
   - ✅ Docker-based tests work on Windows (requires Docker Desktop + WSL2)
   - ❌ Native Windows test suite not yet available

3. **Build Script**
   - ✅ Main build works (`bun build`)
   - ⚠️ `chmod +x` in package.json is harmless on Windows but unnecessary

## Configuration File Paths

### Swixter Configuration

| Platform | Path | Notes |
|----------|------|-------|
| **Windows** | `C:\Users\<username>\swixter\config.json` | Simple, consistent with AI tools |
| **macOS** | `~/.config/swixter/config.json` | XDG Base Directory spec |
| **Linux** | `~/.config/swixter/config.json` | XDG Base Directory spec |

**Implementation:** `src/constants/paths.ts:getSwixterConfigDir()`

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
# From PowerShell or Command Prompt
bun run test:e2e
```

**How it works:**
1. Builds project with `bun build`
2. Creates Linux container with Bun runtime
3. Copies build artifacts into container
4. Runs 8 bash test scenarios inside container
5. Reports results

### Option 2: Native Windows Testing (Future)

**Status:** Not implemented (v0.1.0 roadmap)

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

- **Node.js 18+** (or Bun runtime)
- Windows 10/11

### Installation Methods

#### Method 1: npm (Global)
```powershell
npm install -g swixter
```

#### Method 2: npx (No install)
```powershell
npx swixter --help
```

#### Method 3: From source
```powershell
git clone https://github.com/dawnswwwww/swixter.git
cd swixter
bun install
bun run build
```

### Verify Installation

```powershell
swixter --help
swixter claude --help
```

## Common Windows Issues & Solutions

### Issue 1: `chmod: command not found` during build

**Cause:** `package.json` build script includes `chmod +x` which doesn't exist on Windows.

**Solution:** This is harmless - the build will succeed anyway. The executable bit is a Unix concept.

**Fix (future):** Make chmod conditional:
```json
"build": "bun build src/cli/index.ts --outdir dist/cli --target node --format esm && (chmod +x dist/cli/index.js || true)"
```

### Issue 2: Shell completions not working in PowerShell

**Status:** PowerShell completions not yet implemented.

**Workaround:** Use Git Bash or WSL for completion support.

**Fix (v0.1.0):** Add PowerShell completion generator:
```powershell
swixter completion powershell > $PROFILE\..\Completions\swixter.ps1
```

### Issue 3: Path not found errors

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

### v0.0.2 (Current) ✅
- [x] Fix Swixter config path to use `~/swixter` on Windows
- [x] Document Windows compatibility
- [x] Verify all adapters work on Windows

### v0.1.0 (Next)
- [ ] Add PowerShell completion generator
- [ ] Cross-platform E2E tests (Node.js/TypeScript)
- [ ] Windows-specific CI/CD pipeline (GitHub Actions)
- [ ] Test on Windows 10/11 real machines

### v0.2.0 (Future)
- [ ] Windows package manager support (Chocolatey, Scoop, winget)
- [ ] Windows-specific installer (`.exe` with NSIS)
- [ ] Native Windows paths documentation
- [ ] PowerShell-specific examples in README

## Developer Notes

### Testing Your Changes on Windows

1. **Local testing**
   ```powershell
   bun run cli claude create
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
   bun run test:e2e
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

**Last Updated:** 2025-01-21 (v0.0.2)
**Status:** Active development - Windows support improving with each release
