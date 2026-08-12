# Swixter CLI Rust 重写设计

- 日期：2026-07-23
- 状态：已确认（用户批准）
- 范围：`packages/cli` 全量重写为 Rust，npm / crates.io / Homebrew 三渠道多平台发布

## 1. 目标与约束

- **全量重写** `packages/cli`（约 1.9 万行 TS）为 Rust，功能对齐当前 v0.1.12：
  - 全部 CLI 命令（`claude` / `codex` / `qwen` / `providers` / `group` / `proxy` / `ui` / `auth` / `sync` / `export` / `import` / `completion` / 交互式菜单）
  - 本地代理（转发、熔断器、Anthropic↔OpenAI Chat/Responses 双向协议转换、SSE 流式）
  - 内嵌 Web UI 后端（HTTP + WebSocket + 静态资源）
  - 云同步（邮箱注册/登录、magic link、AES-256-GCM + PBKDF2 端到端加密、push/pull）
- **配置完全兼容**：`~/.config/swixter/` 下 `config.json` / `providers.json` / `auth.json` 序列化格式逐字段不变；写 `~/.claude/settings.json`、`~/.codex/config.toml`、`~/.continue/config.yaml` 的行为不变。Node 版与 Rust 版可交替使用。
- **原位替换**：Rust 代码进 `packages/cli`，npm 包名 `swixter` 不变。开发期 TS 代码保留在 `packages/cli` 内并行，功能对齐后作为 1.0 发布并删除 TS 代码。
- **三渠道同发**：npm、crates.io、Homebrew tap。平台覆盖：macOS x64/arm64、Linux x64/arm64（gnu + musl）、Windows x64。
- React 前端（`packages/cli/ui`）保留不动，仅重写后端；前端仅需对齐新后端 API。

## 2. 技术栈映射

| 现有 (TS/Node) | Rust | 说明 |
|---|---|---|
| 手工 if/else 路由 + `commands/parsers.ts` | `clap` (derive) | 子命令树，自动生成 help |
| `@clack/prompts` | `dialoguer` + `indicatif` + `console` | select/input/confirm/spinner 交互复刻 |
| `zod` | `serde` + 校验函数 | 配置 schema |
| `smol-toml` | `toml_edit` | 保留 codex `config.toml` 注释和格式（兼容关键点） |
| `js-yaml` | `serde_yaml_ng` | continue.dev `config.yaml` |
| `node:http` + `fetch` + `ws` | `tokio` + `axum` + `reqwest` | 代理与 Web UI 共用 axum 体系 |
| `crypto.subtle`（AES-256-GCM / PBKDF2） | `aes-gcm` + `pbkdf2` + `sha2` | 参数必须与 Web Crypto 逐位对齐（PBKDF2-SHA256 iterations、GCM nonce 长度），否则老用户同步数据无法解密 |
| 内嵌 `dist/ui` 静态产物 | `rust-embed` | 编译期嵌入，保持单文件二进制分发 |
| `semver` / `picocolors` / daemon pid 管理 | `semver` / `anstream` / pid 文件 + `tokio::process` | |

## 3. Cargo workspace 结构

```
packages/cli/
├── Cargo.toml          # workspace 根（workspace version 作为单一版本源）
├── crates/
│   ├── swixter/        # bin crate：clap 路由、交互式菜单、completion、help
│   ├── core/           # config manager、providers、groups、adapters、crypto、auth、sync
│   ├── proxy/          # 代理 server、forwarder、circuit breaker、协议 transform
│   └── server/         # Web UI 后端（REST + WS + rust-embed 静态资源）
├── ui/                 # React 前端（不动）
└── tests/              # E2E（assert_cmd + fixtures）
```

- `core` 不依赖 tokio（除 sync 的 HTTP 客户端外保持同步），配置/adapters 逻辑可单测，并被 proxy/server 复用。
- adapter 接口沿用现有 `CoderAdapter`（apply / verify / remove）三方法设计。
- crates.io 发布顺序：`core` → `proxy` → `server` → `swixter`。

## 4. 兼容性保障（最大风险点）

- **Schema fixture 测试**：用当前 TS 版批量生成真实 `config.json` / `providers.json` / `auth.json` 样本（含边界 case：空 groups、缺字段、用户覆盖内置 provider），作为 Rust 反序列化 round-trip fixtures。
- **Adapter 行为对齐**（逐条行为测试）：
  - claude：`settings.json` 的 `env` 段全量替换（profile 缺失字段被删除），保留 MCP servers 等其他段
  - codex：`swixter-` 前缀的 `[model_providers.*]` / `[profiles.*]` 表、env_key 优先级链（`profile.envKey` > `preset.env_key` > `OPENAI_API_KEY`）、TOML 损坏时先备份、独立 `swixter-<name>.config.toml` profile 文件（Codex 0.134.0+）
  - continue：`config.yaml` 的 model/apiKey 字段修改
- **加密对齐**：「TS 加密 → Rust 解密」与反向交叉测试向量，锁定 PBKDF2 参数。
- **协议转换回归**：录制真实 Anthropic/OpenAI 请求响应（含 SSE 流）做回放测试，覆盖双向 transform。

## 5. 发布流水线（cargo-dist）

- `dist-workspace.toml` 声明 targets + installers：`shell`、`powershell`、`npm`、`homebrew`（推送到 `homebrew-tap` 仓库）。
- 流程：`git tag v*` → cargo-dist 生成的 `release.yml` → 矩阵构建 7 个 target（mac x64/arm64、linux x64/arm64 gnu、linux x64/arm64 musl、windows x64）→ GitHub Release → 发布 npm 包 + 更新 brew tap formula。
- crates.io：同一 workflow 内按依赖顺序 `cargo publish`。
- `scripts/sync-versions.js` 改造：同步 `Cargo.toml` workspace version、cargo-dist npm 包版本、website/docs 的 package.json；`APP_VERSION` 改为编译期 `env!("CARGO_PKG_VERSION")`，消灭手工同步点。
- npm 取舍说明：cargo-dist 的 npm 包是「安装时从 GitHub Release 下载对应平台二进制」模式，非 optionalDependencies 平台包；严格 `--ignore-scripts` 环境需 fallback 到 shell installer，写入文档。

## 6. 测试策略

- `cargo test`：core 全量单测 + transform/crypto 测试向量。
- E2E：现有 18 个 Docker 场景脚本（`packages/cli/test/e2e-docker.sh` + `test/scenarios/`）保留，调用对象从 node dist 换成 Rust 二进制，断言基本不变——作为行为对齐验证。
- CI：`fmt` + `clippy` + `test` 矩阵（ubuntu/macos/windows），E2E 在 Linux Docker 跑。

## 7. 里程碑

- **M1 核心 CLI**：core crate + clap 全部命令 + adapters + 交互模式；config fixture 测试通过
- **M2 代理**：proxy crate（转发、熔断、SSE 双向转换）；协议回放测试通过
- **M3 Web UI + 云同步**：server crate + auth/sync/crypto；前端 API 对齐
- **M4 发布**：cargo-dist 流水线、三渠道冒烟、E2E 全绿 → 1.0 发布，删除 TS 代码

## 8. 已确认的决策记录

| 决策点 | 结论 |
|---|---|
| 重写范围 | 全量重写（含代理、Web UI、云同步） |
| 迁移策略 | 直接替换，Rust 版 1.0 发布后 Node 版停更 |
| 配置兼容 | 完全兼容，两版可交替使用 |
| 发布方案 | cargo-dist 全家桶 + crates.io `cargo publish` |
| 仓库布局 | 原位替换 `packages/cli`，npm 包名不变 |
| Web UI | React 前端保留，Rust 重写后端 |
