# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Status

- **Current Version**: v0.2.0 (see CHANGELOG.md for details)
- **Implementation**: Rust (rewritten from TypeScript/Bun in v0.2.0; the TS sources were removed)
- **Platform Support**: Linux, macOS, Windows 10/11
- **Distribution**: cargo-dist installers (shell/powershell), npm, Homebrew tap, crates.io
- **CI/CD**: GitHub Actions (test.yml: fmt/clippy/test matrix + Docker E2E; release.yml: cargo-dist; publish-crates.yml: crates.io)

## Project Overview

Swixter is a CLI tool for managing configurations across multiple AI coding assistants. It allows users to easily switch between different AI providers (Anthropic, Ollama, custom) and manage API keys/configurations. Currently supports:
- **Claude Code** (Anthropic) - JSON config at `~/.claude/settings.json`
- **Codex** - TOML config at `~/.codex/config.toml` with env var support
- **Continue.dev** - YAML config at `~/.continue/config.yaml` (note: accessed via `swixter qwen` command for historical reasons, but targets Continue.dev VS Code extension, NOT Qwen Code CLI)

## Repository Layout

```
packages/cli/                # The Rust workspace (all CLI code lives here)
├── Cargo.toml               # Workspace root; [workspace.package] version is THE version source of truth
├── crates/
│   ├── core/                # Config, profiles, groups, providers, adapters, validation, export
│   ├── proxy/               # Failover proxy (circuit breaker, API format conversion, SSE)
│   ├── server/              # Web UI HTTP/WS server, auth, sync, crypto
│   └── swixter/             # CLI binary: clap definitions + command handlers
├── ui/                      # Web UI (React + Vite + Tailwind); dist/ is COMMITTED (see below)
└── test/                    # Docker-based E2E (e2e-docker.sh + scenarios/)
packages/website/            # Marketing site (Bun)
packages/docs/               # Docs site (Bun)
scripts/sync-versions.js     # Cargo version → package.json files (one-way)
scripts/bump-version.sh      # release: bump + sync + commit + tag
```

## Development Commands

All Rust commands run from `packages/cli` (the workspace root):

```bash
# Build
cargo build                          # Dev build
cargo build --release                # Release build

# Run the CLI from source
cargo run -p swixter -- claude list
cargo run -p swixter -- providers list

# Tests
cargo test --workspace               # All unit + integration tests
cargo test -p swixter-core           # Single crate
cargo test -p swixter --test coder_commands   # Single integration test file

# Lint / format (CI enforces both)
cargo fmt --all
cargo clippy --workspace --all-targets -- -D warnings

# E2E tests (Docker-based, requires Docker running)
bash test/e2e-docker.sh              # From packages/cli; E2E_CARGO_PROFILE=debug for faster iteration

# Web UI: after changing ui/src, rebuild AND commit crates/server/ui_dist together
cd ui && bun install && bun run build

# Release (from repo root; see "Release and Publishing")
bun run release:patch                # Bug fixes
bun run release:minor                # New features
bun run release:major                # Breaking changes
git push --follow-tags               # Triggers the release workflows
```

### ui_dist commit convention

`packages/cli/crates/server/ui_dist/` is **committed to git** and is the ONLY source of UI assets for release builds (cargo-dist jobs run bare `cargo build` with no Bun available). It lives inside the server crate so `cargo package`/`cargo publish` ship the real UI — an out-of-crate embed folder falls back to the placeholder page for `cargo install` users. Rule: **whenever you modify `ui/src`, run `bun run build` in `ui/` (vite outputs to `../crates/server/ui_dist`) and commit `ui_dist` in the same commit/PR.** The server's build.rs falls back to a placeholder page with a warning when ui_dist is missing — that fallback exists only for local builds and must never ship in a release.

## Architecture Overview

### Crate Boundaries

- **`swixter-core`** — everything pure/config-side: `ConfigManager` (config.rs), profiles/groups (groups.rs), provider presets (presets.rs + committed `presets.json`, the single source of truth for builtin providers), user providers (user_providers.rs), adapters (adapters/{claude,codex,continue_}.rs), validation (validate.rs), import/export (export.rs), paths (paths.rs). No CLI, no network.
- **`swixter-proxy`** — the failover proxy: handler, forwarder, circuit breaker (breaker.rs), API format transforms (transform/), SSE (sse.rs).
- **`swixter-server`** — Web UI server: HTTP routes, WebSocket, auth, cloud sync, crypto (AES-GCM field encryption, PBKDF2 key derivation).
- **`swixter`** — the binary: clap CLI definitions (src/cli.rs) and command handlers (src/commands/*.rs). Exit codes: 0 success, 1 general, 2 invalid argument, 3 not found, 130 cancelled.

### Core Data Flow

1. **Configuration Storage** (`~/.config/swixter/config.json`; `~/swixter/config.json` on Windows)
   - Stores all profiles, active profile per coder, groups, and metadata
   - Managed through `ConfigManager` (swixter-core); atomic writes via temp file + rename
   - `SWIXTER_CONFIG_PATH` env var overrides the location (used by tests)

2. **Provider System** (Two-tier)
   - **Built-in providers**: `crates/core/src/presets.json` (edit the JSON directly; the TS export scripts are gone)
   - **User-defined providers**: `~/.config/swixter/providers.json`; can override built-ins with the same ID

3. **Adapter Pattern** (`crates/core/src/adapters/`)
   - Each coder has an adapter with apply/verify/remove
   - Apply flow: `switch` changes the active profile in swixter config → `apply` writes the active profile to the coder's own config file (e.g. `~/.claude/settings.json`)

### Important Behaviors (kept identical to the TS implementation)

1. **Coder-agnostic design**: Command handlers in `crates/swixter/src/commands/coder.rs` are generic over a `CoderSpec`; coder-specifics live in core's adapters and coder registry.

2. **Adapter specifics**:
   - **Claude (JSON)**: full replacement of API-related env vars in settings.json; fields absent from the profile are removed to prevent stale config; model env vars (`ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{HAIKU,OPUS,SONNET}_MODEL`) written when the profile has model config; other sections (MCP servers etc.) preserved.
   - **Codex (TOML)**: env_key references per official spec; provider tables `[model_providers.swixter-<name>]` and `[profiles.swixter-<name>]`, `swixter-` prefix avoids clobbering user config. API keys must be exported as env vars, or use `swixter codex run`.
   - **Continue (YAML)**: modifies config.yaml model/apiKey fields.

3. **`create --apply` semantics**: creates the profile, switches the coder's active profile to it, THEN applies (not the previously active profile).

4. **Group validation**: create/update reject duplicate profiles within a group and blank group names (`CoreError::Validation` → exit 2); unknown profiles → `CoreError::NotFound` (exit 3).

5. **Provider wire_api**: Codex only supports `wire_api: "chat"` providers; Anthropic (`responses`) is filtered out of Codex flows.

6. **`run` command pattern**: Claude/Qwen spawn the coder CLI directly; Codex is all-in-one (apply profile → set env vars → spawn) because Codex requires env vars at process start.

7. **Custom env_key per profile** (Codex only): `profile.env_key` > preset `env_key` > `"OPENAI_API_KEY"`.

8. **Version strings** come from `env!("CARGO_PKG_VERSION")` at compile time — there is no runtime version file to sync.

## Testing

- **Unit/integration tests**: `cargo test --workspace`
  - Core unit tests live next to the code (`#[cfg(test)]` modules)
  - CLI integration tests: `crates/swixter/tests/*.rs` (assert_cmd, isolated `HOME` + `SWIXTER_CONFIG_PATH`)
  - Compat fixtures (config migration samples from the TS era): `crates/core/tests/fixtures/compat/`
- **E2E tests**: `packages/cli/test/e2e-docker.sh` — builds the release binary, spins up a container, runs all 18 scenarios in `test/scenarios/`
- CI (`.github/workflows/test.yml`): `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, cargo test on ubuntu/macos/windows, Docker E2E on ubuntu

## Code Style Notes

- Match the surrounding module's existing patterns; keep `CoreError` variants mapped to the right exit codes at the CLI layer
- User-facing CLI output mirrors the TS-era strings (`✓`/`✗` prefixes); E2E scenarios assert on them — don't change output text casually
- UI text is inline in the Rust handlers (the TS i18n constants layer is gone)

## Configuration File Paths

| Platform | Swixter Config | User Providers | Claude Code | Codex | Continue.dev |
|----------|---------------|----------------|-------------|-------|--------------|
| **Linux/macOS** | `~/.config/swixter/config.json` | `~/.config/swixter/providers.json` | `~/.claude/settings.json` | `~/.codex/config.toml` | `~/.continue/config.yaml` |
| **Windows** | `~/swixter/config.json` | `~/swixter/providers.json` | `~/.claude/settings.json` | `~/.codex/config.toml` | `~/.continue/config.yaml` |

Implemented in `crates/core/src/paths.rs`. Only Swixter's own config path is platform-specific.

## Release and Publishing

Single source of truth for the version: `packages/cli/Cargo.toml` `[workspace.package] version`. `scripts/sync-versions.js` syncs it one-way into the root and `packages/*/package.json` files.

### How to Release

```bash
# 1. Update CHANGELOG.md (add a ## [X.Y.Z] - YYYY-MM-DD section)
# 2. Bump + sync + commit + tag (requires cargo-edit):
bun run release:patch   # or release:minor / release:major
# 3. Push — triggers both release workflows:
git push --follow-tags
```

On a `v*` tag, two workflows run in parallel:

- **`.github/workflows/release.yml`** (generated by cargo-dist — DO NOT hand-edit; adjust `[dist]` in `dist-workspace.toml` at the repo root and re-run `dist generate`): builds 7 targets, creates the GitHub Release with changelog + checksums, publishes shell/powershell installers, the npm package, and the Homebrew formula.
- **`.github/workflows/publish-crates.yml`**: `cargo publish` in dependency order (swixter-core → swixter-proxy → swixter-server → swixter) with index-delay sleeps.

### Required Secrets

GitHub repository secrets (Settings → Secrets and variables → Actions):
- `NPM_TOKEN` — npm Automation token
- `CARGO_REGISTRY_TOKEN` — crates.io API token (publish-update scope)
- `HOMEBREW_TAP_TOKEN` — fine-grained PAT with Contents write on `dawnswwwww/homebrew-tap`

Setup details and troubleshooting: [docs/RELEASE-SETUP.md](docs/RELEASE-SETUP.md).

### Helper Scripts

- **`scripts/bump-version.sh`** — cargo set-version + sync-versions + commit + tag
- **`scripts/sync-versions.js`** — Cargo workspace version → all package.json files
- **`packages/cli/scripts/extract-changelog.js`** — local changelog extraction tool (no longer used by CI; cargo-dist extracts release notes itself)

## Windows Compatibility

See [docs/WINDOWS.md](docs/WINDOWS.md). Note its architecture sections still describe the former TypeScript implementation (kept for historical reference); install/build instructions there are current.
