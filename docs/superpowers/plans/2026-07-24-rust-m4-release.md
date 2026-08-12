# M4 发布流水线 + E2E 适配 + TS 代码删除实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 swixter Rust 重写的最后一个里程碑 M4：接入 cargo-dist 发布流水线（7 target 矩阵构建 + shell/powershell/npm/homebrew 四种 installer + GitHub Release）、crates.io 按依赖顺序发布、重写 test.yml（fmt/clippy/test 矩阵 + Docker E2E）、把 18 个 E2E 场景脚本从 `node dist/cli/index.js` 切换到 Rust 二进制、重写 sync-versions.js（单一版本源 = workspace Cargo.toml）、删除全部 TS 源码与 bun 单测（保留并迁移 Rust 侧仍在引用的 compat fixtures）、更新 README/RELEASE-SETUP.md/CLAUDE.md。实际打 tag 发布、secrets 配置、homebrew tap 仓库创建由用户操作，不在本计划执行范围内。

**Architecture:** 发布中枢是 `packages/cli/Cargo.toml` 的 `[workspace.metadata.dist]`（cargo-dist 配置内联在 workspace 根清单，不单独建 dist-workspace.toml——本仓库 workspace 根就是 packages/cli/Cargo.toml，设计文档中的「dist-workspace.toml」以此等价形式落地）。`git tag v*` 触发两个 workflow：cargo-dist 生成的 `release.yml`（矩阵构建 → GitHub Release → npm 包 + brew formula）与手写的 `publish-crates.yml`（core → proxy → server → swixter 顺序 `cargo publish`）。crates.io 与 dist 分两个 workflow 的原因：`cargo dist generate` 会整体重生成 release.yml，手写 job 会被覆盖，独立文件互不干扰。版本单一权威源为 `[workspace.package] version`，`scripts/sync-versions.js` 反向同步到各 package.json。

**Tech Stack:** cargo-dist（生成 GitHub release workflow 与 installer）、GitHub Actions、cargo / rustfmt / clippy、Docker（E2E）、Node 20（sync-versions.js 保持 Node 脚本，不引入新依赖）、bun（仅 packages/cli/ui 前端构建保留）。

**Spec:**
- `docs/superpowers/specs/2026-07-23-rust-rewrite-design.md` §5（发布流水线）、§6（测试策略）、§8（决策记录：cargo-dist 全家桶 + crates.io）
- `docs/superpowers/plans/2026-07-24-rust-m3-ui-sync.md`（本计划格式参照）

## Global Constraints

- **现状锚点（执行前已核对，计划内容与之衔接）：**
  - workspace：`packages/cli/Cargo.toml`，`[workspace.package] version = "0.2.0"`、edition 2021、license MIT；members = core/swixter/proxy/server。四个 crate 的 Cargo.toml 均只有 name/version/edition/license，**缺 description/repository**（cargo publish 必填，Task 1 补齐）。
  - `--version` 链路已是编译期版本：`crates/swixter/src/cli.rs` clap `#[command(version)]`（隐含 `env!("CARGO_PKG_VERSION")`），`crates/server/src/server/routes/config.rs:29` 的 `appVersion` 也用 `env!("CARGO_PKG_VERSION")`。无手写 APP_VERSION，无需改造，Task 6 验证即可。
  - `crates/server/build.rs` 已实现「ui/dist 缺失时尝试 bun 构建，失败则写占位 index.html 并 warn、不 panic」——交叉编译安全。rust-embed 编译期在 host 上读文件嵌入，与 target 无关，只要源码树里 ui/dist 存在即可。
  - `packages/cli/ui/dist` 当前被 gitignore（根 `.gitignore` 的 `dist` + `packages/cli/ui/.gitignore` 的 `dist/`），但本地已有构建产物。
  - E2E：`packages/cli/test/e2e-docker.sh` 的 SCENARIOS 数组只列了 14 个场景，但 `test/scenarios/` 下有 **18 个**脚本——`test-claude-models.sh`、`test-codex-models.sh`、`test-providers.sh`、`test-qwen-models.sh` 未在 runner 中（TS 时代漏加，Task 7 补齐）。18 个脚本中 17 个 `CLI_CMD="node /home/testuser/dist/cli/index.js"`，1 个 `CLI_CMD="node dist/cli/index.js"`。
  - `packages/cli/test/docker/Dockerfile` 基于 `oven/bun:latest` + jq/curl + testuser。
  - `crates/core/tests/compat_fixtures.rs:6` 通过 `{}/../../tests/compat/fixtures/{}` 引用 `packages/cli/tests/compat/fixtures/*.json`（5 个 fixture：empty-default/full/invalid-url/unknown-fields/v1-legacy）。
  - `crates/server/tests/crypto_cross.rs:69` spawn `bun scripts/verify-crypto-fixtures.ts` 做 Rust→TS 反向验证；TS→Rust 方向的向量已提交在 `crates/server/tests/fixtures/crypto_ts_vectors.json`。
  - codegen 脚本：`packages/cli/scripts/export-data.ts` 从 TS 源码生成 `crates/core/src/presets.json` 与 `crates/swixter/src/install.json`（已提交入库）；`gen-crypto-fixtures.ts` / `verify-crypto-fixtures.ts` 依赖 `src/crypto/`。
  - `packages/cli/scripts/extract-changelog.js` 被旧 release.yml 用于提取 changelog（纯 Node 无 TS 依赖，保留）。
  - 根 package.json：`version` hook 跑 sync-versions.js + `git add packages/*/package.json packages/cli/src/constants/meta.ts`（meta.ts 将随 TS 删除消失）；`release:*` 用 `npm version`。
  - `packages/cli/package.json`：name `swixter`、version `0.1.12`、bin 指向 `dist/cli/index.js`、scripts 全为 bun/TS 构建；`packages/cli/ui/package.json`（swixter-ui）独立存在但**不在根 workspaces 列表中**。
- **版本策略：** 单一权威源 = `packages/cli/Cargo.toml` 的 `[workspace.package] version`。M4 完成后首个 release 候选版本由用户决定（设计文档提 1.0；当前 workspace 为 0.2.0）。npm 包名保持 `swixter` 不变（决策记录：原位替换、npm 包名不变）。
- **渠道行为（写入文档，设计文档 §5 取舍说明）：** cargo-dist 的 npm installer 是「安装时从 GitHub Release 下载对应平台二进制」模式，非 optionalDependencies 平台包；`--ignore-scripts` 环境会安装失败，需 fallback 到 shell installer。
- **musl 风险预检：** reqwest 已是 rustls-tls（无 openssl 依赖），musl 交叉主要风险在 rustls 底层 ring/aws-lc 的 C 编译。Task 4 必须先在 PR 上跑 `cargo dist plan` / pr-run-mode 验证 7 个 target 全部可构建，任一 musl target 失败时的降级预案是从 targets 移除该 target（linux gnu 已覆盖主流），并在计划中记录原因，不允许无声跳过。
- **不破坏 M1-M3：** `cargo test --workspace` 在全任务完成后必须保持绿（除 Task 8 明确改造的 crypto_cross.rs 与 compat_fixtures.rs 路径外，不改任何 Rust 测试断言）。

## File Structure

```
packages/cli/
├── Cargo.toml                          # 追加 [workspace.metadata.dist] + workspace 级 repository/description
├── crates/
│   ├── core/Cargo.toml                 # + description/repository（publish 元数据）
│   ├── proxy/Cargo.toml                # 同上
│   ├── server/Cargo.toml               # 同上
│   ├── swixter/Cargo.toml              # 同上
│   ├── core/tests/fixtures/compat/     # 从 tests/compat/fixtures 迁移（5 个 json）
│   ├── core/tests/compat_fixtures.rs   # 路径改为 tests/fixtures/compat
│   └── server/tests/crypto_cross.rs    # 删除 bun spawn 反向验证段，保留已提交向量断言
├── ui/dist/                            # 解除 gitignore，提交预构建产物（发布构建的 UI 资产来源）
├── test/
│   ├── e2e-docker.sh                   # 构建 Rust 二进制 + 拷贝二进制 + 18 场景全量
│   ├── docker/Dockerfile               # debian slim + jq/curl（去掉 bun）
│   └── scenarios/*.sh                  # CLI_CMD 改为 Rust 二进制（18 个）
├── scripts/
│   ├── extract-changelog.js            # 保留不动
│   ├── export-data.ts                  # 删除（presets.json/install.json 转 Rust 侧权威）
│   ├── gen-crypto-fixtures.ts          # 删除
│   └── verify-crypto-fixtures.ts       # 删除
├── src/                                # 删除（全部 TS 源码）
├── tests/                              # 删除（bun 单测；compat/fixtures 先迁移）
└── package.json                        # 精简：去 TS build/test scripts 与 TS-only 依赖
.github/workflows/
├── test.yml                            # 重写：fmt + clippy + cargo test 矩阵 + E2E
├── release.yml                         # 由 cargo dist generate 生成并提交
└── publish-crates.yml                  # 新增：tag v* → 按序 cargo publish
scripts/
├── sync-versions.js                    # 重写：Cargo version → 各 package.json
└── bump-version.sh                     # 新增：bump Cargo version + sync + commit + tag
根 package.json                         # release:* 改调 bump-version.sh，清理 cli TS 脚本
README.md / docs/RELEASE-SETUP.md / CLAUDE.md   # 安装方式与发布文档更新
```

## Task 1: Cargo publish 元数据补齐

**Files:**
- Modify: `packages/cli/Cargo.toml`
- Modify: `packages/cli/crates/{core,proxy,server,swixter}/Cargo.toml`

**Interfaces:** crates.io 要求每个 publish 的 crate 有 `description` 与 `license`（已有 workspace license）。共享字段上提到 workspace 级，description 按 crate 各自声明。

`packages/cli/Cargo.toml` 的 `[workspace.package]` 改为：

```toml
[workspace.package]
version = "0.2.0"
edition = "2021"
license = "MIT"
repository = "https://github.com/dawnswwwww/swixter"
homepage = "https://github.com/dawnswwwww/swixter"
```

四个 crate 的 `[package]` 各追加（以 core 为例，其余同理替换描述）：

```toml
[package]
name = "swixter-core"
description = "Core config/profile/group management for swixter, the AI coding assistant profile switcher"
version.workspace = true
edition.workspace = true
license.workspace = true
repository.workspace = true
homepage.workspace = true
```

- proxy: `"Anthropic/OpenAI protocol-transforming failover proxy for swixter"`
- server: `"Web UI backend, auth and cloud sync client for swixter"`
- swixter: `"CLI tool for managing AI coding assistant configurations - switch between providers (Claude Code, Codex, Continue) with Anthropic, Ollama, or custom APIs"`（与现 npm description 对齐）并追加 `keywords = ["claude", "codex", "llm", "config", "cli"]`、`categories = ["command-line-utilities"]`。

**验证：**
- [ ] `cargo publish --dry-run -p swixter-core`（在 packages/cli 下）无元数据报错；`--no-verify` 如 dry-run 因未发布的路径依赖失败则允许，记录输出。注意：path 依赖未发布前 dry-run 只能逐 crate 验证元数据部分。
- [ ] `cargo metadata --no-deps` 确认四 crate 均带 description/repository。

**Commit:** `chore: add crates.io publish metadata to workspace crates`

## Task 2: UI dist 发布策略（提交预构建产物）

**Files:**
- Modify: `packages/cli/ui/.gitignore`（删除 `dist/` 行）
- Modify: 根 `.gitignore`（`dist` 规则收窄，避免误伤——改为只在需要的层级忽略，或追加 `!packages/cli/ui/dist/` 例外）
- Add: `packages/cli/ui/dist/**`（构建并提交）

**背景与决策：** cargo-dist 的 per-target 构建 job 直接 `cargo build`，无前置 hook 可用（`cargo dist generate` 会覆盖手写 step）。交叉编译时 build.rs 虽有「无 bun 写占位」容错，但 release 产物不能内嵌占位 UI。**决策：把预构建的 ui/dist 提交进 git**，作为 release 构建的 UI 资产唯一来源；build.rs 的 bun 自动构建路径保留给本地开发（dist 被删除时兜底）。这是「UI dist 已提交/预构建」方案的落地，代价是仓库里有构建产物，换来发布流水线的确定性。

**步骤：**
- [ ] `cd packages/cli/ui && bun install && bun run build` 生成最新 dist。
- [ ] 编辑 `packages/cli/ui/.gitignore` 移除 `dist/`；根 `.gitignore` 第 7 行的裸 `dist` 会匹配任意层级 dist 目录，改为追加例外行 `!packages/cli/ui/dist/`（保留其余忽略行为不变）。
- [ ] `git add packages/cli/ui/dist` 并确认 `git check-ignore packages/cli/ui/dist/index.html` 不再命中。
- [ ] 在 `packages/cli/ui/README.md`（无则新建三行说明）或 CLAUDE.md 记录：「ui/dist 为提交入库的预构建产物；修改 ui/src 后必须 `bun run build` 并一并提交 dist」。

**验证：**
- [ ] 删除 `packages/cli/ui/dist` 后 `cargo build -p swixter-server` 触发 build.rs 兜底（warn + 占位）仍编译通过；恢复 dist 后 `cargo build --release -p swixter` 通过且二进制内嵌真实 index.html（`strings` 或运行 `swixter ui` 抽查）。

**Commit:** `chore: commit prebuilt UI assets for release builds`

## Task 3: cargo-dist 配置接入

**Files:**
- Modify: `packages/cli/Cargo.toml`（追加 `[workspace.metadata.dist]`）

**Interfaces:** 在 `packages/cli/Cargo.toml` 末尾追加：

```toml
[workspace.metadata.dist]
# 由 cargo-dist 维护；版本号以本机 cargo dist --version 为准
cargo-dist-version = "0.28.0"
ci = "github"
installers = ["shell", "powershell", "npm", "homebrew"]
# Homebrew tap 仓库——占位，需用户先在 GitHub 创建 dawnswwwww/homebrew-tap（见 Task 10 文档步骤）
tap = "dawnswwwww/homebrew-tap"
targets = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-unknown-linux-gnu",
  "aarch64-unknown-linux-gnu",
  "x86_64-unknown-linux-musl",
  "aarch64-unknown-linux-musl",
  "x86_64-pc-windows-msvc",
]
install-path = "CARGO_HOME"
# PR 上只跑 dist plan，不构建产物
pr-run-mode = "plan"
# npm installer 包名与现行 npm 包一致（决策记录：npm 包名不变）
npm-package = "swixter"
```

注意点：
- `cargo-dist-version` 必须等于实际安装的 cargo-dist 版本（`cargo dist --version`），不一致会导致 generate 检查失败；以执行时版本为准，上面 0.28.0 是占位写法。
- bin 无需显式声明：workspace 内唯一 `[[bin]]` 是 crates/swixter 的 `swixter`，dist 自动拾取；如 dist 抱怨多 crate workspace 的 app 选择，追加 `dist = true` 到 crates/swixter 的 `[package.metadata.dist]`（按需）。
- musl target 如构建失败，按 Global Constraints 的降级预案处理。

**验证：**
- [ ] `cargo dist init --yes`（交互式也可，目标产出与上面等价后手工对齐）→ `cargo dist generate --check` 通过。
- [ ] `cargo dist plan` 输出包含 7 个 target 与 4 种 installer。

**Commit:** `feat: configure cargo-dist for 7-target releases`

## Task 4: release.yml 重写（cargo dist generate）

**Files:**
- Modify: `.github/workflows/release.yml`（被 `cargo dist generate` 整体替换）

**Interfaces:** 运行 `cargo dist generate`，提交生成的 release.yml。该 workflow 在 `push tags v*` 时：plan → 矩阵构建 7 target → 创建 GitHub Release（含 changelog 与 checksums）→ 发布 shell/powershell installer 资产、npm 包（`NPM_TOKEN` secret）、homebrew formula 推送到 tap 仓库。

- [ ] 旧 release.yml 的 extract-changelog 步骤由 cargo-dist 内建 changelog 提取替代（同样读 CHANGELOG.md 的 `## [X.Y.Z]` 段）；保留 `packages/cli/scripts/extract-changelog.js` 仅作本地工具，不再被 CI 引用。
- [ ] 生成后人工核对：触发条件含 `tags: ['v*']`；npm publish step 引用 `secrets.NPM_TOKEN`；homebrew step 引用 tap 仓库（用户未建 tap 前该 job 会失败——Task 10 文档明确「未建 tap 前先从 installers 移除 homebrew 或接受该 job 红」的过渡操作，默认写法：保留 homebrew，文档说明）。
- [ ] **不手写编辑** release.yml 的任何 job（会被下次 generate 覆盖）；crates.io 发布走 Task 5 的独立 workflow。

**验证：**
- [ ] `cargo dist generate --check` 与提交内容一致（CI 上 cargo-dist 也会自检）。
- [ ] 在 PR 分支推送，`release.yml` 的 plan job（pr-run-mode=plan）绿。

**Commit:** `ci: replace release workflow with cargo-dist generated pipeline`

## Task 5: publish-crates.yml（crates.io 发布）

**Files:**
- Add: `.github/workflows/publish-crates.yml`

**Interfaces:** 完整文件内容：

```yaml
name: Publish crates.io

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:

jobs:
  publish:
    name: cargo publish (dependency order)
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Rust
        uses: dtolnay/rust-toolchain@stable

      - name: Publish swixter-core
        working-directory: packages/cli
        run: cargo publish -p swixter-core --token ${{ secrets.CARGO_REGISTRY_TOKEN }}

      - name: Wait for crates.io index
        run: sleep 30

      - name: Publish swixter-proxy
        working-directory: packages/cli
        run: cargo publish -p swixter-proxy --token ${{ secrets.CARGO_REGISTRY_TOKEN }}

      - name: Wait for crates.io index
        run: sleep 30

      - name: Publish swixter-server
        working-directory: packages/cli
        run: cargo publish -p swixter-server --token ${{ secrets.CARGO_REGISTRY_TOKEN }}

      - name: Wait for crates.io index
        run: sleep 30

      - name: Publish swixter
        working-directory: packages/cli
        run: cargo publish -p swixter --token ${{ secrets.CARGO_REGISTRY_TOKEN }}
```

注意点：
- 顺序固定 core → proxy → server → swixter（路径依赖链）；每步后 sleep 等 crates.io 索引刷新，若仍报「crate not found」把 sleep 改为轮询 `cargo search` 的重试循环（执行时按需收紧）。
- 发布前必须先把 path 依赖补版本号：`crates/*/Cargo.toml` 中 `swixter-core = { path = "../core" }` 需改为 `{ version = "0.2", path = "../core" }`（proxy/server/swixter 三处对内部依赖同样处理）——这是 cargo publish 的硬性要求，归入本任务第一步执行。
- ui/dist 已提交（Task 2），publish 打包时 build.rs 不需要 bun。

**验证：**
- [ ] `cargo publish --dry-run -p swixter-core --allow-dirty`（version 补齐后）通过；四 crate 逐个 dry-run。
- [ ] workflow yaml 语法经 `actionlint`（若本机有）或 CI 首跑验证。

**Commit:** `ci: add crates.io publish workflow`

## Task 6: sync-versions.js 重写 + 根 package.json 清理

**Files:**
- Modify: `scripts/sync-versions.js`（整体重写）
- Add: `scripts/bump-version.sh`
- Modify: 根 `package.json`

**Interfaces:** 新 sync-versions.js：从 `packages/cli/Cargo.toml` 的 `[workspace.package] version` 读取（正则解析，不引 toml 依赖），同步到根 `package.json` 与 `packages/{cli,website,docs}/package.json` 的 `version` 字段。完整内容：

```js
#!/usr/bin/env node

/**
 * Sync version from Cargo workspace (single source of truth) to all package.json files.
 * Reads packages/cli/Cargo.toml [workspace.package] version, writes it to root
 * package.json and every workspace package.json.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, '..');

const cargoToml = readFileSync(resolve(root, 'packages/cli/Cargo.toml'), 'utf-8');
const match = cargoToml.match(/\[workspace\.package\][^\[]*?version\s*=\s*"([^"]+)"/s);
if (!match) {
  console.error('[sync-versions] Could not find [workspace.package] version in packages/cli/Cargo.toml');
  process.exit(1);
}
const version = match[1];
console.log(`[sync-versions] Version (from Cargo.toml): ${version}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
}

const packages = ['package.json', 'packages/cli/package.json', 'packages/website/package.json', 'packages/docs/package.json'];

for (const pkg of packages) {
  const pkgPath = resolve(root, pkg);
  if (!existsSync(pkgPath)) {
    console.log(`[sync-versions] - Skipping ${pkg} (missing)`);
    continue;
  }
  const pkgData = readJson(pkgPath);
  if (pkgData.version === version) {
    console.log(`[sync-versions] - ${pkg} already ${version}`);
    continue;
  }
  pkgData.version = version;
  writeJson(pkgPath, pkgData);
  console.log(`[sync-versions] ✓ ${pkg} → ${version}`);
}

console.log('[sync-versions] Done.');
```

`scripts/bump-version.sh`（替代 `npm version` 流程；可执行）：

```bash
#!/bin/bash
# Usage: scripts/bump-version.sh <patch|minor|major|X.Y.Z>
# Bumps packages/cli/Cargo.toml workspace version (single source of truth),
# syncs package.json files, commits, and creates a git tag.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/packages/cli"

if ! command -v cargo-set-version >/dev/null 2>&1 && ! cargo set-version --help >/dev/null 2>&1; then
  echo "cargo-edit is required: cargo install cargo-edit" >&2
  exit 1
fi

cargo set-version --workspace "$1"
NEW_VERSION=$(grep -A5 '\[workspace.package\]' Cargo.toml | grep '^version' | head -1 | sed 's/.*"\(.*\)".*/\1/')
cd "$ROOT"
node scripts/sync-versions.js
git add packages/cli/Cargo.toml packages/cli/Cargo.lock package.json packages/*/package.json
git commit -m "chore: release v${NEW_VERSION}"
git tag "v${NEW_VERSION}"
echo "Tagged v${NEW_VERSION}. Run: git push --follow-tags"
```

根 `package.json` scripts 改为：

```json
"scripts": {
  "build": "bun run --filter '*' build",
  "dev:website": "bun run --filter 'swixter-website' dev",
  "dev:docs": "bun run --filter 'swixter-docs' dev",
  "build:website": "bun run --filter 'swixter-website' build",
  "build:docs": "bun run --filter 'swixter-docs' build",
  "test": "cd packages/cli && cargo test --workspace",
  "test:e2e": "cd packages/cli && bash test/e2e-docker.sh",
  "sync-versions": "node scripts/sync-versions.js",
  "release:patch": "bash scripts/bump-version.sh patch",
  "release:minor": "bash scripts/bump-version.sh minor",
  "release:major": "bash scripts/bump-version.sh major"
}
```

（删除 `build:cli`/`cli`/`cli:dev`/`ui:dev`/`preversion`/`version`/`postversion`；`ui:dev` 若保留改为 `cd packages/cli/ui && bun run dev`。）

**验证：**
- [ ] 手动把 workspace version 改为 `0.2.1-test` → `node scripts/sync-versions.js` → 四个 package.json 均更新；改回 `0.2.0` 再同步还原。
- [ ] `cargo run -p swixter -- --version` 输出 `swixter 0.2.0`（验证 env!("CARGO_PKG_VERSION") 链路，无需改动代码）。
- [ ] `bash -n scripts/bump-version.sh` 语法通过；dry-run 前两步（set-version + sync）在临时 worktree 验证后还原。

**Commit:** `feat: make Cargo workspace version the single source of truth`

## Task 7: E2E 适配（Rust 二进制 + 18 场景全量）

**Files:**
- Modify: `packages/cli/test/e2e-docker.sh`
- Modify: `packages/cli/test/docker/Dockerfile`
- Modify: `packages/cli/test/scenarios/*.sh`（18 个）

**Interfaces:**

Dockerfile 整体替换为：

```dockerfile
# Swixter E2E 测试环境
FROM debian:bookworm-slim

# 安装基础工具
RUN apt-get update && apt-get install -y \
    jq \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 创建测试用户
RUN useradd -m -s /bin/bash testuser

# 切换到测试用户
USER testuser
WORKDIR /home/testuser

# 创建配置目录
RUN mkdir -p /home/testuser/.config/swixter

# 设置默认命令
CMD ["/bin/bash"]
```

e2e-docker.sh 关键改动（其余结构保留）：
- Step 1 构建：`bun run build` → `(cd "$PROJECT_ROOT" && cargo build --release)`，二进制为 `packages/cli/target/release/swixter`。
- Step 4 拷贝：`docker cp ./dist ...` → `docker cp "$PROJECT_ROOT/target/release/swixter" "$CONTAINER_ID:/home/testuser/swixter"`；chown 对象相应调整。
- SCENARIOS 数组补全为 18 个（追加 `test-claude-models.sh`、`test-codex-models.sh`、`test-providers.sh`、`test-qwen-models.sh`）。

18 个场景脚本统一把 CLI_CMD 行改为：

```bash
CLI_CMD="${SWIXTER_BIN:-/home/testuser/swixter}"
```

（`SWIXTER_BIN` 环境变量便于本机不经 Docker 直接跑场景，如 `SWIXTER_BIN=packages/cli/target/release/swixter`。）

**逐场景覆盖核对（断言不变，仅换调用对象；行为差异按 M1-M3 计划中的「已知偏差」逐条处理）：**

| 场景 | 覆盖 | 备注 |
|---|---|---|
| test-aliases.sh | M1 | 命令别名 |
| test-apply.sh | M1 | adapters 应用配置 |
| test-claude-models.sh | M1 | 补入 runner；模型配置 |
| test-codex-models.sh | M1 | 补入 runner；codex TOML |
| test-create.sh | M1 | profile 创建 |
| test-daemon.sh | M3 | `ui --daemon/--status/--stop`、ui.pid/ui.log；断言 "not running" 等文案需与 Rust 输出逐字核对，不同则以 Rust 输出为准改断言并在 commit message 说明 |
| test-delete.sh | M1 | |
| test-errors.sh | M1 | 错误文案逐字断言是重点核对对象 |
| test-export-import.sh | M1 | |
| test-group.sh | M1 | failover group |
| test-install-command.sh | M1 | `install` 命令；注意它会真实尝试安装 coder CLI，Rust 版行为（install.rs）需先人工核对该场景在容器内网络可达性 |
| test-install-detection.sh | M1 | 检测已装 coder |
| test-list.sh | M1 | |
| test-providers.sh | M1 | 补入 runner；自定义 provider |
| test-proxy.sh | M2 | proxy start/stop + group 转发；端口 18731 冲突检查保留 |
| test-qwen-models.sh | M1 | 补入 runner |
| test-switch.sh | M1 | 含 `sw` 别名断言 |
| test-update-command.sh | M1 | update 命令 |

**验证（TDD 式：先改脚本跑红，再修到绿）：**
- [ ] 本机 `cargo build --release` 后 `docker build -t swixter-test -f test/docker/Dockerfile .` 通过。
- [ ] `bash test/e2e-docker.sh` 首跑：预期部分场景红（文案/行为偏差）；逐个场景对照 M1-M3 行为规格修断言（只允许改断言以匹配 Rust 实际正确行为；发现 Rust 行为本身与 TS 规格不符的，停下来报给用户，不在本任务顺手改 Rust 逻辑）。
- [ ] 终态 18/18 绿。

**Commit:** `test: run E2E scenarios against the Rust binary`

## Task 8: compat fixtures 迁移 + crypto 交叉测试改造

**Files:**
- Create: `packages/cli/crates/core/tests/fixtures/compat/`（接收 5 个 json）
- Modify: `packages/cli/crates/core/tests/compat_fixtures.rs`
- Modify: `packages/cli/crates/server/tests/crypto_cross.rs`
- Delete: `packages/cli/tests/compat/`（含 generate-fixtures.ts）

**决策（codegen 依赖 TS 的处理）：**
- `presets.json` / `install.json`：已提交在 crates 内的 JSON 成为**唯一权威来源**，今后直接手改 JSON；`export-data.ts` 删除（Task 9）。TS 源码删除后再没有「从 TS 导出」的需求。
- compat fixtures：TS 已冻结，5 个 fixture 是静态兼容样本，迁移到 `crates/core/tests/fixtures/compat/` 随 Rust 测试就近管理；`generate-fixtures.ts` 删除。
- crypto 交叉向量：TS→Rust 方向已由提交的 `crypto_ts_vectors.json` + PBKDF2 锚定向量锁定；Rust→TS 方向依赖 bun + `src/crypto/`，TS 删除后失去意义（不再有 TS 实现会发生变化）。**删除 `crypto_cross.rs` 中 spawn bun 的反向验证段**，保留并改名（如 `crypto_ts_vectors.rs`）纯 fixture 断言部分；`verify-crypto-fixtures.ts`/`gen-crypto-fixtures.ts` 删除。

**步骤：**
- [ ] `git mv packages/cli/tests/compat/fixtures packages/cli/crates/core/tests/fixtures/compat`。
- [ ] `compat_fixtures.rs` 第 6 行路径 `"{}/../../tests/compat/fixtures/{}"` 改为 `"{}/fixtures/compat/{}"`（基准是 `CARGO_MANIFEST_DIR/tests/`）。
- [ ] `crypto_cross.rs`：删除 `verify-crypto-fixtures.ts` spawn 段与相关辅助函数；保留 TS 向量解密断言与 PBKDF2 锚定断言。
- [ ] `cargo test -p swixter-core -p swixter-server` 绿。

**Commit:** `test: relocate compat fixtures into core crate, drop bun-based crypto reverse check`

## Task 9: TS 代码删除 + package.json 清理

**Files:**
- Delete: `packages/cli/src/`（全部）
- Delete: `packages/cli/tests/`（全部；fixtures 已在 Task 8 迁出）
- Delete: `packages/cli/scripts/{export-data.ts,gen-crypto-fixtures.ts,verify-crypto-fixtures.ts}`
- Modify: `packages/cli/package.json`

**Interfaces:** `packages/cli/package.json` 精简为（npm 发布已由 cargo-dist npm installer 接管，此文件仅服务于 bun workspace 与版本同步；dependencies 中与 UI 重复的 react 系包因 ui/ 不在 workspaces 列表、ui 有独立 package.json，全部移除）：

```json
{
  "name": "swixter",
  "version": "0.2.0",
  "private": true,
  "description": "CLI tool for managing AI coding assistant configurations - easily switch between providers (Claude Code, Codex, Continue) with Anthropic, Ollama, or custom APIs",
  "scripts": {
    "test": "cargo test --workspace",
    "test:e2e": "bash test/e2e-docker.sh",
    "build:ui": "cd ui && bun install && bun run build"
  },
  "author": "dawnswwwww",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/dawnswwwww/swixter.git"
  }
}
```

- [ ] 删除 `main`/`module`/`bin`/`files`/`engines`/`dependencies`/`devDependencies`/`peerDependencies`/`prepublishOnly`（npm 包由 cargo-dist 生成自己的 package.json）。
- [ ] 全仓 grep 残留引用：`grep -rn "packages/cli/src\|dist/cli/index.js\|bun run build:cli\|bun test" --include='*.md' --include='*.yml' --include='*.json' --include='*.js' --include='*.sh' .`（排除 node_modules/target），逐处清理。
- [ ] 根目录 `bun install` 通过（website/docs 不受影响）。
- [ ] `cargo test --workspace` 绿；`cargo build --release` 绿。

**Commit:** `chore: remove TypeScript sources superseded by the Rust rewrite`

## Task 10: 文档更新（README / RELEASE-SETUP / CLAUDE.md）

**Files:**
- Modify: `README.md`
- Modify: `docs/RELEASE-SETUP.md`
- Modify: `CLAUDE.md`

**Interfaces:**

README 安装段（现 `npm install -g swixter`，README.md:28）改为四种方式：

```markdown
## Installation

# Shell installer (macOS / Linux)
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/dawnswwwww/swixter/releases/latest/download/swixter-installer.sh | sh

# Homebrew
brew install dawnswwwww/tap/swixter

# npm（安装时从 GitHub Release 下载对应平台二进制；--ignore-scripts 环境请改用 shell installer）
npm install -g swixter

# Cargo
cargo install swixter

# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -c "irm https://github.com/dawnswwwww/swixter/releases/latest/download/swixter-installer.ps1 | iex"
```

（installer URL 路径以 cargo-dist 实际产物名为准，执行时核对 `cargo dist plan` 输出后定稿。）

RELEASE-SETUP.md 重写要点：
- secrets 两个：`NPM_TOKEN`（沿用现有章节）、`CARGO_REGISTRY_TOKEN`（新增章节：crates.io → Account Settings → API Tokens → New Token，scope 限 `publish-update` + 四 crate）。
- **用户手动前置步骤清单**：1) 创建 GitHub 仓库 `dawnswwwww/homebrew-tap`（空仓库即可，cargo-dist 自动推 formula；未创建前 homebrew job 会失败，可临时从 installers 移除 homebrew）；2) 首发前四 crate 需先在 crates.io 占位/确认名称可用（`cargo search swixter`）；3) 配置上述两个 secrets。
- 发布流程更新为：更新 CHANGELOG.md → `bun run release:patch|minor|major`（bump-version.sh：bump Cargo version + sync + commit + tag）→ `git push --follow-tags` → release.yml（dist 矩阵构建 + GitHub Release + npm + brew）与 publish-crates.yml（crates.io）并行执行。
- FAQ 更新：npm `--ignore-scripts` fallback 说明；crates.io publish 失败重跑（已发布的 crate 会报已存在，属幂等）。

CLAUDE.md：Commands 段的 `bun run build`/`cli`/`cli:dev`/`test:e2e` 等改为 cargo 命令（`cargo build --release`、`cargo run -p swixter -- ...`、`cargo test --workspace`、`bash packages/cli/test/e2e-docker.sh`）；Release 段指向新流程；ui/dist 提交约定（Task 2）写入。

**验证：**
- [ ] 文档中每条命令在仓库内实际可跑（除需 secrets/tag 的发布动作）。
- [ ] `grep -n "bun run" CLAUDE.md README.md` 仅剩 website/docs/ui 相关。

**Commit:** `docs: update install and release docs for cargo-dist pipeline`

## M4 完成标准

- [ ] `cargo dist generate --check` 通过；`cargo dist plan` 含 7 target + shell/powershell/npm/homebrew 四 installer。
- [ ] test.yml 全绿：fmt + clippy（-D warnings）+ ubuntu/macos/windows cargo test 矩阵 + Docker E2E 18/18。
- [ ] `cargo publish --dry-run` 四 crate 元数据齐全（description/license/repository）。
- [ ] `node scripts/sync-versions.js` 从 Cargo.toml 单向同步四个 package.json；`--version` 输出来自 `env!("CARGO_PKG_VERSION")`。
- [ ] `packages/cli/src`、`packages/cli/tests`、三个 TS codegen 脚本已删除；compat fixtures 迁移至 `crates/core/tests/fixtures/compat/` 且测试绿；crypto 向量断言（TS→Rust 方向）保留绿。
- [ ] README 四种安装方式、RELEASE-SETUP.md 双 secret + tap 前置步骤、CLAUDE.md cargo 命令全部更新。
- [ ] **范围外（用户操作，文档已列步骤）**：实际打 tag 发布、NPM_TOKEN/CARGO_REGISTRY_TOKEN secrets 配置、`dawnswwwww/homebrew-tap` 仓库创建。

## 风险与注意点汇总

1. **musl 交叉编译**：rustls 底层 C 依赖（ring/aws-lc）在 musl target 可能构建失败；先在 PR（pr-run-mode=plan）与一次 `cargo dist build` 本机/targeted 验证，失败则按预案移除该 musl target。
2. **UI dist 入库**：提交构建产物会让 ui/src 修改与 dist 提交脱节——靠 CLAUDE.md 约定 + review 把关；替代方案（release workflow 里先构建 UI 再 dist build）会与被 cargo-dist 接管的 release.yml 冲突，不采用。
3. **codegen 脚本删除**：presets.json/install.json/crypto 向量此后为 Rust 侧手工维护的权威文件，任何 preset 变更直接改 JSON；如需大批量再生成，临时恢复脚本到独立分支，不在 main 保留 TS 依赖。
4. **cargo publish 顺序与索引延迟**：publish-crates.yml 的 sleep 30 是经验值，首发失败时改轮询重试；`cargo install swixter` 渠道在首发成功前不可用，README 宣传以首发成功为前提（打 tag 属用户操作，顺序上最后再更新 README 宣传语亦可）。
5. **npm 包交接**：cargo-dist npm installer 发布的 `swixter` 包与历史 TS 包同名同 registry，版本必须高于 npm 上已发布的 0.1.12（workspace 0.2.0 满足）；旧包不会被覆盖，用户 `npm install -g swixter@latest` 自然切到新二进制模式。
