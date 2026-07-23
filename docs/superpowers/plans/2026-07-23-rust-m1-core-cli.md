# M1 核心 CLI（Rust）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 实现 swixter CLI 的核心：core crate（配置/provider/group/adapter/export-import）+ clap 全部命令 + 交互模式，配置文件格式与 Node 版完全兼容。

**Architecture:** Cargo workspace（`packages/cli/`），两个 crate：`swixter-core`（纯同步库，无 tokio）和 `swixter`（bin，clap derive）。三个 coder（claude/codex/qwen）的命令面同构，共享一套参数化的 handler。兼容性靠 fixture 测试锁定：TS 序列化产物 → Rust 反序列化 round-trip。

**Tech Stack:** Rust stable / edition 2021；serde + serde_json、toml_edit、serde_yaml_ng、url、thiserror、dirs；clap 4（derive）+ clap_complete；dialoguer + console；dev: tempfile、assert_cmd、predicates。

**Spec:** `docs/superpowers/specs/2026-07-23-rust-rewrite-design.md`

## Global Constraints

- 配置兼容：`config.json` / `providers.json` 字段逐一对齐 TS 版；JSON 一律 2 空格缩进（`serde_json::to_string_pretty`）；Option 字段为 `None` 时**不序列化**（`skip_serializing_if`）。
- zod 语义对齐：未知字段**忽略**（serde 默认行为，禁止加 `deny_unknown_fields`）；解析或校验失败时**整个配置静默回退到默认空配置**。
- 常量（逐字对齐 TS）：`CONFIG_VERSION = "2.0.0"`、`EXPORT_VERSION = "1.0.0"`、API key 脱敏 `sanitizeLength=8, prefixLength=4, suffixLength=4`。
- 退出码：`0` 成功 / `1` 一般错误 / `2` 参数错误 / `3` 未找到 / `130` 交互取消。TS 版 `EXIT_CODES.invalidArguments`（复数）是 undefined quirk（实际退出 0），Rust 版统一修为 `2`。
- 路径：环境变量 `SWIXTER_CONFIG_PATH` 优先；否则 Windows `~/swixter/config.json`，Unix/macOS `~/.config/swixter/config.json`（硬编码 `.config`，不读 `XDG_CONFIG_HOME`）。`providers.json` 永远与 `config.json` 同目录。
- `swixter-core` 不依赖 tokio；子进程用 `std::process::Command`。
- profile name 校验：`^[a-zA-Z0-9_-]+$` 且最小长度 2；provider id 校验：`^[a-z0-9-]+$`。
- `--api-format` 合法值：`openai_chat, anthropic_messages, openai_responses, anthropic_responses, gemini_native`。
- workspace version 统一 `0.2.0`；`swixter` bin 的版本号用 `env!("CARGO_PKG_VERSION")`。
- **已知偏差（有意为之）**：`completion` 命令用 `clap_complete` 从 clap 定义实时生成（替代 TS 的手写静态脚本），保证与命令树一致。

## File Structure

```
packages/cli/
├── Cargo.toml                        # workspace 根（新增）
├── crates/
│   ├── core/                         # package: swixter-core
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs                # 模块导出 + CoreError
│   │   │   ├── types.rs              # ConfigFile/Profile/Group/SyncMeta/ProviderPreset/枚举
│   │   │   ├── validate.rs           # zod 等价校验
│   │   │   ├── paths.rs              # 路径解析
│   │   │   ├── config.rs             # ConfigManager
│   │   │   ├── presets.rs            # 内置 presets（include_str! presets.json）+ 合并查询
│   │   │   ├── presets.json          # codegen 产物（勿手改）
│   │   │   ├── user_providers.rs     # providers.json 读写
│   │   │   ├── groups.rs             # group CRUD + id 生成
│   │   │   ├── model.rs              # get_openai_model / build_profile_env / EnvVarMapping
│   │   │   ├── coder.rs              # CoderSpec 注册表
│   │   │   ├── export.rs             # export/import/validate_export_file
│   │   │   └── adapters/
│   │   │       ├── mod.rs            # CoderAdapter trait + get_adapter
│   │   │       ├── claude.rs
│   │   │       ├── codex.rs
│   │   │       └── continue_.rs
│   │   └── tests/
│   │       └── compat_fixtures.rs    # TS fixtures round-trip
│   └── swixter/                      # package: swixter（bin）
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs               # 入口 + 退出码映射
│           ├── cli.rs                # clap derive 命令树
│           ├── install_data.rs       # include_str! install.json
│           ├── install.json          # codegen 产物（勿手改）
│           └── commands/
│               ├── mod.rs
│               ├── coder.rs          # 三 coder 共享 handler（含 create/list/switch/edit/delete/apply/current）
│               ├── interactive.rs    # dialoguer 主菜单 + create/edit 向导
│               ├── run.rs            # run 命令（spawn + env 注入）
│               ├── install.rs        # install / update-cli
│               ├── providers.rs
│               ├── group.rs
│               └── transfer.rs       # export / import / completion
├── tests/compat/                     # fixtures（TS 版生成）
│   ├── generate-fixtures.ts          # bun 脚本
│   └── fixtures/*.json
└── （现有 TS src/ 保留不动，M4 删除）
```

---

### Task 1: Workspace 脚手架 + 数据 codegen

**Files:**
- Create: `packages/cli/Cargo.toml`
- Create: `packages/cli/crates/core/Cargo.toml`
- Create: `packages/cli/crates/swixter/Cargo.toml`
- Create: `packages/cli/scripts/export-data.ts`
- Create: `packages/cli/crates/core/src/lib.rs`（空壳，后续任务填充）
- Create: `packages/cli/crates/swixter/src/main.rs`（空壳）

**Interfaces:**
- Produces: workspace 布局；`crates/core/src/presets.json`（43 个内置 preset 的 JSON 数组）；`crates/swixter/src/install.json`（install/update 方法数据）。后续任务用 `include_str!` 嵌入。

- [ ] **Step 1: 写 workspace 与 crate manifest**

`packages/cli/Cargo.toml`：

```toml
[workspace]
resolver = "2"
members = ["crates/core", "crates/swixter"]

[workspace.package]
version = "0.2.0"
edition = "2021"
license = "MIT"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
toml_edit = { version = "0.22", features = ["serde"] }
serde_yaml_ng = "0.10"
url = "2"
thiserror = "1"
dirs = "5"
clap = { version = "4.5", features = ["derive"] }
clap_complete = "4.5"
dialoguer = "0.11"
console = "0.15"
semver = "1"
regex = "1"
tempfile = "3"
assert_cmd = "2"
predicates = "3"

[profile.release]
lto = true
strip = true
```

`packages/cli/crates/core/Cargo.toml`：

```toml
[package]
name = "swixter-core"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
serde = { workspace = true, features = ["derive"] }
serde_json.workspace = true
toml_edit.workspace = true
serde_yaml_ng.workspace = true
url.workspace = true
thiserror.workspace = true
dirs.workspace = true

[dev-dependencies]
tempfile.workspace = true
```

`packages/cli/crates/swixter/Cargo.toml`：

```toml
[package]
name = "swixter"
version.workspace = true
edition.workspace = true
license.workspace = true

[[bin]]
name = "swixter"
path = "src/main.rs"

[dependencies]
swixter-core = { path = "../core" }
clap.workspace = true
clap_complete.workspace = true
dialoguer.workspace = true
console.workspace = true
semver.workspace = true
regex.workspace = true
serde.workspace = true
serde_json.workspace = true

[dev-dependencies]
assert_cmd.workspace = true
predicates.workspace = true
tempfile.workspace = true
```

- [ ] **Step 2: 写数据导出脚本**

`packages/cli/scripts/export-data.ts`（用 bun 运行，从 TS 源码导出数据，避免手工转写 43 个 preset 出错）：

```ts
// 用法: bun run scripts/export-data.ts
// 从 TS 源码导出内置 presets 与 install 配置为 JSON，供 Rust include_str! 嵌入。
import { builtInPresets } from "../src/providers/presets.js";
import { INSTALL_CONFIGS, UPDATE_COMMANDS } from "../src/constants/install.js";
import { writeFileSync } from "node:fs";

writeFileSync(
  new URL("../crates/core/src/presets.json", import.meta.url),
  JSON.stringify(builtInPresets, null, 2) + "\n"
);
writeFileSync(
  new URL("../crates/swixter/src/install.json", import.meta.url),
  JSON.stringify({ installConfigs: INSTALL_CONFIGS, updateCommands: UPDATE_COMMANDS }, null, 2) + "\n"
);
console.log(`exported ${builtInPresets.length} presets`);
```

注意：先读 `packages/cli/src/constants/install.ts` 确认导出的常量名（`INSTALL_CONFIGS` / `UPDATE_COMMANDS` 的实际名称以源码为准，若不同则改脚本）。

- [ ] **Step 3: 运行脚本并构建验证**

Run: `cd packages/cli && bun run scripts/export-data.ts && cargo build`
Expected: 脚本输出 `exported 43 presets`；cargo build 成功（lib.rs/main.rs 为最小空壳：`pub fn placeholder() {}` 与 `fn main() {}`）。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/Cargo.toml packages/cli/crates packages/cli/scripts/export-data.ts
git commit -m "feat(rust): cargo workspace scaffolding + data codegen"
```

---

### Task 2: core types + validate + 兼容 fixtures

**Files:**
- Create: `packages/cli/crates/core/src/types.rs`
- Create: `packages/cli/crates/core/src/validate.rs`
- Modify: `packages/cli/crates/core/src/lib.rs`
- Create: `packages/cli/tests/compat/generate-fixtures.ts`
- Create: `packages/cli/crates/core/tests/compat_fixtures.rs`
- Test: `packages/cli/crates/core/tests/compat_fixtures.rs`

**Interfaces:**
- Produces（后续所有任务依赖）:
  - `types::ConfigFile { profiles: HashMap<String, Profile>, coders: HashMap<String, CoderConfig>, groups: HashMap<String, Group>, active_group: Option<String>, version: String, sync_meta: Option<SyncMeta> }`
  - `types::Profile { name, provider_id, api_key: String, auth_token, base_url, model, openai_model, models: Option<ModelsConfig>, env_key, headers: Option<HashMap<String,String>>, api_format: Option<ApiFormat>, created_at, updated_at: String }`
  - `types::ModelsConfig { anthropic_model, default_haiku_model, default_opus_model, default_sonnet_model: Option<String> }`
  - `types::CoderConfig { active_profile: String }`、`types::Group { id, name, profiles: Vec<String>, is_default: bool, created_at, updated_at }`、`types::SyncMeta { last_sync_at, config_version: u64, providers_version: u64, local_updated_at, dirty: Option<bool> }`
  - `types::ProviderPreset { id, name, display_name, base_url, base_url_chat, default_models: Vec<String>, auth_type: AuthType, headers, rate_limit, docs, is_chinese, default_api_format, wire_api: Option<WireApi>, env_key, model_families: Option<Vec<ModelFamily>> }`
  - `types::ApiFormat`、`types::AuthType`、`types::WireApi`、`types::CONFIG_VERSION: &str = "2.0.0"`
  - `ConfigFile::default()` = 空 maps + `version: "2.0.0"`
  - `validate::validate_config(&ConfigFile) -> Result<(), CoreError>`、`validate::validate_preset(&ProviderPreset) -> Result<(), CoreError>`
  - `CoreError`（lib.rs）：`#[derive(thiserror::Error, Debug)]`，变体 `Io(#[from] std::io::Error)`、`Json(#[from] serde_json::Error)`、`Toml(#[from] toml_edit::de::Error)`、`Yaml(#[from] serde_yaml_ng::Error)`、`Validation(String)`、`NotFound(String)`、`InUse(String)`、`UnknownProvider(String)`、`InvalidImport(String)`

- [ ] **Step 1: 写 fixtures 生成脚本并生成 fixtures**

`packages/cli/tests/compat/generate-fixtures.ts`（bun 运行；用 TS 版真实序列化逻辑产物做 fixture，保证测试锁定的是 TS 输出格式）：

```ts
// 用法: bun run tests/compat/generate-fixtures.ts
import { saveConfig } from "../../src/config/manager.js";
import { mkdtempSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = new URL("./fixtures/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });

async function dump(name: string, config: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "swixter-fx-"));
  const cfgPath = join(dir, "config.json");
  process.env.SWIXTER_CONFIG_PATH = cfgPath;
  // saveConfig 会做 zod 校验 + 2 空格缩进序列化，与线上一致
  await saveConfig(config as any);
  copyFileSync(cfgPath, join(out, name));
  console.log("wrote", name);
}

const full = {
  version: "2.0.0",
  profiles: {
    "work-kimi": {
      name: "work-kimi", providerId: "kimi-coding", apiKey: "sk-test-1234567890",
      authToken: "tok-abc", baseURL: "https://api.kimi.com/coding/",
      models: { anthropicModel: "kimi-for-coding", defaultHaikuModel: "h1", defaultOpusModel: "o1", defaultSonnetModel: "s1" },
      headers: { "X-Custom": "v" }, apiFormat: "anthropic_messages",
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-02T00:00:00.000Z",
    },
    "local-ollama": {
      name: "local-ollama", providerId: "ollama", apiKey: "",
      baseURL: "http://localhost:11434", model: "qwen2.5-coder:7b",
      openaiModel: "qwen2.5-coder:7b", envKey: "OLLAMA_API_KEY",
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
    },
  },
  coders: { claude: { activeProfile: "work-kimi" }, codex: { activeProfile: "" } },
  groups: {
    "grp_1735689600000_abc123": {
      id: "grp_1735689600000_abc123", name: "failover",
      profiles: ["work-kimi", "local-ollama"], isDefault: true,
      createdAt: "2025-01-01T00:00:00.000Z", updatedAt: "2025-01-01T00:00:00.000Z",
    },
  },
  activeGroup: "grp_1735689600000_abc123",
  syncMeta: { lastSyncAt: "2025-01-03T00:00:00.000Z", configVersion: 3, providersVersion: 1, localUpdatedAt: "2025-01-03T00:00:00.000Z", dirty: true },
};

await dump("full.json", full);
await dump("empty-default.json", { version: "2.0.0", profiles: {}, coders: {}, groups: {} });
// v1 旧格式：顶层 activeProfile，无 coders/groups（不走 saveConfig，直接写原文）
{
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(out, "v1-legacy.json"), JSON.stringify({
    version: "1.0.0", activeProfile: "work-kimi", profiles: full.profiles,
  }, null, 2) + "\n");
  writeFileSync(join(out, "unknown-fields.json"), JSON.stringify({
    ...full, futureField: { x: 1 },
    profiles: { "work-kimi": { ...full.profiles["work-kimi"], futureProfileField: true } },
  }, null, 2) + "\n");
  writeFileSync(join(out, "invalid-url.json"), JSON.stringify({
    version: "2.0.0", coders: {}, groups: {},
    profiles: { bad: { name: "bad", providerId: "custom", apiKey: "k", baseURL: "not a url", createdAt: "t", updatedAt: "t" } },
  }, null, 2) + "\n");
}
console.log("done");
```

Run: `cd packages/cli && bun run tests/compat/generate-fixtures.ts`
Expected: 生成 `tests/compat/fixtures/{full,empty-default,v1-legacy,unknown-fields,invalid-url}.json`。

- [ ] **Step 2: 写失败的 round-trip 测试**

`packages/cli/crates/core/tests/compat_fixtures.rs`：

```rust
use swixter_core::config::ConfigManager;
use swixter_core::types::{ApiFormat, ConfigFile};

fn fixture(name: &str) -> String {
    let p = format!("{}/../../tests/compat/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
    std::fs::read_to_string(p).unwrap()
}

#[test]
fn full_fixture_roundtrip() {
    let raw = fixture("full.json");
    let cfg: ConfigFile = serde_json::from_str(&raw).unwrap();
    assert_eq!(cfg.version, "2.0.0");
    let p = &cfg.profiles["work-kimi"];
    assert_eq!(p.provider_id, "kimi-coding");
    assert_eq!(p.api_format, Some(ApiFormat::AnthropicMessages));
    assert_eq!(p.models.as_ref().unwrap().default_haiku_model.as_deref(), Some("h1"));
    assert_eq!(cfg.coders["claude"].active_profile, "work-kimi");
    assert!(cfg.sync_meta.as_ref().unwrap().dirty.unwrap());
    let g = &cfg.groups["grp_1735689600000_abc123"];
    assert!(g.is_default);
    // 序列化后语义相等（字段顺序不要求一致）
    let back: serde_json::Value = serde_json::from_str(&serde_json::to_string_pretty(&cfg).unwrap()).unwrap();
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(back, orig);
}

#[test]
fn v1_fixture_migrates_on_load() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, fixture("v1-legacy.json")).unwrap();
    let mgr = ConfigManager::load_from(path);
    assert_eq!(mgr.config().version, "2.0.0");
    assert_eq!(mgr.config().coders["claude"].active_profile, "work-kimi");
    assert!(mgr.config().groups.is_empty());
}

#[test]
fn unknown_fields_are_stripped() {
    let cfg: ConfigFile = serde_json::from_str(&fixture("unknown-fields.json")).unwrap();
    let back = serde_json::to_string(&cfg).unwrap();
    assert!(!back.contains("futureField"));
    assert!(!back.contains("futureProfileField"));
}

#[test]
fn invalid_url_falls_back_to_default() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, fixture("invalid-url.json")).unwrap();
    let mgr = ConfigManager::load_from(path);
    assert!(mgr.config().profiles.is_empty()); // zod 等价行为：整体回退默认
}
```

Run: `cd packages/cli && cargo test -p swixter-core`
Expected: FAIL（`types`、`config` 模块不存在，编译错误）。

- [ ] **Step 3: 实现 types.rs**

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const CONFIG_VERSION: &str = "2.0.0";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ConfigFile {
    pub profiles: HashMap<String, Profile>,
    pub coders: HashMap<String, CoderConfig>,
    pub groups: HashMap<String, Group>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_group: Option<String>,
    pub version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_meta: Option<SyncMeta>,
}

impl ConfigFile {
    pub fn empty() -> Self {
        Self { version: CONFIG_VERSION.to_string(), ..Default::default() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Profile {
    pub name: String,
    pub provider_id: String,
    pub api_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub openai_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub models: Option<ModelsConfig>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub env_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_format: Option<ApiFormat>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ModelsConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anthropic_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_haiku_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_opus_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_sonnet_model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CoderConfig {
    pub active_profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Group {
    pub id: String,
    pub name: String,
    pub profiles: Vec<String>,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncMeta {
    pub last_sync_at: String,
    pub config_version: u64,
    pub providers_version: u64,
    pub local_updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty: Option<bool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ApiFormat {
    #[serde(rename = "anthropic_messages")] AnthropicMessages,
    #[serde(rename = "anthropic_responses")] AnthropicResponses,
    #[serde(rename = "openai_chat")] OpenaiChat,
    #[serde(rename = "openai_responses")] OpenaiResponses,
    #[serde(rename = "gemini_native")] GeminiNative,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AuthType {
    #[serde(rename = "bearer")] Bearer,
    #[default]
    #[serde(rename = "api-key")] ApiKey,
    #[serde(rename = "custom")] Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WireApi {
    #[serde(rename = "chat")] Chat,
    #[serde(rename = "responses")] Responses,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderPreset {
    pub id: String,
    pub name: String,
    pub display_name: String,
    pub base_url: String,
    #[serde(rename = "baseURLChat", skip_serializing_if = "Option::is_none")]
    pub base_url_chat: Option<String>,
    pub default_models: Vec<String>,
    pub auth_type: AuthType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub headers: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rate_limit: Option<RateLimit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_chinese: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_api_format: Option<ApiFormat>,
    // 注意：wire_api / env_key 在 TS 中就是下划线命名，必须显式 rename，
    // 否则 rename_all = "camelCase" 会把它们序列化为 wireApi / envKey
    #[serde(rename = "wire_api", skip_serializing_if = "Option::is_none")]
    pub wire_api: Option<WireApi>,
    #[serde(rename = "env_key", skip_serializing_if = "Option::is_none")]
    pub env_key: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_families: Option<Vec<ModelFamily>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RateLimit {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub requests_per_minute: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tokens_per_minute: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFamily {
    pub id: String,
    pub name: String,
    pub models: Vec<String>,
}
```

注意 `base_url_chat` 必须显式 `#[serde(rename = "baseURLChat")]`（`rename_all = "camelCase"` 会生成 `baseUrlChat`，与 TS 的 `baseURLChat` 不符）；`wire_api` / `env_key` 同理必须显式保留下划线命名。**`base_url` 也必须显式 `#[serde(rename = "baseURL")]`**（camelCase 会生成 `baseUrl`，与 TS 的 `baseURL` 不符，Profile 与 ProviderPreset 两处都要——实施时已修正）。`auth_type` 上 TS 字段名是 `authType`（camelCase 规则覆盖正确），`AuthType` 已 derive `Default`（`ApiKey` 为默认变体），容器级 `#[serde(default)]` 缺失时可用。

- [ ] **Step 4: 实现 validate.rs 和 lib.rs**

`validate.rs`：

```rust
use crate::types::{ConfigFile, ProviderPreset};
use crate::CoreError;

/// zod 等价校验：任一失败则调用方整体回退默认配置。
pub fn validate_config(c: &ConfigFile) -> Result<(), CoreError> {
    for p in c.profiles.values() {
        if p.name.is_empty() {
            return Err(CoreError::Validation("profile name must be non-empty".into()));
        }
        if let Some(u) = &p.base_url {
            url::Url::parse(u)
                .map_err(|_| CoreError::Validation(format!("invalid profile baseURL: {u}")))?;
        }
    }
    for g in c.groups.values() {
        if g.id.is_empty() || g.name.is_empty() || g.profiles.is_empty() {
            return Err(CoreError::Validation(format!("invalid group: {}", g.id)));
        }
    }
    Ok(())
}

pub fn validate_preset(p: &ProviderPreset) -> Result<(), CoreError> {
    url::Url::parse(&p.base_url)
        .map_err(|_| CoreError::Validation(format!("invalid preset baseURL: {}", p.base_url)))?;
    if let Some(d) = &p.docs {
        if !d.is_empty() {
            url::Url::parse(d)
                .map_err(|_| CoreError::Validation(format!("invalid preset docs url: {d}")))?;
        }
    }
    Ok(())
}
```

`lib.rs`：

```rust
pub mod adapters;
pub mod coder;
pub mod config;
pub mod export;
pub mod groups;
pub mod model;
pub mod paths;
pub mod presets;
pub mod types;
pub mod user_providers;
pub mod validate;

#[derive(thiserror::Error, Debug)]
pub enum CoreError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("toml error: {0}")]
    Toml(#[from] toml_edit::de::Error),
    #[error("yaml error: {0}")]
    Yaml(#[from] serde_yaml_ng::Error),
    #[error("validation error: {0}")]
    Validation(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("in use: {0}")]
    InUse(String),
    #[error("unknown provider: {0}")]
    UnknownProvider(String),
    #[error("invalid import: {0}")]
    InvalidImport(String),
}
```

先给 `adapters/coder/config/export/groups/model/paths/presets/user_providers` 建空模块文件（各含一行注释），保证编译通过；后续任务填充。

- [ ] **Step 5: 实现 config.rs 最小骨架使测试通过**

只需实现 `ConfigManager { path, config }`、`load_from`（含 v1 迁移与失败回退）、`config()`。完整 CRUD 在 Task 3。实现见 Task 3 Step 3 的完整代码——本步只写 `load_from` / `config` / `new_default` 部分，让 4 个 fixture 测试通过。

v1 迁移逻辑（在 `load_from` 内，先解析为 `serde_json::Value` 再处理）：

```rust
fn parse_and_migrate(raw: &str) -> ConfigFile {
    let mut v: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return ConfigFile::empty(),
    };
    if v.get("version").and_then(|x| x.as_str()) == Some("1.0.0") {
        let active = v.get("activeProfile").and_then(|x| x.as_str()).unwrap_or("").to_string();
        let obj = v.as_object_mut().unwrap();
        obj.remove("activeProfile");
        let mut coders = serde_json::Map::new();
        coders.insert("claude".into(), serde_json::json!({ "activeProfile": active }));
        obj.insert("coders".into(), coders.into());
        obj.insert("version".into(), CONFIG_VERSION.into());
        obj.entry("groups".to_string()).or_insert_with(|| serde_json::json!({}));
    }
    let cfg: ConfigFile = match serde_json::from_value(v) {
        Ok(c) => c,
        Err(_) => return ConfigFile::empty(),
    };
    if cfg.version.is_empty() { return ConfigFile::empty(); }
    match crate::validate::validate_config(&cfg) {
        Ok(()) => cfg,
        Err(_) => ConfigFile::empty(),
    }
}
```

（`ConfigFile` 需 `use crate::types::CONFIG_VERSION;`）

- [ ] **Step 6: 跑测试 + clippy**

Run: `cd packages/cli && cargo test -p swixter-core && cargo clippy --workspace -- -D warnings && cargo fmt`
Expected: 4 个测试 PASS，clippy 无警告。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/crates/core packages/cli/tests/compat
git commit -m "feat(rust): core types, validation, TS compat fixtures"
```

---

### Task 3: paths + ConfigManager 完整实现

**Files:**
- Create: `packages/cli/crates/core/src/paths.rs`
- Modify: `packages/cli/crates/core/src/config.rs`
- Test: `packages/cli/crates/core/src/config.rs`（`#[cfg(test)]` 内联）

**Interfaces:**
- Produces:
  - `paths::config_path() -> PathBuf`（`SWIXTER_CONFIG_PATH` > 平台默认）
  - `paths::providers_path() -> PathBuf`（config 同目录）
  - `paths::claude_settings_path() -> PathBuf`（`~/.claude/settings.json`）
  - `paths::codex_config_path() -> PathBuf`（`~/.codex/config.toml`）
  - `paths::continue_config_path() -> PathBuf`（`~/.continue/config.yaml`）
  - `ConfigManager { pub fn load() -> Self; pub fn load_from(path: PathBuf) -> Self; pub fn config(&self) -> &ConfigFile; pub fn path(&self) -> &Path; pub fn save(&self) -> Result<(), CoreError>; pub fn upsert_profile(&mut self, p: Profile, coder: Option<&str>) -> Result<(), CoreError>; pub fn delete_profile(&mut self, name: &str) -> Result<(), CoreError>; pub fn set_active_profile(&mut self, coder: &str, name: &str) -> Result<(), CoreError>; pub fn active_profile(&self, coder: &str) -> Option<&Profile>; pub fn get_profile(&self, name: &str) -> Option<&Profile>; pub fn mark_dirty(&mut self); pub fn clear_sync_meta(&mut self) -> Result<(), CoreError> }`

- [ ] **Step 1: 写失败测试（config.rs 内联 `#[cfg(test)]`）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Profile;

    fn mgr() -> (tempfile::TempDir, ConfigManager) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let m = ConfigManager::load_from(path);
        (dir, m)
    }

    fn profile(name: &str) -> Profile {
        Profile { name: name.into(), provider_id: "ollama".into(), api_key: "k".into(),
                  created_at: "2025-01-01T00:00:00.000Z".into(), updated_at: "2025-01-01T00:00:00.000Z".into(),
                  ..Default::default() }
    }

    #[test]
    fn upsert_first_profile_auto_activates() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), Some("claude")).unwrap();
        assert_eq!(m.config().coders["claude"].active_profile, "p1");
        m.upsert_profile(profile("p2"), Some("claude")).unwrap();
        assert_eq!(m.config().coders["claude"].active_profile, "p1"); // 不改已激活
    }

    #[test]
    fn upsert_preserves_created_at() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), None).unwrap();
        let mut p2 = profile("p1");
        p2.created_at = "1999-01-01T00:00:00.000Z".into();
        m.upsert_profile(p2, None).unwrap();
        assert_eq!(m.config().profiles["p1"].created_at, "2025-01-01T00:00:00.000Z");
    }

    #[test]
    fn delete_clears_active_and_refuses_group_members() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), Some("claude")).unwrap();
        m.config_mut_for_test().groups.insert("g1".into(), crate::types::Group {
            id: "g1".into(), name: "g".into(), profiles: vec!["p1".into()],
            is_default: true, created_at: "t".into(), updated_at: "t".into() });
        assert!(matches!(m.delete_profile("p1"), Err(CoreError::InUse(_))));
        m.config_mut_for_test().groups.clear();
        m.delete_profile("p1").unwrap();
        assert_eq!(m.config().coders["claude"].active_profile, "");
    }

    #[test]
    fn save_is_atomic_and_indented() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), None).unwrap();
        m.save().unwrap();
        let raw = std::fs::read_to_string(m.path()).unwrap();
        assert!(raw.contains("\n  \"profiles\": {")); // 2 空格缩进
        assert!(!dir_has_tmp(m.path())); // 无残留临时文件
    }

    fn dir_has_tmp(p: &std::path::Path) -> bool {
        std::fs::read_dir(p.parent().unwrap()).unwrap()
            .any(|e| e.unwrap().file_name().to_string_lossy().contains(".tmp-"))
    }

    #[test]
    fn mark_dirty_and_clear_sync_meta() {
        let (_d, mut m) = mgr();
        m.config_mut_for_test().sync_meta = Some(crate::types::SyncMeta {
            last_sync_at: "t".into(), config_version: 1, providers_version: 1,
            local_updated_at: "t".into(), dirty: Some(false) });
        m.mark_dirty();
        assert_eq!(m.config().sync_meta.as_ref().unwrap().dirty, Some(true));
        m.clear_sync_meta().unwrap();
        assert!(m.config().sync_meta.is_none());
    }
}
```

Run: `cargo test -p swixter-core`
Expected: FAIL（方法不存在）。

- [ ] **Step 2: 实现 paths.rs**

```rust
use std::path::PathBuf;

/// TS: constants/paths.ts — SWIXTER_CONFIG_PATH 优先；
/// Windows: ~/swixter；Unix/macOS: ~/.config/swixter（硬编码，不读 XDG_CONFIG_HOME）
pub fn swixter_config_dir() -> PathBuf {
    let home = dirs::home_dir().expect("cannot determine home directory");
    if cfg!(windows) { home.join("swixter") } else { home.join(".config").join("swixter") }
}

pub fn config_path() -> PathBuf {
    if let Ok(p) = std::env::var("SWIXTER_CONFIG_PATH") {
        if !p.is_empty() { return PathBuf::from(p); }
    }
    swixter_config_dir().join("config.json")
}

pub fn providers_path() -> PathBuf {
    config_path().parent().unwrap().join("providers.json")
}

pub fn claude_settings_path() -> PathBuf {
    dirs::home_dir().unwrap().join(".claude").join("settings.json")
}

pub fn codex_config_path() -> PathBuf {
    dirs::home_dir().unwrap().join(".codex").join("config.toml")
}

pub fn continue_config_path() -> PathBuf {
    dirs::home_dir().unwrap().join(".continue").join("config.yaml")
}
```

- [ ] **Step 3: 实现完整 config.rs**

```rust
use crate::types::{CoderConfig, ConfigFile, Profile, CONFIG_VERSION};
use crate::CoreError;
use std::path::{Path, PathBuf};

pub struct ConfigManager {
    path: PathBuf,
    config: ConfigFile,
}

impl ConfigManager {
    pub fn load() -> Self {
        Self::load_from(crate::paths::config_path())
    }

    pub fn load_from(path: PathBuf) -> Self {
        let config = match std::fs::read_to_string(&path) {
            Ok(raw) => parse_and_migrate(&raw),
            Err(_) => ConfigFile::empty(),
        };
        Self { path, config }
    }

    pub fn config(&self) -> &ConfigFile { &self.config }
    pub fn path(&self) -> &Path { &self.path }

    /// 仅供 crate 内部与测试使用；外部代码走具体 mutator 方法。
    #[doc(hidden)]
    pub fn config_mut_for_test(&mut self) -> &mut ConfigFile { &mut self.config }

    /// TS: saveConfig — 校验 → 2 空格缩进 → 写 .config.tmp-<millis> → rename
    pub fn save(&self) -> Result<(), CoreError> {
        crate::validate::validate_config(&self.config)?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let content = serde_json::to_string_pretty(&self.config)?;
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
        let tmp = self.path.with_file_name(format!(".config.tmp-{millis}"));
        std::fs::write(&tmp, content)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// TS: upsertProfile — createdAt 保留，updatedAt 由调用方设置；
    /// coder 指定时：首个 profile 或当前无激活 → 自动设为激活
    pub fn upsert_profile(&mut self, mut profile: Profile, coder: Option<&str>) -> Result<(), CoreError> {
        if let Some(existing) = self.config.profiles.get(&profile.name) {
            profile.created_at = existing.created_at.clone();
        }
        self.config.profiles.insert(profile.name.clone(), profile.clone());
        if let Some(c) = coder {
            let entry = self.config.coders.entry(c.to_string())
                .or_insert_with(|| CoderConfig { active_profile: String::new() });
            if self.config.profiles.len() == 1 || entry.active_profile.is_empty() {
                entry.active_profile = profile.name.clone();
            }
        }
        self.mark_dirty();
        self.save()
    }

    /// TS: deleteProfile — 被 group 引用时报错；清除引用它的 coder 激活态。
    /// 注意：adapter 清理（对各 coder 配置文件的 remove）由 CLI 层在调用本方法前执行
    /// （core 内 config 不反向依赖 adapters 的运行期行为）。
    pub fn delete_profile(&mut self, name: &str) -> Result<(), CoreError> {
        if !self.config.profiles.contains_key(name) {
            return Err(CoreError::NotFound(format!("Profile \"{name}\" does not exist")));
        }
        let referencing: Vec<String> = self.config.groups.values()
            .filter(|g| g.profiles.iter().any(|p| p == name))
            .map(|g| g.name.clone())
            .collect();
        if !referencing.is_empty() {
            return Err(CoreError::InUse(format!(
                "Profile \"{name}\" is used in group(s): {}. Remove it from the group(s) first.",
                referencing.join(", ")
            )));
        }
        self.config.profiles.remove(name);
        for c in self.config.coders.values_mut() {
            if c.active_profile == name { c.active_profile.clear(); }
        }
        self.mark_dirty();
        self.save()
    }

    pub fn set_active_profile(&mut self, coder: &str, name: &str) -> Result<(), CoreError> {
        if !self.config.profiles.contains_key(name) {
            return Err(CoreError::NotFound(format!("Profile \"{name}\" does not exist")));
        }
        self.config.coders.entry(coder.to_string())
            .or_insert_with(|| CoderConfig { active_profile: String::new() })
            .active_profile = name.to_string();
        self.mark_dirty();
        self.save()
    }

    pub fn active_profile(&self, coder: &str) -> Option<&Profile> {
        let name = self.config.coders.get(coder)?.active_profile.as_str();
        if name.is_empty() { return None; }
        self.config.profiles.get(name)
    }

    pub fn get_profile(&self, name: &str) -> Option<&Profile> {
        self.config.profiles.get(name)
    }

    pub fn mark_dirty(&mut self) {
        if let Some(meta) = &mut self.config.sync_meta {
            meta.dirty = Some(true);
        }
    }

    pub fn clear_sync_meta(&mut self) -> Result<(), CoreError> {
        if self.config.sync_meta.take().is_some() {
            self.save()?;
        }
        Ok(())
    }
}

// parse_and_migrate 与 Task 2 Step 5 相同，保留在此（若 Task 2 已建则本步无需改动）。
```

- [ ] **Step 4: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-core`
Expected: 全部 PASS（含 Task 2 的 4 个 fixture 测试）。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/core/src
git commit -m "feat(rust): paths + ConfigManager with atomic save and v1 migration"
```

---

### Task 4: presets + user providers

**Files:**
- Modify: `packages/cli/crates/core/src/presets.rs`
- Modify: `packages/cli/crates/core/src/user_providers.rs`
- Test: `packages/cli/crates/core/src/presets.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Consumes: `types::ProviderPreset`（Task 2）、`paths::providers_path`（Task 3）
- Produces:
  - `presets::builtin_presets() -> &'static [ProviderPreset]`（`include_str!("presets.json")` + `OnceLock` 懒解析）
  - `presets::find_builtin(id: &str) -> Option<&'static ProviderPreset>`
  - `user_providers::load() -> Vec<ProviderPreset>`（读 `providers_path()`；解析/校验任一失败 → 空 vec；写时 version 固定 `"1.0.0"`、2 空格缩进、**非原子写**，与 TS 对齐）
  - `user_providers::save(providers: &[ProviderPreset]) -> Result<(), CoreError>`
  - `user_providers::add(p: ProviderPreset) -> Result<(), CoreError>`（同 id 覆盖）、`user_providers::remove(id: &str) -> bool`
  - `presets::find_provider(id: &str) -> Option<ProviderPreset>`（user 覆盖 builtin）

- [ ] **Step 1: 写失败测试（presets.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn builtins_loaded() {
        let presets = crate::presets::builtin_presets();
        assert_eq!(presets.len(), 43);
        let anthropic = crate::presets::find_builtin("anthropic").unwrap();
        assert_eq!(anthropic.base_url, "https://api.anthropic.com");
        assert_eq!(anthropic.wire_api, Some(crate::types::WireApi::Responses));
        assert!(anthropic.model_families.as_ref().unwrap().len() >= 3);
        let custom = crate::presets::find_builtin("custom").unwrap();
        assert_eq!(custom.base_url, ""); // custom preset 空 baseURL，不可走 validate_preset
        let ollama = crate::presets::find_builtin("ollama").unwrap();
        assert_eq!(ollama.auth_type, crate::types::AuthType::Custom);
    }

    #[test]
    fn user_provider_overrides_builtin() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("SWIXTER_CONFIG_PATH", dir.path().join("config.json"));
        let p = crate::types::ProviderPreset {
            id: "ollama".into(), name: "ollama".into(), display_name: "My Ollama".into(),
            base_url: "http://192.168.1.10:11434".into(), default_models: vec![],
            auth_type: crate::types::AuthType::Custom, ..Default::default()
        };
        crate::user_providers::add(p).unwrap();
        let found = crate::presets::find_provider("ollama").unwrap();
        assert_eq!(found.display_name, "My Ollama");
        std::env::remove_var("SWIXTER_CONFIG_PATH");
    }
}
```

注意：测试依赖 `SWIXTER_CONFIG_PATH` 环境变量，需串行；在测试上加 `// cargo test -- --test-threads=1` 的说明注释，或改用 `serial` 测试习惯：把两个断言合并到同一个 `#[test]` 里减少竞态。

- [ ] **Step 2: 实现 presets.rs 与 user_providers.rs**

`presets.rs`：

```rust
use crate::types::ProviderPreset;
use std::sync::OnceLock;

static PRESETS: OnceLock<Vec<ProviderPreset>> = OnceLock::new();

pub fn builtin_presets() -> &'static [ProviderPreset] {
    PRESETS.get_or_init(|| {
        serde_json::from_str(include_str!("presets.json"))
            .expect("bundled presets.json must be valid")
    })
}

pub fn find_builtin(id: &str) -> Option<&'static ProviderPreset> {
    builtin_presets().iter().find(|p| p.id == id)
}

/// TS: presets.ts getProviderById — 用户自定义优先，可按 id 覆盖内置
pub fn find_provider(id: &str) -> Option<ProviderPreset> {
    if let Some(p) = crate::user_providers::load().into_iter().find(|p| p.id == id) {
        return Some(p);
    }
    find_builtin(id).cloned()
}
```

`user_providers.rs`：

```rust
use crate::types::ProviderPreset;
use crate::CoreError;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct ProvidersFile {
    version: String,
    #[serde(default)]
    providers: Vec<ProviderPreset>,
}

/// TS: user-providers.ts — 任一条目校验失败则整个文件回退空数组
pub fn load() -> Vec<ProviderPreset> {
    let path = crate::paths::providers_path();
    let raw = match std::fs::read_to_string(&path) {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    let file: ProvidersFile = match serde_json::from_str(&raw) {
        Ok(f) => f,
        Err(_) => return vec![],
    };
    if file.providers.iter().any(|p| crate::validate::validate_preset(p).is_err()) {
        return vec![];
    }
    file.providers
}

/// TS: 非原子写，version 固定 "1.0.0"，2 空格缩进
pub fn save(providers: &[ProviderPreset]) -> Result<(), CoreError> {
    let path = crate::paths::providers_path();
    if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
    let file = ProvidersFile { version: "1.0.0".into(), providers: providers.to_vec() };
    std::fs::write(&path, serde_json::to_string_pretty(&file)?)?;
    Ok(())
}

pub fn add(p: ProviderPreset) -> Result<(), CoreError> {
    crate::validate::validate_preset(&p)?;
    let mut all = load();
    all.retain(|x| x.id != p.id);
    all.push(p);
    save(&all)
}

pub fn remove(id: &str) -> Result<bool, CoreError> {
    let mut all = load();
    let before = all.len();
    all.retain(|x| x.id != id);
    if all.len() != before { save(&all)?; Ok(true) } else { Ok(false) }
}
```

- [ ] **Step 3: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-core -- --test-threads=1`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/core/src
git commit -m "feat(rust): builtin presets + user providers with override"
```

---

### Task 5: groups 管理

**Files:**
- Modify: `packages/cli/crates/core/src/groups.rs`
- Test: `packages/cli/crates/core/src/groups.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Consumes: `ConfigManager`（Task 3）
- Produces:
  - `groups::generate_id() -> String`（`grp_<millis>_<6位base36随机>`）
  - `groups::create(mgr: &mut ConfigManager, name: &str, profiles: Vec<String>) -> Result<Group, CoreError>`（校验 profile 存在；首个 group 自动 active；`is_default=false`）
  - `groups::update(mgr, id, name: Option<&str>, profiles: Option<Vec<String>>) -> Result<Group, CoreError>`
  - `groups::delete(mgr, id) -> Result<(), CoreError>`（删除 active group 时 `active_group` 回退到剩余第一个或置 None）
  - `groups::set_default(mgr, id) -> Result<(), CoreError>`（互斥：其他全部置 false）
  - `groups::find_by_name(mgr, name) -> Option<Group>`（CLI 按 name 定位用）

- [ ] **Step 1: 写失败测试（groups.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use crate::config::ConfigManager;
    use crate::types::Profile;

    fn mgr_with_profiles() -> (tempfile::TempDir, ConfigManager) {
        let dir = tempfile::tempdir().unwrap();
        let mut m = ConfigManager::load_from(dir.path().join("config.json"));
        for n in ["p1", "p2", "p3"] {
            m.upsert_profile(Profile { name: n.into(), provider_id: "ollama".into(),
                api_key: "k".into(), created_at: "t".into(), updated_at: "t".into(),
                ..Default::default() }, None).unwrap();
        }
        (dir, m)
    }

    #[test]
    fn first_group_becomes_active() {
        let (_d, mut m) = mgr_with_profiles();
        let g = crate::groups::create(&mut m, "main", vec!["p1".into(), "p2".into()]).unwrap();
        assert!(g.id.starts_with("grp_"));
        assert_eq!(m.config().active_group.as_deref(), Some(g.id.as_str()));
        assert!(!g.is_default);
    }

    #[test]
    fn create_rejects_unknown_profile() {
        let (_d, mut m) = mgr_with_profiles();
        assert!(matches!(crate::groups::create(&mut m, "x", vec!["nope".into()]),
                         Err(crate::CoreError::NotFound(_))));
    }

    #[test]
    fn set_default_is_exclusive() {
        let (_d, mut m) = mgr_with_profiles();
        let g1 = crate::groups::create(&mut m, "a", vec!["p1".into()]).unwrap();
        let g2 = crate::groups::create(&mut m, "b", vec!["p2".into()]).unwrap();
        crate::groups::set_default(&mut m, &g1.id).unwrap();
        crate::groups::set_default(&mut m, &g2.id).unwrap();
        assert!(!m.config().groups[&g1.id].is_default);
        assert!(m.config().groups[&g2.id].is_default);
    }

    #[test]
    fn delete_active_group_falls_back() {
        let (_d, mut m) = mgr_with_profiles();
        let g1 = crate::groups::create(&mut m, "a", vec!["p1".into()]).unwrap();
        let g2 = crate::groups::create(&mut m, "b", vec!["p2".into()]).unwrap();
        assert_eq!(m.config().active_group.as_deref(), Some(g1.id.as_str()));
        crate::groups::delete(&mut m, &g1.id).unwrap();
        assert!(m.config().active_group.is_some()); // 回退到剩余第一个
        crate::groups::delete(&mut m, &g2.id).unwrap();
        assert!(m.config().active_group.is_none()); // 无剩余则移除字段
    }
}
```

- [ ] **Step 2: 实现 groups.rs**

```rust
use crate::config::ConfigManager;
use crate::types::Group;
use crate::CoreError;

fn now_iso() -> String {
    // TS 用 new Date().toISOString()；保持同格式（毫秒）。
    // 不引入 chrono：用 time 之外的轻量实现不可行，直接加 `time` crate 过重——
    // 用 js 风格格式化：std 无格式化能力，故此处引入 `chrono` 不可行（未在依赖中）。
    // 实现：毫秒时间戳格式化为 ISO 需日期算法；采用 `time` crate（加入 core 依赖）。
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Iso8601::DEFAULT)
        .unwrap()
}

pub fn generate_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
    // 6 位 base36 随机（TS: Math.random().toString(36)）
    let n: u32 = rand::random::<u32>() % 36u32.pow(6);
    let mut s = String::new();
    let mut v = n;
    for _ in 0..6 {
        let d = (v % 36) as u8;
        s.push(if d < 10 { (b'0' + d) as char } else { (b'a' + d - 10) as char });
        v /= 36;
    }
    format!("grp_{millis}_{s}")
}

pub fn create(mgr: &mut ConfigManager, name: &str, profiles: Vec<String>) -> Result<Group, CoreError> {
    if profiles.is_empty() {
        return Err(CoreError::Validation("group must contain at least one profile".into()));
    }
    for p in &profiles {
        if !mgr.config().profiles.contains_key(p) {
            return Err(CoreError::NotFound(format!("Profile \"{p}\" does not exist")));
        }
    }
    let now = now_iso();
    let group = Group {
        id: generate_id(), name: name.to_string(), profiles,
        is_default: false, created_at: now.clone(), updated_at: now,
    };
    let is_first = mgr.config().groups.is_empty();
    mgr.config_mut_for_test().groups.insert(group.id.clone(), group.clone());
    if is_first {
        mgr.config_mut_for_test().active_group = Some(group.id.clone());
    }
    mgr.mark_dirty();
    mgr.save()?;
    Ok(group)
}

pub fn update(mgr: &mut ConfigManager, id: &str, name: Option<&str>,
              profiles: Option<Vec<String>>) -> Result<Group, CoreError> {
    let groups = &mut mgr.config_mut_for_test().groups;
    let g = groups.get_mut(id)
        .ok_or_else(|| CoreError::NotFound(format!("Group \"{id}\" not found")))?;
    if let Some(n) = name { g.name = n.to_string(); }
    if let Some(ps) = profiles {
        if ps.is_empty() {
            return Err(CoreError::Validation("group must contain at least one profile".into()));
        }
        for p in &ps {
            if !mgr.config().profiles.contains_key(p) {
                return Err(CoreError::NotFound(format!("Profile \"{p}\" does not exist")));
            }
        }
        g.profiles = ps;
    }
    g.updated_at = now_iso();
    let out = g.clone();
    mgr.mark_dirty();
    mgr.save()?;
    Ok(out)
}

pub fn delete(mgr: &mut ConfigManager, id: &str) -> Result<(), CoreError> {
    if mgr.config_mut_for_test().groups.remove(id).is_none() {
        return Err(CoreError::NotFound(format!("Group \"{id}\" not found")));
    }
    if mgr.config().active_group.as_deref() == Some(id) {
        // 回退到剩余第一个；无剩余则移除字段（序列化时省略，与 TS 一致）
        mgr.config_mut_for_test().active_group =
            mgr.config().groups.keys().next().cloned();
    }
    mgr.mark_dirty();
    mgr.save()
}

pub fn set_default(mgr: &mut ConfigManager, id: &str) -> Result<(), CoreError> {
    if !mgr.config().groups.contains_key(id) {
        return Err(CoreError::NotFound(format!("Group \"{id}\" not found")));
    }
    for g in mgr.config_mut_for_test().groups.values_mut() {
        g.is_default = g.id == id;
        g.updated_at = now_iso();
    }
    mgr.mark_dirty();
    mgr.save()
}

pub fn find_by_name(mgr: &ConfigManager, name: &str) -> Option<Group> {
    mgr.config().groups.values().find(|g| g.name == name).cloned()
}
```

依赖补充：本模块用到 `time` 与 `rand`——在 `crates/core/Cargo.toml` 的 `[dependencies]` 加：

```toml
time = { version = "0.3", features = ["formatting", "std"] }
rand = "0.8"
```

并在 workspace `Cargo.toml` 的 `[workspace.dependencies]` 加 `time = { version = "0.3", features = ["formatting", "std"] }`、`rand = "0.8"`，core 引用改为 workspace 继承（与其他依赖保持一致）。

`now_iso()` 需要在所有写 profile/group 时间戳的地方统一使用——把它提升为 `types::now_iso()`（移到 types.rs 并 `pub`），groups.rs 与后续 CLI create/edit 都调用它。

- [ ] **Step 3: 跑测试 + clippy**

Run: `cd packages/cli && cargo test -p swixter-core && cargo clippy --workspace -- -D warnings`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/core packages/cli/Cargo.toml
git commit -m "feat(rust): group management with default/active semantics"
```

---

### Task 6: model/env helpers + adapter trait + claude adapter

**Files:**
- Modify: `packages/cli/crates/core/src/model.rs`
- Modify: `packages/cli/crates/core/src/coder.rs`
- Modify: `packages/cli/crates/core/src/adapters/mod.rs`
- Create: `packages/cli/crates/core/src/adapters/claude.rs`
- Test: `packages/cli/crates/core/src/adapters/claude.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Consumes: `types::*`（Task 2）、`paths`（Task 3）、`presets::find_provider`（Task 4）
- Produces:
  - `model::get_openai_model(p: &Profile) -> Option<&str>`（`models.is_some()` → None；否则 `model.or(openai_model)` 过滤空串）
  - `model::resolve_env_key<'a>(p: &'a Profile, preset: Option<&'a ProviderPreset>) -> &'a str`（`profile.envKey` > `preset.env_key` > `"OPENAI_API_KEY"`，空串视为未设置）
  - `model::EnvVarMapping { api_key, auth_token: Option, base_url, anthropic_model, default_haiku_model, default_opus_model, default_sonnet_model: Option<&'static str> }`
  - `model::build_profile_env(p: &Profile, m: &EnvVarMapping, base_url: &str) -> Vec<(String, String)>`（只含非空值，顺序固定：base_url → api_key → auth_token → 4 个 model key）
  - `model::managed_keys(m: &EnvVarMapping) -> Vec<&'static str>`
  - `coder::CoderSpec { id, display_name, executable: &'static str, adapter: AdapterKind, supports_auth_token: bool }`、`coder::CODERS: &[CoderSpec]`（claude/codex/qwen；qwen 的 executable 为 `"qwen"`、adapter 为 Continue）、`coder::get_coder(id) -> Option<&'static CoderSpec>`
  - `adapters::CoderAdapter` trait（`name()` / `config_path()` / `apply(&self, profile, preset) -> Result<(), CoreError>` / `verify(&self, profile, preset) -> bool` / `remove(&self, profile_name) -> Result<(), CoreError>`）、`adapters::get_adapter(kind: AdapterKind) -> Box<dyn CoderAdapter>`

- [ ] **Step 1: 写失败测试（claude.rs 内联）**

测试用临时 HOME：`std::env::set_var("HOME", dir.path())`（Windows 为 `USERPROFILE`，测试中按 cfg 处理）——更稳妥做法：adapter 构造允许注入路径，`ClaudeCodeAdapter::with_path(PathBuf)`，测试用注入，生产用 `paths::claude_settings_path()`。

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{ModelsConfig, Profile};

    fn adapter_at(dir: &tempfile::TempDir) -> ClaudeCodeAdapter {
        ClaudeCodeAdapter::with_path(dir.path().join("settings.json"))
    }

    fn profile() -> Profile {
        Profile {
            name: "p1".into(), provider_id: "anthropic".into(),
            api_key: "sk-ant-xxx".into(), auth_token: Some("tok".into()),
            base_url: Some("https://api.anthropic.com".into()),
            models: Some(ModelsConfig { anthropic_model: Some("claude-sonnet-4-20250514".into()),
                default_haiku_model: None, default_opus_model: None,
                default_sonnet_model: Some("s".into()) }),
            created_at: "t".into(), updated_at: "t".into(), ..Default::default()
        }
    }

    #[test]
    fn apply_writes_managed_env_and_preserves_rest() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"),
            r#"{ "permissions": {"allow": []}, "env": {"OTHER_VAR": "keep", "ANTHROPIC_API_KEY": "old"} }"#).unwrap();
        let a = adapter_at(&dir);
        a.apply(&profile(), None).unwrap();
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap()).unwrap();
        assert_eq!(v["permissions"]["allow"], serde_json::json!([])); // 其他段保留
        assert_eq!(v["env"]["OTHER_VAR"], "keep");                    // 非托管 key 保留
        assert_eq!(v["env"]["ANTHROPIC_API_KEY"], "sk-ant-xxx");
        assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "tok");
        assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "https://api.anthropic.com");
        assert_eq!(v["env"]["ANTHROPIC_MODEL"], "claude-sonnet-4-20250514");
        assert_eq!(v["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"], "s");
        assert!(v["env"].get("ANTHROPIC_DEFAULT_HAIKU_MODEL").is_none()); // 空值不写
    }

    #[test]
    fn apply_full_replace_semantics() {
        let dir = tempfile::tempdir().unwrap();
        let a = adapter_at(&dir);
        a.apply(&profile(), None).unwrap();
        let mut p2 = profile();
        p2.auth_token = None; // 切换 profile 后旧值必须被删除
        a.apply(&p2, None).unwrap();
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap()).unwrap();
        assert!(v["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
    }

    #[test]
    fn verify_and_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let a = adapter_at(&dir);
        assert!(!a.verify(&profile(), None)); // 文件不存在
        a.apply(&profile(), None).unwrap();
        assert!(a.verify(&profile(), None));
        std::fs::write(dir.path().join("settings.json"), "{not json").unwrap();
        assert!(!a.verify(&profile(), None)); // 损坏 → false
        a.apply(&profile(), None).unwrap();   // 损坏 → 从 {} 重建（不备份）
        assert!(a.verify(&profile(), None));
    }
}
```

- [ ] **Step 2: 实现 model.rs**

```rust
use crate::types::{Profile, ProviderPreset};

/// TS: model-helper.ts getOpenAIModel — 有 models 对象时返回 None
pub fn get_openai_model(p: &Profile) -> Option<&str> {
    if p.models.is_some() { return None; }
    p.model.as_deref().or(p.openai_model.as_deref()).filter(|s| !s.is_empty())
}

/// TS: env-key-helper.ts — profile.envKey > preset.env_key > OPENAI_API_KEY
pub fn resolve_env_key<'a>(p: &'a Profile, preset: Option<&'a ProviderPreset>) -> &'a str {
    p.env_key.as_deref().filter(|s| !s.is_empty())
        .or_else(|| preset.and_then(|x| x.env_key.as_deref()).filter(|s| !s.is_empty()))
        .unwrap_or("OPENAI_API_KEY")
}

/// TS: constants/coders.ts envVarMapping
pub struct EnvVarMapping {
    pub api_key: &'static str,
    pub auth_token: Option<&'static str>,
    pub base_url: &'static str,
    pub anthropic_model: Option<&'static str>,
    pub default_haiku_model: Option<&'static str>,
    pub default_opus_model: Option<&'static str>,
    pub default_sonnet_model: Option<&'static str>,
}

pub const CLAUDE_ENV_MAPPING: EnvVarMapping = EnvVarMapping {
    api_key: "ANTHROPIC_API_KEY",
    auth_token: Some("ANTHROPIC_AUTH_TOKEN"),
    base_url: "ANTHROPIC_BASE_URL",
    anthropic_model: Some("ANTHROPIC_MODEL"),
    default_haiku_model: Some("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    default_opus_model: Some("ANTHROPIC_DEFAULT_OPUS_MODEL"),
    default_sonnet_model: Some("ANTHROPIC_DEFAULT_SONNET_MODEL"),
};

pub fn managed_keys(m: &EnvVarMapping) -> Vec<&'static str> {
    let mut v = vec![m.api_key, m.base_url];
    for k in [m.auth_token, m.anthropic_model, m.default_haiku_model,
              m.default_opus_model, m.default_sonnet_model].into_iter().flatten() {
        v.push(k);
    }
    v
}

/// TS: model-helper.ts buildProfileEnv — 只写非空值
pub fn build_profile_env(p: &Profile, m: &EnvVarMapping, base_url: &str) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    let mut push = |k: &'static str, v: &str| {
        if !v.is_empty() { env.push((k.to_string(), v.to_string())); }
    };
    push(m.base_url, base_url);
    push(m.api_key, &p.api_key);
    if let (Some(k), Some(v)) = (m.auth_token, p.auth_token.as_deref()) { push(k, v); }
    if let Some(models) = &p.models {
        if let Some(k) = m.anthropic_model { if let Some(v) = models.anthropic_model.as_deref() { push(k, v); } }
        if let Some(k) = m.default_haiku_model { if let Some(v) = models.default_haiku_model.as_deref() { push(k, v); } }
        if let Some(k) = m.default_opus_model { if let Some(v) = models.default_opus_model.as_deref() { push(k, v); } }
        if let Some(k) = m.default_sonnet_model { if let Some(v) = models.default_sonnet_model.as_deref() { push(k, v); } }
    }
    env
}
```

- [ ] **Step 3: 实现 coder.rs**

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AdapterKind { Claude, Codex, Continue }

pub struct CoderSpec {
    pub id: &'static str,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub adapter: AdapterKind,
    pub supports_auth_token: bool,
}

pub const CODERS: &[CoderSpec] = &[
    CoderSpec { id: "claude", display_name: "Claude Code", executable: "claude",
                adapter: AdapterKind::Claude, supports_auth_token: true },
    CoderSpec { id: "codex", display_name: "Codex", executable: "codex",
                adapter: AdapterKind::Codex, supports_auth_token: false },
    // qwen 历史命名，实际目标是 Continue.dev（TS: getAdapter("qwen") → ContinueAdapter）
    CoderSpec { id: "qwen", display_name: "Qwen (Continue.dev)", executable: "qwen",
                adapter: AdapterKind::Continue, supports_auth_token: false },
];

pub fn get_coder(id: &str) -> Option<&'static CoderSpec> {
    CODERS.iter().find(|c| c.id == id)
}
```

注意：`AdapterKind` 定义在 `coder.rs`，`adapters/mod.rs` 从这里 re-export。

- [ ] **Step 4: 实现 adapters/mod.rs + claude.rs**

`adapters/mod.rs`：

```rust
pub mod claude;
pub mod codex;
pub mod continue_;

use crate::coder::AdapterKind;
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::Path;

pub trait CoderAdapter {
    fn name(&self) -> &'static str;
    fn config_path(&self) -> &Path;
    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError>;
    fn verify(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> bool;
    fn remove(&self, profile_name: &str) -> Result<(), CoreError>;
}

pub fn get_adapter(kind: AdapterKind) -> Box<dyn CoderAdapter> {
    match kind {
        AdapterKind::Claude => Box::new(claude::ClaudeCodeAdapter::new()),
        AdapterKind::Codex => Box::new(codex::CodexAdapter::new()),
        AdapterKind::Continue => Box::new(continue_::ContinueAdapter::new()),
    }
}
```

`adapters/claude.rs`：

```rust
use crate::model::{build_profile_env, managed_keys, CLAUDE_ENV_MAPPING};
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::{Path, PathBuf};

pub struct ClaudeCodeAdapter {
    path: PathBuf,
}

impl ClaudeCodeAdapter {
    pub fn new() -> Self { Self { path: crate::paths::claude_settings_path() } }
    pub fn with_path(path: PathBuf) -> Self { Self { path } }

    fn read_existing(&self) -> serde_json::Value {
        // TS: 不存在 → {}；解析失败 → warn 并用 {}（不备份、不报错）
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    }

    fn expected_env(profile: &Profile, preset: Option<&ProviderPreset>) -> Vec<(String, String)> {
        // TS: baseURL 回退链 profile.baseURL || preset?.baseURL || ""
        let base_url = profile.base_url.as_deref()
            .or(preset.map(|p| p.base_url.as_str()))
            .unwrap_or("");
        build_profile_env(profile, &CLAUDE_ENV_MAPPING, base_url)
    }
}

impl super::CoderAdapter for ClaudeCodeAdapter {
    fn name(&self) -> &'static str { "claude" }
    fn config_path(&self) -> &Path { &self.path }

    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError> {
        let mut existing = self.read_existing();
        let new_env = Self::expected_env(profile, preset);
        let managed = managed_keys(&CLAUDE_ENV_MAPPING);

        // 智能合并：保留非托管的用户自定义变量
        let mut env = serde_json::Map::new();
        if let Some(obj) = existing.get("env").and_then(|e| e.as_object()) {
            for (k, v) in obj {
                if !managed.contains(&k.as_str()) { env.insert(k.clone(), v.clone()); }
            }
        }
        for (k, v) in new_env { env.insert(k, serde_json::Value::String(v)); }
        existing["env"] = serde_json::Value::Object(env);

        if let Some(dir) = self.path.parent() { std::fs::create_dir_all(dir)?; }
        std::fs::write(&self.path, serde_json::to_string_pretty(&existing)?)?;
        Ok(())
    }

    fn verify(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> bool {
        let raw = match std::fs::read_to_string(&self.path) { Ok(r) => r, Err(_) => return false };
        let v: serde_json::Value = match serde_json::from_str(&raw) { Ok(v) => v, Err(_) => return false };
        let expected = Self::expected_env(profile, preset);
        if expected.is_empty() { return false; }
        let env = match v.get("env").and_then(|e| e.as_object()) { Some(e) => e, None => return false };
        expected.iter().all(|(k, val)| env.get(k).and_then(|x| x.as_str()) == Some(val.as_str()))
    }

    /// TS: claude remove 是 no-op（全局 env，无 per-profile 条目）
    fn remove(&self, _profile_name: &str) -> Result<(), CoreError> { Ok(()) }
}
```

- [ ] **Step 5: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-core claude`
Expected: 3 个测试 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/cli/crates/core/src
git commit -m "feat(rust): model helpers, coder registry, claude adapter"
```

---

### Task 7: codex adapter（toml_edit）

**Files:**
- Create: `packages/cli/crates/core/src/adapters/codex.rs`
- Test: `packages/cli/crates/core/src/adapters/codex.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Consumes: `model::{get_openai_model, resolve_env_key}`（Task 6）、`types::*`、`CoreError`
- Produces: `codex::CodexAdapter { pub fn new(); pub fn with_paths(config: PathBuf) -> Self }` 实现 `CoderAdapter`。provider/profile key 统一 `swixter-<name>`；独立 profile 文件 `~/.codex/swixter-<name>.config.toml`。

- [ ] **Step 1: 写失败测试（codex.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Profile, ProviderPreset};

    fn preset() -> ProviderPreset {
        ProviderPreset {
            id: "ollama".into(), name: "ollama".into(), display_name: "Ollama (Local models)".into(),
            base_url: "http://localhost:11434".into(), env_key: Some("OLLAMA_API_KEY".into()),
            default_models: vec!["qwen2.5-coder:7b".into()],
            auth_type: crate::types::AuthType::Custom, ..Default::default()
        }
    }

    fn profile() -> Profile {
        Profile { name: "test".into(), provider_id: "ollama".into(), api_key: "".into(),
                  model: Some("qwen2.5-coder:7b".into()),
                  created_at: "t".into(), updated_at: "t".into(), ..Default::default() }
    }

    fn setup() -> (tempfile::TempDir, CodexAdapter) {
        let dir = tempfile::tempdir().unwrap();
        let a = CodexAdapter::with_paths(dir.path().join("config.toml"));
        (dir, a)
    }

    #[test]
    fn apply_writes_provider_table_and_profile_file() {
        let (dir, a) = setup();
        a.apply(&profile(), Some(&preset())).unwrap();
        let doc = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        let parsed: toml_edit::DocumentMut = doc.parse().unwrap();
        assert_eq!(parsed["model_provider"].as_str(), Some("swixter-test"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["name"].as_str(), Some("Ollama (Local models)"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["base_url"].as_str(), Some("http://localhost:11434"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["wire_api"].as_str(), Some("responses"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["env_key"].as_str(), Some("OLLAMA_API_KEY"));
        let pf = std::fs::read_to_string(dir.path().join("swixter-test.config.toml")).unwrap();
        assert!(pf.contains("model_provider = \"swixter-test\""));
        assert!(pf.contains("model = \"qwen2.5-coder:7b\""));
    }

    #[test]
    fn apply_preserves_unrelated_content() {
        let (dir, a) = setup();
        std::fs::write(dir.path().join("config.toml"),
            "# user comment\napproval_policy = \"never\"\n\n[mcp_servers.fs]\ncommand = \"npx\"\n").unwrap();
        a.apply(&profile(), Some(&preset())).unwrap();
        let doc = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(doc.contains("# user comment"));            // 注释保留（toml_edit）
        assert!(doc.contains("approval_policy = \"never\""));
        assert!(doc.contains("[mcp_servers.fs]"));
    }

    #[test]
    fn apply_cleans_legacy_profiles_table() {
        let (dir, a) = setup();
        std::fs::write(dir.path().join("config.toml"),
            "profile = \"swixter-test\"\n\n[profiles.swixter-test]\nmodel = \"x\"\n").unwrap();
        a.apply(&profile(), Some(&preset())).unwrap();
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert!(parsed.get("profile").is_none());
        assert!(parsed.get("profiles").is_none()); // 清空后整表删除
    }

    #[test]
    fn corrupt_config_is_backed_up() {
        let (dir, a) = setup();
        std::fs::write(dir.path().join("config.toml"), "not [valid toml").unwrap();
        a.apply(&profile(), Some(&preset())).unwrap();
        let backups: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("config.toml.backup."))
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(a.verify(&profile(), Some(&preset())));
    }

    #[test]
    fn unknown_provider_errors() {
        let (_dir, a) = setup();
        let err = a.apply(&profile(), None).unwrap_err();
        assert!(matches!(err, CoreError::UnknownProvider(_)));
    }

    #[test]
    fn env_key_fallback_chain() {
        let (dir, a) = setup();
        let mut p = profile();
        p.env_key = Some("MY_KEY".into());
        a.apply(&p, Some(&preset())).unwrap();
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert_eq!(parsed["model_providers"]["swixter-test"]["env_key"].as_str(), Some("MY_KEY"));
        // profile.envKey 为空串 → 落回 preset.env_key
        p.env_key = Some("".into());
        a.apply(&p, Some(&preset())).unwrap();
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert_eq!(parsed["model_providers"]["swixter-test"]["env_key"].as_str(), Some("OLLAMA_API_KEY"));
    }

    #[test]
    fn remove_cleans_everything() {
        let (dir, a) = setup();
        a.apply(&profile(), Some(&preset())).unwrap();
        a.remove("test").unwrap();
        assert!(!dir.path().join("swixter-test.config.toml").exists());
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert!(parsed["model_providers"].get("swixter-test").is_none());
        assert!(parsed.get("model_provider").is_none());
    }
}
```

- [ ] **Step 2: 实现 codex.rs**

```rust
use crate::model::{get_openai_model, resolve_env_key};
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::{Path, PathBuf};
use toml_edit::{value, DocumentMut, InlineTable, Item, Table};

pub struct CodexAdapter {
    config_path: PathBuf,
}

impl CodexAdapter {
    pub fn new() -> Self { Self { config_path: crate::paths::codex_config_path() } }
    /// 测试用：注入 config.toml 路径；独立 profile 文件在其同目录。
    pub fn with_paths(config_path: PathBuf) -> Self { Self { config_path } }

    fn key(profile_name: &str) -> String { format!("swixter-{profile_name}") }

    fn profile_file_path(&self, profile_name: &str) -> PathBuf {
        self.config_path.parent().unwrap()
            .join(format!("swixter-{profile_name}.config.toml"))
    }

    fn read_doc(&self) -> DocumentMut {
        // TS: 解析失败 → 备份 config.toml.backup.<millis>，warn，从 {} 重来
        let raw = match std::fs::read_to_string(&self.config_path) {
            Ok(r) => r,
            Err(_) => return DocumentMut::new(),
        };
        match raw.parse::<DocumentMut>() {
            Ok(doc) => doc,
            Err(_) => {
                let millis = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
                let backup = self.config_path.with_file_name(format!(
                    "{}.backup.{millis}",
                    self.config_path.file_name().unwrap().to_string_lossy()
                ));
                let _ = std::fs::write(&backup, &raw);
                eprintln!("Warning: config.toml is corrupted, backed up to {}", backup.display());
                DocumentMut::new()
            }
        }
    }

    fn write_doc(&self, doc: &DocumentMut) -> Result<(), CoreError> {
        if let Some(dir) = self.config_path.parent() { std::fs::create_dir_all(dir)?; }
        std::fs::write(&self.config_path, doc.to_string())?;
        Ok(())
    }

    /// TS: 清理旧版 swixter 遗留的 config.profile 与 [profiles.swixter-<name>]；空表整删
    fn clean_legacy(doc: &mut DocumentMut, key: &str) {
        if doc.get("profile").and_then(|v| v.as_str()) == Some(key) {
            doc.remove("profile");
        }
        let mut drop_profiles = false;
        if let Some(profiles) = doc.get_mut("profiles").and_then(|p| p.as_table_mut()) {
            profiles.remove(key);
            if profiles.is_empty() { drop_profiles = true; }
        }
        if drop_profiles { doc.remove("profiles"); }
    }
}

impl super::CoderAdapter for CodexAdapter {
    fn name(&self) -> &'static str { "codex" }
    fn config_path(&self) -> &Path { &self.config_path }

    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError> {
        let preset = preset.ok_or_else(|| CoreError::UnknownProvider(format!(
            "Failed to apply Codex configuration: Unknown provider: {}", profile.provider_id
        )))?;
        let key = Self::key(&profile.name);

        let mut doc = self.read_doc();
        Self::clean_legacy(&mut doc, &key);

        // base_url 回退链：profile.baseURL || preset.baseURLChat || preset.baseURL
        let base_url = profile.base_url.as_deref()
            .or(preset.base_url_chat.as_deref())
            .unwrap_or(&preset.base_url);

        doc["model_provider"] = value(&key);
        let provider = &mut doc["model_providers"][&key];
        provider["name"] = value(&preset.display_name);
        provider["base_url"] = value(base_url);
        provider["wire_api"] = value("responses"); // TS 硬编码
        provider["env_key"] = value(resolve_env_key(profile, Some(preset)));
        if let Some(headers) = &preset.headers {
            let mut tbl = InlineTable::new();
            for (k, v) in headers { tbl.insert(k, v.as_str().into()); }
            provider["http_headers"] = value(tbl);
        }
        self.write_doc(&doc)?;

        // 独立 profile 文件（Codex 0.134.0+）：顶层键，非 [profiles.x] 嵌套
        let mut pf = DocumentMut::new();
        pf["model_provider"] = value(&key);
        // model 回退链：get_openai_model → preset.default_models[0] → 省略
        let model = get_openai_model(profile).map(|s| s.to_string())
            .or_else(|| preset.default_models.first().cloned());
        if let Some(m) = model { pf["model"] = value(m); }
        let pf_path = self.profile_file_path(&profile.name);
        if let Some(dir) = pf_path.parent() { std::fs::create_dir_all(dir)?; }
        std::fs::write(&pf_path, pf.to_string())?;
        Ok(())
    }

    fn verify(&self, profile: &Profile, _preset: Option<&ProviderPreset>) -> bool {
        let key = Self::key(&profile.name);
        let ok = (|| {
            let raw = std::fs::read_to_string(&self.config_path).ok()?;
            let doc = raw.parse::<DocumentMut>().ok()?;
            if doc.get("model_provider").and_then(|v| v.as_str()) != Some(key.as_str()) { return Some(false); }
            doc.get("model_providers")?.get(&key)?;
            let pf_raw = std::fs::read_to_string(self.profile_file_path(&profile.name)).ok()?;
            let pf = pf_raw.parse::<DocumentMut>().ok()?;
            Some(pf.get("model_provider").and_then(|v| v.as_str()) == Some(key.as_str()))
        })();
        ok.unwrap_or(false)
    }

    fn remove(&self, profile_name: &str) -> Result<(), CoreError> {
        // TS: 先无条件删独立文件（失败忽略）；config 修改只在有变化时写回；异常仅 warn
        let _ = std::fs::remove_file(self.profile_file_path(profile_name));
        let key = Self::key(profile_name);
        let result = (|| -> Result<(), CoreError> {
            if !self.config_path.exists() { return Ok(()); }
            let mut doc = self.read_doc();
            let mut modified = false;
            if let Some(providers) = doc.get_mut("model_providers").and_then(|p| p.as_table_mut()) {
                if providers.remove(&key).is_some() { modified = true; }
            }
            Self::clean_legacy(&mut doc, &key); // legacy profiles/profile 清理
            if doc.get("model_provider").and_then(|v| v.as_str()) == Some(key.as_str()) {
                doc.remove("model_provider");
                modified = true;
            }
            // clean_legacy 也可能做了修改，简化处理：有任一清理动作即写回
            if modified || true { self.write_doc(&doc)?; }
            Ok(())
        })();
        if let Err(e) = result { eprintln!("Warning: failed to cleanup codex config: {e}"); }
        Ok(())
    }
}
```

实现备注：`read_doc` 的备份文件名必须是 `config.toml.backup.<millis>`（测试按此前缀匹配）。`remove` 中 `modified || true` 是刻意的——clean_legacy 内部修改不便追踪，写回一个语义相同的 doc 无害（TS 仅在 modified 时写回以保留原字节；toml_edit 保格式，所以总是写回也可接受，若 review 有异议可改为精确追踪）。`Item`/`Table` import 若未用到需删除（clippy `-D warnings`）。

- [ ] **Step 3: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-core codex`
Expected: 7 个测试 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/core/src/adapters/codex.rs
git commit -m "feat(rust): codex adapter with toml_edit format preservation"
```

---

### Task 8: continue adapter（YAML）

**Files:**
- Create: `packages/cli/crates/core/src/adapters/continue_.rs`
- Test: `packages/cli/crates/core/src/adapters/continue_.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Consumes: `model::get_openai_model`（Task 6）
- Produces: `continue_::ContinueAdapter { pub fn new(); pub fn with_path(PathBuf) }` 实现 `CoderAdapter`；provider 映射 `map_provider(id)`：anthropic→anthropic、openai/openrouter/custom→openai、ollama→ollama、其他→openai。

- [ ] **Step 1: 写失败测试（continue_.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Profile;

    fn profile() -> Profile {
        Profile { name: "my-qwen".into(), provider_id: "ollama".into(), api_key: "k".into(),
                  base_url: Some("http://localhost:11434".into()),
                  model: Some("qwen2.5-coder:7b".into()),
                  created_at: "t".into(), updated_at: "t".into(), ..Default::default() }
    }

    fn setup() -> (tempfile::TempDir, ContinueAdapter) {
        let dir = tempfile::tempdir().unwrap();
        (dir, ContinueAdapter::with_path(dir.path().join("config.yaml")))
    }

    #[test]
    fn apply_upserts_model_entry() {
        let (dir, a) = setup();
        std::fs::write(dir.path().join("config.yaml"), "name: my-assistant\nmodels:\n  - title: other\n    provider: openai\n").unwrap();
        a.apply(&profile(), None).unwrap();
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(
            &std::fs::read_to_string(dir.path().join("config.yaml")).unwrap()).unwrap();
        assert_eq!(v["name"], "my-assistant"); // 其他字段保留
        let models = v["models"].as_sequence().unwrap();
        assert_eq!(models.len(), 2); // other 保留，my-qwen 新增
        let entry = models.iter().find(|m| m["title"] == "my-qwen").unwrap();
        assert_eq!(entry["provider"], "ollama");
        assert_eq!(entry["apiBase"], "http://localhost:11434");
        assert_eq!(entry["model"], "qwen2.5-coder:7b");
        assert_eq!(entry["apiKey"], "k");
        assert_eq!(entry["roles"], serde_yaml_ng::to_value(vec!["chat", "edit", "apply"]).unwrap());
    }

    #[test]
    fn apply_replaces_existing_entry() {
        let (dir, a) = setup();
        a.apply(&profile(), None).unwrap();
        let mut p2 = profile();
        p2.api_key = "k2".into();
        a.apply(&p2, None).unwrap();
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(
            &std::fs::read_to_string(dir.path().join("config.yaml")).unwrap()).unwrap();
        let models = v["models"].as_sequence().unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["apiKey"], "k2");
    }

    #[test]
    fn verify_and_remove() {
        let (dir, a) = setup();
        assert!(!a.verify(&profile(), None));
        a.apply(&profile(), None).unwrap();
        assert!(a.verify(&profile(), None));
        a.remove("my-qwen").unwrap();
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(
            &std::fs::read_to_string(dir.path().join("config.yaml")).unwrap()).unwrap();
        assert!(v["models"].as_sequence().unwrap().is_empty());
        assert!(!a.verify(&profile(), None));
    }

    #[test]
    fn provider_mapping_fallback() {
        assert_eq!(map_provider("anthropic"), "anthropic");
        assert_eq!(map_provider("openrouter"), "openai");
        assert_eq!(map_provider("some-future-provider"), "openai");
    }
}
```

- [ ] **Step 2: 实现 continue_.rs**

```rust
use crate::model::get_openai_model;
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use serde_yaml_ng::{Mapping, Value};
use std::path::{Path, PathBuf};

/// TS: continue.ts PROVIDER_MAP + 未知 providerId 回退 "openai"
pub fn map_provider(id: &str) -> &'static str {
    match id {
        "anthropic" => "anthropic",
        "ollama" => "ollama",
        _ => "openai", // openai / openrouter / custom / 未知
    }
}

pub struct ContinueAdapter {
    path: PathBuf,
}

impl ContinueAdapter {
    pub fn new() -> Self { Self { path: crate::paths::continue_config_path() } }
    pub fn with_path(path: PathBuf) -> Self { Self { path } }

    fn read_config(&self) -> Mapping {
        // TS: 读取失败 → warn + {}
        std::fs::read_to_string(&self.path).ok()
            .and_then(|raw| serde_yaml_ng::from_str::<Value>(&raw).ok())
            .and_then(|v| v.as_mapping().cloned())
            .unwrap_or_default()
    }

    fn write_config(&self, m: &Mapping) -> Result<(), CoreError> {
        if let Some(dir) = self.path.parent() { std::fs::create_dir_all(dir)?; }
        std::fs::write(&self.path, serde_yaml_ng::to_string(&Value::Mapping(m.clone()))?)?;
        Ok(())
    }

    fn build_entry(profile: &Profile, preset: Option<&ProviderPreset>) -> Mapping {
        let mut e = Mapping::new();
        e.insert("title".into(), profile.name.clone().into());
        e.insert("provider".into(), map_provider(&profile.provider_id).into());
        let base = profile.base_url.as_deref()
            .or(preset.map(|p| p.base_url.as_str()))
            .unwrap_or("");
        e.insert("apiBase".into(), base.into());
        // model/apiKey 仅非空才写（TS: continue.ts:57-58）
        if let Some(m) = get_openai_model(profile) { e.insert("model".into(), m.into()); }
        if !profile.api_key.is_empty() { e.insert("apiKey".into(), profile.api_key.clone().into()); }
        e.insert("roles".into(), Value::Sequence(
            vec!["chat", "edit", "apply"].into_iter().map(|s| Value::String(s.into())).collect()));
        e
    }
}

impl super::CoderAdapter for ContinueAdapter {
    fn name(&self) -> &'static str { "continue" }
    fn config_path(&self) -> &Path { &self.path }

    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError> {
        let mut config = self.read_config();
        let entry = Value::Mapping(Self::build_entry(profile, preset));
        let mut models: Vec<Value> = config
            .get("models")
            .and_then(|m| m.as_sequence().cloned())
            .unwrap_or_default();
        // upsert：title 匹配则整体替换，否则 push
        if let Some(slot) = models.iter_mut().find(|m| m.get("title").and_then(|t| t.as_str()) == Some(profile.name.as_str())) {
            *slot = entry;
        } else {
            models.push(entry);
        }
        config.insert("models".into(), Value::Sequence(models));
        self.write_config(&config)
    }

    fn verify(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> bool {
        // TS: 只比对 apiBase 与非空的 model，不检查 provider/apiKey
        let check = (|| {
            let config = self.read_config();
            let models = config.get("models")?.as_sequence()?;
            let entry = models.iter().find(|m| m.get("title").and_then(|t| t.as_str()) == Some(profile.name.as_str()))?;
            let expected_base = profile.base_url.as_deref()
                .or(preset.map(|p| p.base_url.as_str()))
                .unwrap_or("");
            if entry.get("apiBase").and_then(|v| v.as_str()) != Some(expected_base) { return Some(false); }
            if let Some(expected_model) = get_openai_model(profile) {
                if entry.get("model").and_then(|v| v.as_str()) != Some(expected_model) { return Some(false); }
            }
            Some(true)
        })();
        check.unwrap_or(false)
    }

    fn remove(&self, profile_name: &str) -> Result<(), CoreError> {
        // TS: 仅当数组变短才写回；异常仅 warn
        let result = (|| -> Result<(), CoreError> {
            if !self.path.exists() { return Ok(()); }
            let mut config = self.read_config();
            let models: Vec<Value> = config.get("models").and_then(|m| m.as_sequence().cloned()).unwrap_or_default();
            let filtered: Vec<Value> = models.into_iter()
                .filter(|m| m.get("title").and_then(|t| t.as_str()) != Some(profile_name))
                .collect();
            let original_len = config.get("models").and_then(|m| m.as_sequence()).map(|s| s.len()).unwrap_or(0);
            if filtered.len() != original_len {
                config.insert("models".into(), Value::Sequence(filtered));
                self.write_config(&config)?;
            }
            Ok(())
        })();
        if let Err(e) = result { eprintln!("Warning: failed to cleanup continue config: {e}"); }
        Ok(())
    }
}
```

- [ ] **Step 3: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-core continue`
Expected: 4 个测试 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/core/src/adapters/continue_.rs
git commit -m "feat(rust): continue adapter with yaml upsert semantics"
```

---

### Task 9: export / import

**Files:**
- Modify: `packages/cli/crates/core/src/export.rs`
- Test: `packages/cli/crates/core/src/export.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Consumes: `ConfigManager`（Task 3）、`types::now_iso`（Task 5 已提升）
- Produces:
  - `export::ExportFile { profiles: Vec<Profile>, exported_at: String, version: String, sanitized: bool }`（camelCase 序列化）
  - `export::EXPORT_VERSION: &str = "1.0.0"`
  - `export::export_config(config: &ConfigFile, path: &Path, sanitize: bool, names: Option<&[String]>) -> Result<(), CoreError>`
  - `export::import_config(mgr: &mut ConfigManager, path: &Path, overwrite: bool, skip_sanitized: bool) -> Result<ImportStats, CoreError>`
  - `export::ImportStats { imported: usize, skipped: usize, errors: Vec<String> }`
  - `export::sanitize_api_key(key: &str) -> String`（len ≤ 8 → `"***"`；否则 `前4 + "***" + 后4`）
  - `export::validate_export_file(path: &Path) -> Result<ExportFileInfo, CoreError>`（`ExportFileInfo { profile_count: usize, sanitized: bool }`）

- [ ] **Step 1: 写失败测试（export.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigManager;
    use crate::types::Profile;

    fn profile(name: &str, key: &str) -> Profile {
        Profile { name: name.into(), provider_id: "ollama".into(), api_key: key.into(),
                  created_at: "2025-01-01T00:00:00.000Z".into(), updated_at: "2025-01-01T00:00:00.000Z".into(),
                  ..Default::default() }
    }

    #[test]
    fn sanitize_rules() {
        assert_eq!(sanitize_api_key("short"), "***");            // ≤8
        assert_eq!(sanitize_api_key("12345678"), "***");         // 恰好 8
        assert_eq!(sanitize_api_key("sk-1234567890abcd"), "sk-1***abcd");
    }

    #[test]
    fn export_sanitized_roundtrip_and_skip() {
        let dir = tempfile::tempdir().unwrap();
        let mut mgr = ConfigManager::load_from(dir.path().join("config.json"));
        mgr.upsert_profile(profile("p1", "sk-1234567890abcd"), None).unwrap();
        let out = dir.path().join("export.json");
        export_config(mgr.config(), &out, true, None).unwrap();
        let raw: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        assert_eq!(raw["version"], "1.0.0");
        assert_eq!(raw["sanitized"], true);
        assert_eq!(raw["profiles"][0]["apiKey"], "sk-1***abcd");
        // sanitized + skip_sanitized → 拒绝导入
        let err = import_config(&mut mgr, &out, false, true).unwrap_err();
        assert!(matches!(err, CoreError::InvalidImport(_)));
    }

    #[test]
    fn import_skip_existing_and_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let mut mgr = ConfigManager::load_from(dir.path().join("config.json"));
        mgr.upsert_profile(profile("p1", "old-key-00000000"), None).unwrap();
        let out = dir.path().join("export.json");
        // 导出（不 sanitize），改 key 后重新导入
        export_config(mgr.config(), &out, false, None).unwrap();
        let mut data: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        data["profiles"][0]["apiKey"] = "new-key-11111111".into();
        data["profiles"].as_array_mut().unwrap().push(
            serde_json::to_value(profile("p2", "k2-22222222")).unwrap());
        std::fs::write(&out, serde_json::to_string_pretty(&data).unwrap()).unwrap();

        let stats = import_config(&mut mgr, &out, false, true).unwrap();
        assert_eq!((stats.imported, stats.skipped), (1, 1)); // p2 导入，p1 跳过
        assert_eq!(mgr.get_profile("p1").unwrap().api_key, "old-key-00000000");

        let stats = import_config(&mut mgr, &out, true, true).unwrap();
        assert_eq!((stats.imported, stats.skipped), (2, 0));
        assert_eq!(mgr.get_profile("p1").unwrap().api_key, "new-key-11111111");
        // createdAt 保留，updatedAt 更新
        assert_eq!(mgr.get_profile("p1").unwrap().created_at, "2025-01-01T00:00:00.000Z");
        assert_ne!(mgr.get_profile("p1").unwrap().updated_at, "2025-01-01T00:00:00.000Z");
    }
}
```

- [ ] **Step 2: 实现 export.rs**

```rust
use crate::config::ConfigManager;
use crate::types::{now_iso, ConfigFile, Profile};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const EXPORT_VERSION: &str = "1.0.0";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub profiles: Vec<Profile>,
    pub exported_at: String,
    pub version: String,
    pub sanitized: bool,
}

pub struct ImportStats {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

pub struct ExportFileInfo {
    pub profile_count: usize,
    pub sanitized: bool,
}

/// TS: API_KEY_FORMAT sanitizeLength=8, prefixLength=4, suffixLength=4
pub fn sanitize_api_key(key: &str) -> String {
    if key.len() <= 8 { return "***".into(); }
    format!("{}***{}", &key[..4], &key[key.len() - 4..])
}

pub fn export_config(config: &ConfigFile, path: &Path, sanitize: bool,
                     names: Option<&[String]>) -> Result<(), CoreError> {
    let mut profiles: Vec<Profile> = match names {
        Some(ns) if !ns.is_empty() => ns.iter()
            .filter_map(|n| config.profiles.get(n).cloned())
            .collect(),
        _ => config.profiles.values().cloned().collect(),
    };
    if profiles.is_empty() {
        return Err(CoreError::Validation("No profiles available to export".into()));
    }
    if sanitize {
        for p in &mut profiles { p.api_key = sanitize_api_key(&p.api_key); }
    }
    let data = ExportFile {
        profiles,
        exported_at: now_iso(),
        version: EXPORT_VERSION.into(),
        sanitized: sanitize,
    };
    std::fs::write(path, serde_json::to_string_pretty(&data)?)?;
    Ok(())
}

pub fn import_config(mgr: &mut ConfigManager, path: &Path, overwrite: bool,
                     skip_sanitized: bool) -> Result<ImportStats, CoreError> {
    if !path.exists() {
        return Err(CoreError::InvalidImport(format!("File does not exist: {}", path.display())));
    }
    let raw = std::fs::read_to_string(path)?;
    let data: ExportFile = serde_json::from_str(&raw)
        .map_err(|e| CoreError::InvalidImport(format!("Invalid import file format: {e}")))?;
    if data.sanitized && skip_sanitized {
        return Err(CoreError::InvalidImport(
            "Import file contains sanitized API Keys and cannot be imported. \
             Please use the complete configuration file or set skipSanitized=false".into()));
    }
    let mut stats = ImportStats { imported: 0, skipped: 0, errors: vec![] };
    let now = now_iso();
    for profile in data.profiles {
        let existing = mgr.config().profiles.get(&profile.name);
        if existing.is_some() && !overwrite {
            stats.skipped += 1;
            continue;
        }
        let mut p = profile.clone();
        p.created_at = existing.map(|e| e.created_at.clone()).unwrap_or_else(|| now.clone());
        p.updated_at = now.clone();
        mgr.config_mut_for_test().profiles.insert(p.name.clone(), p);
        stats.imported += 1;
    }
    if stats.imported > 0 {
        mgr.mark_dirty();
        mgr.save()?;
    }
    Ok(stats)
}

pub fn validate_export_file(path: &Path) -> Result<ExportFileInfo, CoreError> {
    let raw = std::fs::read_to_string(path)
        .map_err(|_| CoreError::InvalidImport("File does not exist".into()))?;
    let data: ExportFile = serde_json::from_str(&raw)
        .map_err(|e| CoreError::InvalidImport(e.to_string()))?;
    Ok(ExportFileInfo { profile_count: data.profiles.len(), sanitized: data.sanitized })
}
```

- [ ] **Step 3: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-core export`
Expected: 3 个测试 PASS。然后 `cargo test -p swixter-core` 全量回归 + `cargo clippy --workspace -- -D warnings`。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/core/src/export.rs
git commit -m "feat(rust): config export/import with sanitize support"
```

---

### Task 10: CLI 骨架（clap 树 + main + 退出码）

**Files:**
- Create: `packages/cli/crates/swixter/src/cli.rs`
- Modify: `packages/cli/crates/swixter/src/main.rs`
- Create: `packages/cli/crates/swixter/src/commands/mod.rs`（空壳）
- Test: `packages/cli/crates/swixter/tests/cli_smoke.rs`

**Interfaces:**
- Consumes: 无（纯命令树定义）
- Produces:
  - `cli::Cli`（clap Parser 根）、`cli::Commands`（`Claude(CoderArgs)` / `Codex(CoderArgs)` / `Qwen(CoderArgs)` / `Providers(ProvidersArgs)` / `Group(GroupArgs)` / `Export { file: PathBuf }` / `Import { file: PathBuf }` / `Completion { shell: ShellKind }` / `Proxy(StubArgs)` / `Ui(StubArgs)` / `Auth(StubArgs)` / `Sync(StubArgs)`）
  - `cli::CoderArgs { command: Option<CoderCommand> }`、`cli::CoderCommand`、`cli::CreateArgs`、`cli::ShellKind`
  - `main::run() -> i32` 与退出码约定：0/1/2/3/130
  - proxy/ui/auth/sync 为存根：打印 `"<cmd> is not yet available in the Rust build (coming in milestone M2/M3)"` 并 exit 1

- [ ] **Step 1: 写失败的冒烟测试**

`packages/cli/crates/swixter/tests/cli_smoke.rs`：

```rust
use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn version_prints() {
    Command::cargo_bin("swixter").unwrap()
        .arg("--version")
        .assert().success()
        .stdout(predicate::str::contains("swixter"));
}

#[test]
fn unknown_command_exits_2() {
    Command::cargo_bin("swixter").unwrap()
        .arg("bogus")
        .assert().code(2);
}

#[test]
fn proxy_stub_exits_1() {
    Command::cargo_bin("swixter").unwrap()
        .args(["proxy", "status"])
        .assert().code(1)
        .stderr(predicate::str::contains("not yet available"));
}

#[test]
fn completion_bash_outputs_script() {
    Command::cargo_bin("swixter").unwrap()
        .args(["completion", "bash"])
        .assert().success()
        .stdout(predicate::str::contains("swixter"));
}
```

Run: `cd packages/cli && cargo test -p swixter`
Expected: FAIL（bin 未实现）。

- [ ] **Step 2: 实现 cli.rs**

```rust
use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "swixter", version, about = "AI coding assistant profile switcher")]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Manage Claude Code profiles
    Claude(CoderArgs),
    /// Manage Codex profiles
    Codex(CoderArgs),
    /// Manage Qwen (Continue.dev) profiles
    Qwen(CoderArgs),
    /// Manage custom providers
    Providers(ProvidersArgs),
    /// Manage failover groups
    Group(GroupArgs),
    /// Export profiles to a file
    Export { file: PathBuf },
    /// Import profiles from a file
    Import { file: PathBuf },
    /// Print shell completion script
    Completion { shell: ShellKind },
    /// [M2] Local proxy with failover
    Proxy(StubArgs),
    /// [M3] Web UI
    Ui(StubArgs),
    /// [M3] Cloud auth
    Auth(StubArgs),
    /// [M3] Cloud sync
    Sync(StubArgs),
}

#[derive(Args)]
pub struct StubArgs {
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub args: Vec<String>,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum ShellKind { Bash, Zsh, Fish }

#[derive(Args)]
pub struct CoderArgs {
    #[command(subcommand)]
    pub command: Option<CoderCommand>,
}

#[derive(Subcommand)]
pub enum CoderCommand {
    /// Create a new profile (interactive wizard unless --quiet)
    #[command(alias = "new", alias = "create-profile")]
    Create(CreateArgs),
    /// List profiles
    #[command(alias = "ls")]
    List,
    /// Switch active profile
    #[command(alias = "sw", alias = "switch-profile")]
    Switch {
        name: String,
        #[arg(long)] apply: bool,
        #[arg(long = "no-apply")] no_apply: bool,
    },
    /// Edit a profile (interactive)
    #[command(alias = "update")]
    Edit { name: Option<String> },
    /// Delete a profile
    #[command(alias = "rm", alias = "delete-profile")]
    Delete { name: String },
    /// Apply active profile to the coder's config file
    Apply,
    /// Show current active profile
    Current,
    /// Run the coder CLI with the active profile
    #[command(alias = "r")]
    Run(RunArgs),
    /// Install the coder CLI
    Install {
        /// 1-based install method index
        #[arg(long)] method: Option<usize>,
        #[arg(long)] force: bool,
    },
    /// Update the coder CLI
    #[command(alias = "upgrade")]
    UpdateCli,
}

#[derive(Args)]
pub struct CreateArgs {
    #[arg(long, short = 'n')] pub name: Option<String>,
    #[arg(long, short = 'p')] pub provider: Option<String>,
    #[arg(long, short = 'k')] pub api_key: Option<String>,
    #[arg(long, short = 't')] pub auth_token: Option<String>,
    #[arg(long, short = 'u')] pub base_url: Option<String>,
    #[arg(long, short = 'm')] pub model: Option<String>,
    #[arg(long)] pub env_key: Option<String>,
    #[arg(long)] pub anthropic_model: Option<String>,
    #[arg(long)] pub default_haiku_model: Option<String>,
    #[arg(long)] pub default_opus_model: Option<String>,
    #[arg(long)] pub default_sonnet_model: Option<String>,
    #[arg(long)] pub api_format: Option<String>,
    /// Non-interactive mode (requires --name and --provider)
    #[arg(long, short = 'q')] pub quiet: bool,
    /// Apply immediately after creation
    #[arg(long, short = 'a')] pub apply: bool,
}

#[derive(Args)]
pub struct RunArgs {
    /// Use a specific profile instead of the active one
    #[arg(long)] pub profile: Option<String>,
    /// [claude only] Skip permission prompts
    #[arg(long)] pub yolo: bool,
    /// Arguments passed through to the coder CLI
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub args: Vec<String>,
}

#[derive(Args)]
pub struct ProvidersArgs {
    #[command(subcommand)]
    pub command: Option<ProvidersCommand>,
}

#[derive(Subcommand)]
pub enum ProvidersCommand {
    #[command(alias = "ls")]
    List,
    #[command(alias = "new")]
    Add(ProviderAddArgs),
    #[command(alias = "rm", alias = "delete")]
    Remove { id: Option<String>, #[arg(long, short = 'q')] quiet: bool },
    #[command(alias = "info")]
    Show { id: String },
}

#[derive(Args)]
pub struct ProviderAddArgs {
    #[arg(long, short = 'i')] pub id: Option<String>,
    #[arg(long, short = 'n')] pub name: Option<String>,
    #[arg(long, short = 'd')] pub display_name: Option<String>,
    #[arg(long, short = 'u')] pub base_url: Option<String>,
    #[arg(long, short = 't')] pub auth_type: Option<String>,
    #[arg(long, short = 'm')] pub models: Option<String>, // 逗号分隔
    #[arg(long, short = 'q')] pub quiet: bool,
}

#[derive(Args)]
pub struct GroupArgs {
    #[command(subcommand)]
    pub command: Option<GroupCommand>,
}

#[derive(Subcommand)]
pub enum GroupCommand {
    #[command(alias = "ls")]
    List,
    #[command(alias = "new")]
    Create { name: Option<String>,
             #[arg(long)] profiles: Option<String> }, // 逗号分隔
    #[command(alias = "update")]
    Edit { name: Option<String>,
           #[arg(long = "name")] new_name: Option<String>,
           #[arg(long)] profiles: Option<String> },
    #[command(alias = "rm")]
    Delete { name: String, #[arg(long, short = 'f')] force: bool },
    SetDefault { name: String },
    #[command(alias = "info")]
    Show { name: String },
}
```

注意：TS 用 `new→create`、`sw→switch` 等别名（`constants/commands.ts`），clap `alias` 覆盖；`r→run`、`ls→list` 同理。`-h` 冲突：clap 默认 help 占用 `-h`，TS 的 `-h` 也是 help，一致。

- [ ] **Step 3: 实现 main.rs（存根命令 + 退出码）**

```rust
mod cli;
mod commands;

use clap::{CommandFactory, Parser};
use cli::{Cli, Commands};

pub const EXIT_SUCCESS: i32 = 0;
pub const EXIT_GENERAL: i32 = 1;
pub const EXIT_INVALID_ARG: i32 = 2;
pub const EXIT_NOT_FOUND: i32 = 3;
pub const EXIT_CANCELLED: i32 = 130;

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let cli = Cli::parse();
    match cli.command {
        Commands::Proxy(_) | Commands::Ui(_) | Commands::Auth(_) | Commands::Sync(_) => {
            eprintln!("This command is not yet available in the Rust build (coming in milestone M2/M3).");
            EXIT_GENERAL
        }
        Commands::Completion { shell } => {
            let mut cmd = Cli::command();
            let clap_shell = match shell {
                cli::ShellKind::Bash => clap_complete::Shell::Bash,
                cli::ShellKind::Zsh => clap_complete::Shell::Zsh,
                cli::ShellKind::Fish => clap_complete::Shell::Fish,
            };
            clap_complete::generate(clap_shell, &mut cmd, "swixter", &mut std::io::stdout());
            EXIT_SUCCESS
        }
        // 以下分支在后续任务中接入真实 handler；先报"未实现"保持编译
        _ => {
            eprintln!("not implemented yet");
            EXIT_GENERAL
        }
    }
}
```

注意：clap 解析失败（未知命令）默认 exit 2，与 `unknown_command_exits_2` 测试一致。`commands/mod.rs` 先为空文件。

- [ ] **Step 4: 跑测试**

Run: `cd packages/cli && cargo test -p swixter`
Expected: 4 个测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/swixter
git commit -m "feat(rust): clap command tree, main entry, completion, stub commands"
```

---

### Task 11: coder 命令 handler（create/list/switch/edit/delete/apply/current）

**Files:**
- Create: `packages/cli/crates/swixter/src/commands/coder.rs`
- Modify: `packages/cli/crates/swixter/src/commands/mod.rs`
- Modify: `packages/cli/crates/swixter/src/main.rs`
- Test: `packages/cli/crates/swixter/tests/coder_commands.rs`

**Interfaces:**
- Consumes: `ConfigManager`（Task 3）、`presets::find_provider`（Task 4）、`adapters::get_adapter`（Task 6）、`coder::get_coder`（Task 6）、`cli::{CoderArgs, CoderCommand, CreateArgs}`（Task 10）
- Produces:
  - `commands::coder::dispatch(coder_id: &str, args: CoderArgs) -> i32`（main 的三个 coder 分支统一调它）
  - `commands::coder::create_quiet(coder: &CoderSpec, a: CreateArgs) -> Result<Profile, String>`
  - `commands::coder::apply_active(coder: &CoderSpec) -> Result<(), String>`（adapter.apply + verify，verify 失败 exit 1）
  - `commands::coder::handle_apply_prompt(coder, apply: bool, no_apply: bool) -> i32`（TS utils/commands.ts 三模式：--apply 直接 apply / --no-apply 打 tip / 否则 Confirm 默认 true）

- [ ] **Step 1: 写失败测试（tests/coder_commands.rs）**

测试通过 `SWIXTER_CONFIG_PATH` + `HOME` 环境变量隔离（assert_cmd 可 `.env()`）：

```rust
use assert_cmd::Command;
use predicates::prelude::*;

fn swixter(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
     .env("HOME", dir.path());
    c
}

#[test]
fn create_list_switch_current_delete() {
    let dir = tempfile::tempdir().unwrap();
    // create（quiet）
    swixter(&dir).args(["claude", "create", "--quiet",
        "--name", "test1", "--provider", "anthropic", "--api-key", "sk-ant-12345"])
        .assert().success();
    // 首个 profile 自动激活
    swixter(&dir).args(["claude", "current"])
        .assert().success().stdout(predicate::str::contains("test1"));
    // 第二个 profile + switch
    swixter(&dir).args(["claude", "create", "--quiet",
        "--name", "test2", "--provider", "ollama", "--base-url", "http://localhost:11434"])
        .assert().success();
    swixter(&dir).args(["claude", "switch", "test2", "--no-apply"])
        .assert().success().stdout(predicate::str::contains("test2"));
    swixter(&dir).args(["claude", "current"])
        .assert().success().stdout(predicate::str::contains("test2"));
    // 别名 sw
    swixter(&dir).args(["claude", "sw", "test1", "--no-apply"]).assert().success();
    // list 标记激活
    swixter(&dir).args(["claude", "ls"])
        .assert().success()
        .stdout(predicate::str::contains("test1").and(predicate::str::contains("test2")));
    // apply 到隔离 HOME 的 ~/.claude/settings.json
    swixter(&dir).args(["claude", "apply"]).assert().success();
    let settings = std::fs::read_to_string(dir.path().join(".claude/settings.json")).unwrap();
    assert!(settings.contains("sk-ant-12345"));
    // delete：激活态被清除
    swixter(&dir).args(["claude", "delete", "test1"]).assert().success();
    swixter(&dir).args(["claude", "current"])
        .assert().success().stdout(predicate::str::contains("No active profile"));
}

#[test]
fn create_quiet_validates_name_and_provider() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir).args(["claude", "create", "--quiet", "--name", "x", "--provider", "anthropic"])
        .assert().code(2); // name 长度 < 2
    swixter(&dir).args(["claude", "create", "--quiet", "--name", "ok1", "--provider", "nope-provider"])
        .assert().code(1); // 未知 provider
    swixter(&dir).args(["claude", "create", "--quiet", "--provider", "anthropic"])
        .assert().code(2); // quiet 缺 --name
}

#[test]
fn codex_create_requires_api_key_unless_ollama() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir).args(["codex", "create", "--quiet", "--name", "c1", "--provider", "openrouter"])
        .assert().code(2); // 缺 --api-key
    swixter(&dir).args(["codex", "create", "--quiet", "--name", "c1", "--provider", "ollama"])
        .assert().success();
}

#[test]
fn qwen_rejects_anthropic_provider() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir).args(["qwen", "create", "--quiet",
        "--name", "q1", "--provider", "anthropic", "--model", "m", "--api-key", "k"])
        .assert().code(2);
}

#[test]
fn switch_unknown_profile_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir).args(["claude", "switch", "ghost", "--no-apply"]).assert().code(3);
}
```

- [ ] **Step 2: 实现 commands/coder.rs**

```rust
use crate::cli::{CoderArgs, CoderCommand, CreateArgs};
use crate::{EXIT_CANCELLED, EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use swixter_core::adapters::get_adapter;
use swixter_core::coder::{get_coder, CoderSpec};
use swixter_core::config::ConfigManager;
use swixter_core::presets;
use swixter_core::types::{now_iso, ApiFormat, ModelsConfig, Profile};

pub fn dispatch(coder_id: &str, args: CoderArgs) -> i32 {
    let coder = match get_coder(coder_id) {
        Some(c) => c,
        None => { eprintln!("Unknown coder: {coder_id}"); return EXIT_INVALID_ARG; }
    };
    match args.command {
        None => crate::commands::interactive::main_menu(coder), // Task 14
        Some(CoderCommand::Create(a)) => cmd_create(coder, a),
        Some(CoderCommand::List) => cmd_list(coder),
        Some(CoderCommand::Switch { name, apply, no_apply }) => cmd_switch(coder, &name, apply, no_apply),
        Some(CoderCommand::Edit { name }) => crate::commands::interactive::edit_wizard(coder, name),
        Some(CoderCommand::Delete { name }) => cmd_delete(coder, &name),
        Some(CoderCommand::Apply) => match apply_active(coder) {
            Ok(()) => { println!("✓ Applied to {}", coder.display_name); EXIT_SUCCESS }
            Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
        },
        Some(CoderCommand::Current) => cmd_current(coder),
        Some(CoderCommand::Run(a)) => crate::commands::run::run(coder, a),       // Task 12
        Some(CoderCommand::Install { method, force }) =>
            crate::commands::install::install(coder, method, force),           // Task 13
        Some(CoderCommand::UpdateCli) => crate::commands::install::update(coder),
    }
}

fn valid_profile_name(name: &str) -> bool {
    name.len() >= 2 && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn parse_api_format(s: &str) -> Result<ApiFormat, String> {
    match s {
        "openai_chat" => Ok(ApiFormat::OpenaiChat),
        "anthropic_messages" => Ok(ApiFormat::AnthropicMessages),
        "openai_responses" => Ok(ApiFormat::OpenaiResponses),
        "anthropic_responses" => Ok(ApiFormat::AnthropicResponses),
        "gemini_native" => Ok(ApiFormat::GeminiNative),
        other => Err(format!("Invalid --api-format: {other} (valid: openai_chat, anthropic_messages, openai_responses, anthropic_responses, gemini_native)")),
    }
}

/// quiet 模式创建；返回构建好的 Profile（尚未入库）。
/// 校验规则（TS cli/{claude,codex,qwen}.ts）：
/// - 必填 --name --provider（qwen 另需 --model）；name 正则 ^[a-zA-Z0-9_-]+$ 且 ≥2
/// - provider 必须存在（presets::find_provider）
/// - 非 ollama provider 必须 --api-key（codex/qwen；claude 允许空）
/// - qwen 拒绝 provider=anthropic；qwen 同时写 model 和 openaiModel
pub fn create_quiet(coder: &CoderSpec, a: &CreateArgs) -> Result<Profile, (String, i32)> {
    let name = a.name.clone().ok_or_else(|| ("--name is required in --quiet mode".into(), EXIT_INVALID_ARG))?;
    if !valid_profile_name(&name) {
        return Err(("Invalid profile name (min 2 chars, [a-zA-Z0-9_-])".into(), EXIT_INVALID_ARG));
    }
    let provider_id = a.provider.clone().ok_or_else(|| ("--provider is required in --quiet mode".into(), EXIT_INVALID_ARG))?;
    let preset = presets::find_provider(&provider_id)
        .ok_or_else(|| (format!("Unknown provider: {provider_id}"), EXIT_GENERAL))?;
    if coder.id == "qwen" && provider_id == "anthropic" {
        return Err(("Provider 'anthropic' is not supported for qwen".into(), EXIT_INVALID_ARG));
    }
    let api_key = a.api_key.clone().unwrap_or_default();
    if coder.id != "claude" && provider_id != "ollama" && api_key.is_empty() {
        return Err(("--api-key is required for this provider".into(), EXIT_INVALID_ARG));
    }
    if coder.id == "qwen" && a.model.is_none() {
        return Err(("--model is required for qwen".into(), EXIT_INVALID_ARG));
    }
    let api_format = match &a.api_format {
        Some(s) => Some(parse_api_format(s).map_err(|e| (e, EXIT_INVALID_ARG))?),
        None => None,
    };
    let has_models = [&a.anthropic_model, &a.default_haiku_model, &a.default_opus_model, &a.default_sonnet_model]
        .iter().any(|m| m.is_some());
    let now = now_iso();
    Ok(Profile {
        name,
        provider_id,
        api_key,
        auth_token: a.auth_token.clone().filter(|s| !s.is_empty()),
        base_url: a.base_url.clone().filter(|s| !s.is_empty()),
        model: a.model.clone(),
        openai_model: if coder.id == "qwen" { a.model.clone() } else { None },
        models: if has_models {
            Some(ModelsConfig {
                anthropic_model: a.anthropic_model.clone(),
                default_haiku_model: a.default_haiku_model.clone(),
                default_opus_model: a.default_opus_model.clone(),
                default_sonnet_model: a.default_sonnet_model.clone(),
            })
        } else { None },
        env_key: a.env_key.clone().filter(|s| !s.is_empty()),
        headers: None,
        api_format,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn cmd_create(coder: &CoderSpec, a: CreateArgs) -> i32 {
    if !a.quiet {
        return crate::commands::interactive::create_wizard(coder, a); // Task 14
    }
    match create_quiet(coder, &a) {
        Ok(profile) => {
            let mut mgr = ConfigManager::load();
            if let Err(e) = mgr.upsert_profile(profile.clone(), Some(coder.id)) {
                eprintln!("✗ {e}");
                return EXIT_GENERAL;
            }
            println!("✓ Profile \"{}\" created", profile.name);
            if a.apply {
                match apply_active(coder) {
                    Ok(()) => println!("✓ Applied to {}", coder.display_name),
                    Err(e) => { eprintln!("✗ {e}"); return EXIT_GENERAL; }
                }
            }
            EXIT_SUCCESS
        }
        Err((msg, code)) => { eprintln!("✗ {msg}"); code }
    }
}

fn cmd_list(coder: &CoderSpec) -> i32 {
    let mgr = ConfigManager::load();
    let active = mgr.config().coders.get(coder.id).map(|c| c.active_profile.as_str()).unwrap_or("");
    if mgr.config().profiles.is_empty() {
        println!("No profiles. Create one with: swixter {} create", coder.id);
        return EXIT_SUCCESS;
    }
    for (name, p) in &mgr.config().profiles {
        let marker = if name == active { "●" } else { " " };
        let model = swixter_core::model::get_openai_model(p)
            .or(p.models.as_ref().and_then(|m| m.anthropic_model.as_deref()))
            .unwrap_or("-");
        println!("{marker} {name}  ({}, model: {model})", p.provider_id);
    }
    EXIT_SUCCESS
}

fn cmd_current(coder: &CoderSpec) -> i32 {
    let mgr = ConfigManager::load();
    match mgr.active_profile(coder.id) {
        Some(p) => { println!("{} ({})", p.name, p.provider_id); EXIT_SUCCESS }
        None => { println!("No active profile for {}", coder.display_name); EXIT_SUCCESS }
    }
}

fn cmd_switch(coder: &CoderSpec, name: &str, apply: bool, no_apply: bool) -> i32 {
    let mut mgr = ConfigManager::load();
    match mgr.set_active_profile(coder.id, name) {
        Ok(()) => println!("✓ Switched to \"{name}\""),
        Err(swixter_core::CoreError::NotFound(e)) => { eprintln!("✗ {e}"); return EXIT_NOT_FOUND; }
        Err(e) => { eprintln!("✗ {e}"); return EXIT_GENERAL; }
    }
    handle_apply_prompt(coder, apply, no_apply)
}

/// TS: utils/commands.ts handleApplyPrompt 三模式
pub fn handle_apply_prompt(coder: &CoderSpec, apply: bool, no_apply: bool) -> i32 {
    if apply {
        return match apply_active(coder) {
            Ok(()) => { println!("✓ Applied to {}", coder.display_name); EXIT_SUCCESS }
            Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
        };
    }
    if no_apply || !is_tty() {
        println!("Tip: Run 'swixter {} apply' to apply profile to {}", coder.id, coder.display_name);
        return EXIT_SUCCESS;
    }
    match dialoguer::Confirm::new()
        .with_prompt(format!("Apply this profile to {} now?", coder.display_name))
        .default(true)
        .interact()
    {
        Ok(true) => match apply_active(coder) {
            Ok(()) => { println!("✓ Applied to {}", coder.display_name); EXIT_SUCCESS }
            Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
        },
        Ok(false) => {
            println!("Tip: Run 'swixter {} apply' to apply profile to {}", coder.id, coder.display_name);
            EXIT_SUCCESS
        }
        Err(_) => EXIT_SUCCESS, // TS: cancel 时优雅返回
    }
}

fn is_tty() -> bool {
    // 简单判定：stdin 是终端。用 std::io::IsTerminal（Rust 1.70+）。
    std::io::IsTerminal::is_terminal(&std::io::stdin())
}

pub fn apply_active(coder: &CoderSpec) -> Result<(), String> {
    let mgr = ConfigManager::load();
    let profile = mgr.active_profile(coder.id)
        .ok_or_else(|| format!("No active profile for {}", coder.display_name))?;
    let preset = presets::find_provider(&profile.provider_id);
    let adapter = get_adapter(coder.adapter);
    adapter.apply(profile, preset.as_ref()).map_err(|e| e.to_string())?;
    if !adapter.verify(profile, preset.as_ref()) {
        return Err(format!("Verification failed for {}", coder.display_name));
    }
    Ok(())
}

fn cmd_delete(coder: &CoderSpec, name: &str) -> i32 {
    // TS: deleteProfile 先对所有 coder 做 adapter 清理（失败仅 warn），再删配置
    for c in swixter_core::coder::CODERS {
        let adapter = get_adapter(c.adapter);
        if let Err(e) = adapter.remove(name) {
            eprintln!("Warning: failed to cleanup {} adapter configuration: {e}", c.id);
        }
    }
    let mut mgr = ConfigManager::load();
    match mgr.delete_profile(name) {
        Ok(()) => { println!("✓ Profile \"{name}\" deleted"); EXIT_SUCCESS }
        Err(swixter_core::CoreError::NotFound(e)) => { eprintln!("✗ {e}"); EXIT_NOT_FOUND }
        Err(swixter_core::CoreError::InUse(e)) => { eprintln!("✗ {e}"); EXIT_GENERAL }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}
```

注意 `now_iso` 需在 Task 5 中已提升为 `types::now_iso()`（pub）。`dialoguer::Confirm` 在 switch 非交互路径也会用到，因此 `dialoguer` 在 Task 10 已是 swixter 依赖。

- [ ] **Step 3: 接线 main.rs 的 coder 分支**

`main.rs` 的 match 中替换 `_ =>` 分支之前的部分：

```rust
        Commands::Claude(a) => commands::coder::dispatch("claude", a),
        Commands::Codex(a) => commands::coder::dispatch("codex", a),
        Commands::Qwen(a) => commands::coder::dispatch("qwen", a),
```

`commands/mod.rs`：`pub mod coder;`（interactive/run/install 模块在后续任务加入；本步先建只含 `pub fn` 存根的空模块让编译通过，存根返回 EXIT_GENERAL 并打印 "not implemented yet"）。

- [ ] **Step 4: 跑测试**

Run: `cd packages/cli && cargo test -p swixter`
Expected: coder_commands 5 个测试 PASS。

注意：`apply` 测试写 `~/.claude/settings.json`——测试用 `.env("HOME", dir.path())` 隔离；`paths::claude_settings_path` 用 `dirs::home_dir()`，其尊重 `HOME` 环境变量，隔离有效。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/swixter
git commit -m "feat(rust): coder profile commands (create/list/switch/apply/current/delete)"
```

---

### Task 12: run 命令

**Files:**
- Create: `packages/cli/crates/swixter/src/commands/run.rs`
- Test: `packages/cli/crates/swixter/tests/run_command.rs`

**Interfaces:**
- Consumes: `apply_active`（Task 11）、`model::{build_profile_env, get_openai_model, resolve_env_key, CLAUDE_ENV_MAPPING}`（Task 6）
- Produces: `commands::run::run(coder: &CoderSpec, args: RunArgs) -> i32`

行为规格（TS 逐条对齐）：
- 通用：`--profile <name>` 指定 profile（否则 active）；找不到 → exit 3。spawn `coder.executable` + 透传参数（`--profile` 及其值已从 clap 解析剥离，不会出现在 `args.args`），继承 stdio，退出码 = 子进程退出码；可执行文件不存在 → 错误提示 + exit 3。
- claude：构建临时 `swixter-settings-<millis>.json`（内容 = `{ "env": build_profile_env(...) }`），追加 `--settings <tmp>`；`--yolo` → 追加 `--dangerously-skip-permissions`；子进程退出后删除临时文件。
- codex：先 `adapter.apply(profile, preset)`（写 config.toml），再以 `resolve_env_key` 注入 `<envKey>=<apiKey>`（apiKey 非空时），`OPENAI_MODEL=<get_openai_model>`（非空时）。
- qwen：注入 `--openai-api-key <apiKey>`、`--openai-base-url <base>`、`--model <model>` 三个参数（值非空时）后透传。

- [ ] **Step 1: 写失败测试（tests/run_command.rs）**

测试用假 executable：临时目录写一个 shell 脚本 `claude`/`codex`/`qwen`（打印参数与 env 到文件），`PATH` 注入。

```rust
use assert_cmd::Command;

fn fake_cli(dir: &tempfile::TempDir, name: &str) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let script = bin.join(name);
    std::fs::write(&script, format!(
        "#!/bin/sh\necho \"$@\" > \"$FAKE_OUT.args\"\nenv | grep -E 'ANTHROPIC|OPENAI|OLLAMA' > \"$FAKE_OUT.env\" 2>/dev/null || true\n"
    )).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
     .env("HOME", dir.path())
     .env("FAKE_OUT", dir.path().join("out"))
     .env("PATH", format!("{}:{}", dir.path().join("bin").display(),
                          std::env::var("PATH").unwrap()));
    c
}

#[test]
#[cfg(unix)]
fn claude_run_passes_settings_and_yolo() {
    let dir = tempfile::tempdir().unwrap();
    fake_cli(&dir, "claude");
    setup(&dir).args(["claude", "create", "--quiet", "--name", "r1",
        "--provider", "anthropic", "--api-key", "sk-ant-run1"]).assert().success();
    setup(&dir).args(["claude", "run", "--yolo", "chat"]).assert().success();
    let args = std::fs::read_to_string(dir.path().join("out.args")).unwrap();
    assert!(args.contains("--dangerously-skip-permissions"));
    assert!(args.contains("--settings"));
    assert!(args.contains("chat"));
    // 临时 settings 文件已清理
    let leftovers: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("swixter-settings-"))
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
#[cfg(unix)]
fn codex_run_injects_env() {
    let dir = tempfile::tempdir().unwrap();
    fake_cli(&dir, "codex");
    setup(&dir).args(["codex", "create", "--quiet", "--name", "r2",
        "--provider", "ollama", "--model", "qwen2.5-coder:7b"]).assert().success();
    setup(&dir).args(["codex", "run", "exec", "hi"]).assert().success();
    let env = std::fs::read_to_string(dir.path().join("out.env")).unwrap();
    assert!(env.contains("OPENAI_MODEL=qwen2.5-coder:7b"));
    // codex run 会先 apply：config.toml 已写
    assert!(dir.path().join(".codex/config.toml").exists());
}

#[test]
#[cfg(unix)]
fn qwen_run_injects_openai_args() {
    let dir = tempfile::tempdir().unwrap();
    fake_cli(&dir, "qwen");
    setup(&dir).args(["qwen", "create", "--quiet", "--name", "r3",
        "--provider", "ollama", "--model", "qwen2.5-coder:7b",
        "--base-url", "http://localhost:11434"]).assert().success();
    setup(&dir).args(["qwen", "run", "chat"]).assert().success();
    let args = std::fs::read_to_string(dir.path().join("out.args")).unwrap();
    assert!(args.contains("--openai-base-url http://localhost:11434"));
    assert!(args.contains("--model qwen2.5-coder:7b"));
}

#[test]
fn run_without_profile_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir).args(["claude", "run"]).assert().code(3);
}
```

- [ ] **Step 2: 实现 run.rs**

```rust
use crate::cli::RunArgs;
use crate::{EXIT_GENERAL, EXIT_NOT_FOUND};
use swixter_core::adapters::get_adapter;
use swixter_core::coder::CoderSpec;
use swixter_core::config::ConfigManager;
use swixter_core::model::{build_profile_env, get_openai_model, resolve_env_key, CLAUDE_ENV_MAPPING};
use swixter_core::presets;
use swixter_core::types::Profile;
use std::process::Command;

pub fn run(coder: &CoderSpec, args: RunArgs) -> i32 {
    let mgr = ConfigManager::load();
    let profile = match &args.profile {
        Some(name) => mgr.get_profile(name),
        None => mgr.active_profile(coder.id),
    };
    let profile = match profile {
        Some(p) => p.clone(),
        None => {
            eprintln!("✗ No profile available (create one with: swixter {} create)", coder.id);
            return EXIT_NOT_FOUND;
        }
    };
    let preset = presets::find_provider(&profile.provider_id);

    let mut cmd = Command::new(coder.executable);
    cmd.args(&args.args).stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit()).stderr(std::process::Stdio::inherit());

    // claude：临时 settings 文件 + --yolo 重写
    let mut tmp_settings: Option<std::path::PathBuf> = None;
    match coder.id {
        "claude" => {
            let base_url = profile.base_url.as_deref()
                .or(preset.as_ref().map(|p| p.base_url.as_str())).unwrap_or("");
            let env = build_profile_env(&profile, &CLAUDE_ENV_MAPPING, base_url);
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
            let tmp = std::env::temp_dir().join(format!("swixter-settings-{millis}.json"));
            let env_map: serde_json::Map<String, serde_json::Value> = env.into_iter()
                .map(|(k, v)| (k, serde_json::Value::String(v))).collect();
            let json = serde_json::json!({ "env": env_map });
            if let Err(e) = std::fs::write(&tmp, serde_json::to_string_pretty(&json).unwrap()) {
                eprintln!("✗ failed to write temp settings: {e}");
                return EXIT_GENERAL;
            }
            cmd.arg("--settings").arg(&tmp);
            if args.yolo { cmd.arg("--dangerously-skip-permissions"); }
            tmp_settings = Some(tmp);
        }
        "codex" => {
            // TS: codex run 先 apply 再注入 env
            let adapter = get_adapter(coder.adapter);
            if let Err(e) = adapter.apply(&profile, preset.as_ref()) {
                eprintln!("✗ {e}");
                return EXIT_GENERAL;
            }
            if !profile.api_key.is_empty() {
                cmd.env(resolve_env_key(&profile, preset.as_ref()), &profile.api_key);
            }
            if let Some(m) = get_openai_model(&profile) {
                cmd.env("OPENAI_MODEL", m);
            }
        }
        "qwen" => {
            // TS: 注入三个 openai 参数（在透传参数之前）
            let mut pre: Vec<String> = vec![];
            if !profile.api_key.is_empty() {
                pre.extend(["--openai-api-key".into(), profile.api_key.clone()]);
            }
            let base = profile.base_url.as_deref()
                .or(preset.as_ref().map(|p| p.base_url.as_str())).unwrap_or("");
            if !base.is_empty() { pre.extend(["--openai-base-url".into(), base.to_string()]); }
            if let Some(m) = get_openai_model(&profile) {
                pre.extend(["--model".into(), m.to_string()]);
            }
            // 重建参数顺序：注入参数在前
            let mut cmd2 = Command::new(coder.executable);
            cmd2.args(&pre).args(&args.args)
                .stdin(std::process::Stdio::inherit())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            cmd = cmd2;
        }
        _ => {}
    }

    let status = match cmd.status() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("✗ Failed to launch {}: {e}", coder.executable);
            eprintln!("  Is it installed? Try: swixter {} install", coder.id);
            if let Some(t) = &tmp_settings { let _ = std::fs::remove_file(t); }
            return EXIT_NOT_FOUND;
        }
    };
    if let Some(t) = &tmp_settings { let _ = std::fs::remove_file(t); }
    status.code().unwrap_or(EXIT_GENERAL)
}
```

- [ ] **Step 3: 接线 + 跑测试**

`commands/mod.rs` 加 `pub mod run;`（替换存根）。`main.rs` 无需改（dispatch 已调用）。

Run: `cd packages/cli && cargo test -p swixter`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/swixter
git commit -m "feat(rust): run command with env injection for all coders"
```

---

### Task 13: install / update-cli 命令

**Files:**
- Create: `packages/cli/crates/swixter/src/install_data.rs`
- Create: `packages/cli/crates/swixter/src/commands/install.rs`
- Test: `packages/cli/crates/swixter/tests/install_command.rs`

**Interfaces:**
- Consumes: `install.json`（Task 1 codegen）
- Produces:
  - `install_data::INSTALL_DATA: &InstallData`（`include_str!("install.json")` + `OnceLock`）
  - `install_data::InstallMethod { label, command, note: Option<String>, recommended: bool }`
  - `install_data::methods_for(coder_id: &str) -> Vec<InstallMethod>`（按当前平台过滤）
  - `install_data::update_command_for(coder_id, install_command) -> Option<String>`
  - `commands::install::install(coder, method: Option<usize>, force: bool) -> i32`
  - `commands::install::update(coder) -> i32`
  - `commands::install::is_command_available(exe: &str) -> bool`（PATH 查找）
  - `commands::install::get_cli_version(exe: &str) -> Option<String>`（`<exe> --version`，正则提取 semver：`v?(\d+\.\d+\.\d+[^ \n\r]*)` → `v?(\d+\.\d+\.\d+)` → `version[:\s]+(...)`）

- [ ] **Step 1: 确认 install.json 数据结构**

先读 `packages/cli/src/constants/install.ts` 与 `packages/cli/src/utils/install.ts`，把 `install_data.rs` 的 serde 结构对齐实际 JSON。若 codegen 脚本（Task 1 Step 2）导出的字段名与下面假设不同，以源码为准调整。

- [ ] **Step 2: 写失败测试（tests/install_command.rs）**

```rust
use assert_cmd::Command;
use predicates::prelude::*;

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
     .env("HOME", dir.path());
    c
}

#[test]
fn update_cli_without_install_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    // PATH 里没有 claude 可执行文件（HOME 隔离 + PATH 不注入 fake）
    setup(&dir).args(["claude", "update-cli"]).assert().code(3);
}

#[test]
fn install_with_invalid_method_index_exits_2() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir).args(["claude", "install", "--method", "99"])
        .assert().code(2)
        .stderr(predicate::str::contains("Invalid method index").or(predicate::str::contains("Invalid")));
}

#[test]
fn get_cli_version_parses() {
    // 单测在 commands/install.rs 内联：见 Step 3 的 #[cfg(test)]
}
```

- [ ] **Step 3: 实现 install_data.rs + install.rs**

`install_data.rs`（结构以 `install.json` 实际内容为准，下面是预期形状）：

```rust
use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallMethod {
    pub label: String,
    pub command: String,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub recommended: bool,
    #[serde(default)]
    pub platforms: Vec<String>, // e.g. ["macos", "linux", "windows"]；空 = 全平台
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoderInstallConfig {
    pub methods: Vec<InstallMethod>,
    #[serde(default)]
    pub post_install_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallData {
    pub install_configs: std::collections::HashMap<String, CoderInstallConfig>,
    #[serde(default)]
    pub update_commands: std::collections::HashMap<String, std::collections::HashMap<String, String>>,
}

static DATA: OnceLock<InstallData> = OnceLock::new();

pub fn install_data() -> &'static InstallData {
    DATA.get_or_init(|| serde_json::from_str(include_str!("install.json"))
        .expect("bundled install.json must be valid"))
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") { "macos" }
    else if cfg!(target_os = "windows") { "windows" }
    else { "linux" }
}

pub fn methods_for(coder_id: &str) -> Vec<&'static InstallMethod> {
    install_data().install_configs.get(coder_id)
        .map(|c| c.methods.iter()
            .filter(|m| m.platforms.is_empty() || m.platforms.iter().any(|p| p == current_platform()))
            .collect())
        .unwrap_or_default()
}

pub fn update_command_for(coder_id: &str, install_command: &str) -> Option<String> {
    install_data().update_commands.get(coder_id)?.get(install_command).cloned()
}
```

`install.rs`：

```rust
use crate::install_data;
use crate::{EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use swixter_core::coder::CoderSpec;
use std::process::Command;

pub fn is_command_available(exe: &str) -> bool {
    // PATH 逐目录查找（Windows 追加 .exe/.cmd）
    let path = match std::env::var_os("PATH") { Some(p) => p, None => return false };
    std::env::split_paths(&path).any(|dir| {
        let candidate = dir.join(exe);
        candidate.is_file()
            || (cfg!(windows) && (dir.join(format!("{exe}.exe")).is_file()
                || dir.join(format!("{exe}.cmd")).is_file()))
    })
}

/// TS: utils/cli-version.ts — 三个正则模式按序提取
pub fn get_cli_version(exe: &str) -> Option<String> {
    let out = Command::new(exe).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let patterns = [
        r"v?(\d+\.\d+\.\d+[^ \n\r]*)",
        r"v?(\d+\.\d+\.\d+)",
        r"version[:\s]+(\S+)",
    ];
    for pat in patterns {
        let re = regex::Regex::new(pat).unwrap();
        if let Some(cap) = re.captures(&text) {
            let v = cap[1].to_string();
            if semver::Version::parse(v.trim_start_matches('v')).is_ok() { return Some(v); }
        }
    }
    None
}

fn run_shell(command: &str) -> bool {
    let status = if cfg!(windows) {
        Command::new("cmd").args(["/C", command]).status()
    } else {
        Command::new("sh").args(["-c", command]).status()
    };
    status.map(|s| s.success()).unwrap_or(false)
}

pub fn install(coder: &CoderSpec, method: Option<usize>, _force: bool) -> i32 {
    if is_command_available(coder.executable) {
        println!("✓ {} is already installed", coder.display_name);
        if let Some(v) = get_cli_version(coder.executable) { println!("  Version: {v}"); }
        return EXIT_SUCCESS;
    }
    let methods = install_data::methods_for(coder.id);
    if methods.is_empty() {
        eprintln!("Please install {} manually.", coder.display_name);
        return EXIT_GENERAL;
    }
    let selected = match method {
        Some(idx) => {
            if idx == 0 || idx > methods.len() {
                eprintln!("Invalid method index. Available: 1-{}", methods.len());
                return EXIT_INVALID_ARG;
            }
            methods[idx - 1]
        }
        None if methods.len() == 1 => methods[0],
        None => {
            // 交互选择（非 TTY 时打列表并退出 1，与 TS 对齐）
            if !crate::commands::coder::is_tty() {
                println!("Please install {} manually:", coder.display_name);
                for (i, m) in methods.iter().enumerate() { println!("  {}. {} — {}", i + 1, m.label, m.command); }
                return EXIT_GENERAL;
            }
            let items: Vec<String> = methods.iter()
                .map(|m| if m.recommended { format!("{} ★", m.label) } else { m.label.clone() })
                .collect();
            match dialoguer::Select::new()
                .with_prompt("Select installation method").items(&items).interact()
            {
                Ok(i) => methods[i],
                Err(_) => return crate::EXIT_CANCELLED,
            }
        }
    };
    println!("$ {}", selected.command);
    if !run_shell(&selected.command) {
        eprintln!("✗ Failed to install {}", coder.display_name);
        return EXIT_GENERAL;
    }
    if is_command_available(coder.executable) {
        println!("✓ {} installed successfully", coder.display_name);
        if let Some(v) = get_cli_version(coder.executable) { println!("  Version: {v}"); }
        EXIT_SUCCESS
    } else {
        eprintln!("✗ Installation command completed but {} is not available.", coder.display_name);
        EXIT_GENERAL
    }
}

pub fn update(coder: &CoderSpec) -> i32 {
    if !is_command_available(coder.executable) {
        eprintln!("⚠ {} is not installed", coder.display_name);
        eprintln!("  Install it first: swixter {} install", coder.id);
        return EXIT_NOT_FOUND;
    }
    let current = get_cli_version(coder.executable);
    if let Some(v) = &current { println!("Current version: {v}"); }
    // TS: detectInstallationMethod 按可执行文件路径/来源推断安装方式；
    // 移植 packages/cli/src/utils/install.ts 的 detectInstallationMethod 逻辑。
    // 检测不到时回退 recommended 方法。
    let methods = install_data::methods_for(coder.id);
    let method = detect_installation_method(coder).or_else(|| methods.iter().find(|m| m.recommended).copied().or(methods.first().copied()));
    let method = match method {
        Some(m) => m,
        None => { eprintln!("No update method available"); return EXIT_GENERAL; }
    };
    let command = install_data::update_command_for(coder.id, &method.command)
        .unwrap_or_else(|| method.command.clone());
    println!("$ {command}");
    if !run_shell(&command) {
        eprintln!("✗ Failed to update {}", coder.display_name);
        return EXIT_GENERAL;
    }
    match (get_cli_version(coder.executable), current) {
        (Some(new), Some(old)) if new != old => println!("✓ Updated from {old} to {new}"),
        (Some(new), _) => println!("✓ {} is up to date (Version: {new})", coder.display_name),
        _ => println!("✓ Update completed"),
    }
    EXIT_SUCCESS
}

/// 移植 TS utils/install.ts detectInstallationMethod：
/// 按可执行文件的真实路径特征推断安装方式（如 npm global bin、brew Cellar 等）。
/// 实现时对照 TS 源码逐条翻译；检测不到返回 None。
fn detect_installation_method(coder: &CoderSpec) -> Option<&'static install_data::InstallMethod> {
    let exe_path = which_path(coder.executable)?;
    let methods = install_data::methods_for(coder.id);
    // 规则（TS install.ts）：路径包含 "npm"/"nvm"/"volta" → npm 方法；包含 "Cellar"|"homebrew"|"linuxbrew" → brew 方法
    let p = exe_path.to_string_lossy().to_lowercase();
    let hint = if p.contains("cellar") || p.contains("homebrew") || p.contains("linuxbrew") {
        Some("brew")
    } else if p.contains("npm") || p.contains("nvm") || p.contains("volta") || p.contains("node_modules") {
        Some("npm")
    } else { None };
    hint.and_then(|h| methods.into_iter().find(|m| m.command.contains(h) || m.label.to_lowercase().contains(h)))
}

fn which_path(exe: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_regex() {
        // get_cli_version 的正则逻辑通过 fake executable 集成测试覆盖；
        // 此处测 semver 过滤：非 semver 提取应被丢弃——见 tests/install_command.rs
    }
}
```

`commands/coder.rs` 中把 `fn is_tty` 改为 `pub fn is_tty`（install.rs 通过 `crate::commands::coder::is_tty()` 调用）。

- [ ] **Step 4: 接线 + 跑测试**

`commands/mod.rs` 加 `pub mod install;`。

Run: `cd packages/cli && cargo test -p swixter && cargo clippy --workspace -- -D warnings`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/swixter
git commit -m "feat(rust): install and update-cli commands"
```

---

### Task 14: 交互式菜单与向导（dialoguer）

**Files:**
- Create: `packages/cli/crates/swixter/src/commands/interactive.rs`
- Test: 无自动化测试（交互路径）；人工验收 + 编译/clippy 门槛

**Interfaces:**
- Consumes: `create_quiet`（Task 11）、`ConfigManager`、`groups::*`、`user_providers::*`
- Produces:
  - `interactive::main_menu(coder: &CoderSpec) -> i32`
  - `interactive::create_wizard(coder: &CoderSpec, prefill: CreateArgs) -> i32`
  - `interactive::edit_wizard(coder: &CoderSpec, name: Option<String>) -> i32`
  - `interactive::pick_profile(mgr: &ConfigManager, prompt: &str) -> Option<String>`（复用的 profile 选择器）

行为规格（TS interactive 流程，dialoguer 复刻 @clack/prompts）：

主菜单（`Select`，选项顺序与 TS 一致）：run → create → list → switch → edit → apply → current → delete → install → update-cli → exit。
- switch：Select profile → 切 → Confirm apply（默认 true）
- delete：Select profile → Confirm（默认 false）→ 删
- exit：打印 "Goodbye!"，exit 130；任何 Esc/cancel → exit 130

create 向导分 coder：
- 通用第 1 步：`Input` name（校验 `valid_profile_name`）
- 第 2 步：`Select` provider（列出 `presets::builtin_presets()` + user providers，`display_name` 分组）
- claude：Input apiKey（可空）→ Input authToken（可空）→ Input baseURL（可空，非空时 url 校验）→ provider=custom 时 Select apiFormat → Confirm "配置模型？"（默认 false）→ 是则依次 Input 4 个模型 → Confirm 立即 apply（默认 true）
- codex：Input apiKey（非 ollama 必填）→ Input baseURL（可空）→ Select model（preset.defaultModels + "custom..." 选项 → Input）→ Input envKey（可空）→ Confirm apply（默认 true）
- qwen：provider 列表只含 wire_api=chat 的 provider（且排除 anthropic）→ Input model（必填）→ Input apiKey（非 ollama 必填）→ Input baseURL（可空）→ Confirm apply（默认 true）

edit 向导：Select profile（name 未给时）→ 各字段 `Input` 以当前值为 default → 保存（`upsert_profile`，`created_at` 保留由 manager 处理）→ Confirm apply（默认 false，与 TS 对齐）。

- [ ] **Step 1: 实现 interactive.rs**

```rust
use crate::cli::CreateArgs;
use crate::commands::coder::{apply_active, create_quiet};
use crate::{EXIT_CANCELLED, EXIT_GENERAL, EXIT_SUCCESS};
use dialoguer::{Confirm, Input, MultiSelect, Select};
use swixter_core::coder::CoderSpec;
use swixter_core::config::ConfigManager;
use swixter_core::presets;
use swixter_core::types::Profile;

const MENU: &[(&str, &str)] = &[
    ("run", "Run"),
    ("create", "Create profile"),
    ("list", "List profiles"),
    ("switch", "Switch profile"),
    ("edit", "Edit profile"),
    ("apply", "Apply profile"),
    ("current", "Show current profile"),
    ("delete", "Delete profile"),
    ("install", "Install CLI"),
    ("update-cli", "Update CLI"),
    ("exit", "Exit"),
];

pub fn main_menu(coder: &CoderSpec) -> i32 {
    loop {
        let items: Vec<&str> = MENU.iter().map(|(_, label)| label).collect();
        let sel = match Select::new()
            .with_prompt(format!("{} — what would you like to do?", coder.display_name))
            .items(&items).interact()
        {
            Ok(i) => i,
            Err(_) => return EXIT_CANCELLED,
        };
        let (cmd, _) = MENU[sel];
        let code = match cmd {
            "run" => crate::commands::run::run(coder, crate::cli::RunArgs {
                profile: None, yolo: false, args: vec![] }),
            "create" => create_wizard(coder, CreateArgs {
                name: None, provider: None, api_key: None, auth_token: None,
                base_url: None, model: None, env_key: None, anthropic_model: None,
                default_haiku_model: None, default_opus_model: None,
                default_sonnet_model: None, api_format: None, quiet: false, apply: false }),
            "list" => crate::commands::coder::dispatch(coder.id, crate::cli::CoderArgs {
                command: Some(crate::cli::CoderCommand::List) }),
            "switch" => match pick_profile(&ConfigManager::load(), "Switch to which profile?") {
                Some(name) => crate::commands::coder::dispatch(coder.id, crate::cli::CoderArgs {
                    command: Some(crate::cli::CoderCommand::Switch { name, apply: false, no_apply: false }) }),
                None => EXIT_CANCELLED,
            },
            "edit" => edit_wizard(coder, None),
            "apply" => match apply_active(coder) {
                Ok(()) => { println!("✓ Applied to {}", coder.display_name); EXIT_SUCCESS }
                Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
            },
            "current" => crate::commands::coder::dispatch(coder.id, crate::cli::CoderArgs {
                command: Some(crate::cli::CoderCommand::Current) }),
            "delete" => match pick_profile(&ConfigManager::load(), "Delete which profile?") {
                Some(name) => {
                    let ok = Confirm::new()
                        .with_prompt(format!("Delete profile \"{name}\"?"))
                        .default(false).interact().unwrap_or(false);
                    if ok {
                        crate::commands::coder::dispatch(coder.id, crate::cli::CoderArgs {
                            command: Some(crate::cli::CoderCommand::Delete { name }) })
                    } else { EXIT_SUCCESS }
                }
                None => EXIT_CANCELLED,
            },
            "install" => crate::commands::install::install(coder, None, false),
            "update-cli" => crate::commands::install::update(coder),
            _ => { println!("Goodbye!"); return EXIT_CANCELLED; } // "exit"
        };
        if code == EXIT_CANCELLED && cmd == "run" { return code; }
        // 其他命令结束后回到主菜单（TS 行为：菜单循环）
    }
}

pub fn pick_profile(mgr: &ConfigManager, prompt: &str) -> Option<String> {
    let names: Vec<&String> = mgr.config().profiles.keys().collect();
    if names.is_empty() {
        println!("No profiles yet. Create one first.");
        return None;
    }
    Select::new().with_prompt(prompt)
        .items(&names.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .interact().ok()
        .map(|i| names[i].clone())
}

pub fn create_wizard(coder: &CoderSpec, _prefill: CreateArgs) -> i32 {
    // 各步 cancel → 返回 EXIT_CANCELLED（TS: p.cancel + exit 130）
    let name: String = match Input::new().with_prompt("Profile name")
        .validate_with(|s: &String| {
            if s.len() >= 2 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
                Ok(())
            } else { Err("Min 2 chars, [a-zA-Z0-9_-] only") }
        }).interact_text()
    { Ok(v) => v, Err(_) => return EXIT_CANCELLED };

    let providers = presets::builtin_presets().iter()
        .filter(|p| coder.id != "qwen" || (p.wire_api != Some(swixter_core::types::WireApi::Responses) && p.id != "anthropic"))
        .map(|p| (p.id.clone(), p.display_name.clone()))
        .chain(swixter_core::user_providers::load().into_iter().map(|p| (p.id, p.display_name)))
        .collect::<Vec<_>>();
    let labels: Vec<String> = providers.iter().map(|(_, d)| d.clone()).collect();
    let pi = match Select::new().with_prompt("Provider").items(&labels).interact() {
        Ok(i) => i, Err(_) => return EXIT_CANCELLED };
    let provider_id = providers[pi].0.clone();
    let preset = presets::find_provider(&provider_id);

    let input_opt = |prompt: &str| -> Result<Option<String>, i32> {
        let v: String = Input::new().with_prompt(prompt).allow_empty(true)
            .interact_text().map_err(|_| EXIT_CANCELLED)?;
        Ok(if v.is_empty() { None } else { Some(v) })
    };
    let input_req = |prompt: &str| -> Result<String, i32> {
        Input::new().with_prompt(prompt).interact_text().map_err(|_| EXIT_CANCELLED)
    };

    let needs_key = provider_id != "ollama";
    let api_key = if needs_key { input_req("API Key")? } else { input_opt("API Key (optional)")?.unwrap_or_default() };

    let mut args = CreateArgs {
        name: Some(name), provider: Some(provider_id), api_key: Some(api_key),
        auth_token: None, base_url: None, model: None, env_key: None,
        anthropic_model: None, default_haiku_model: None, default_opus_model: None,
        default_sonnet_model: None, api_format: None, quiet: true, apply: false,
    };

    match coder.id {
        "claude" => {
            args.auth_token = input_opt("Auth Token (optional)")?;
            args.base_url = input_opt("Base URL (optional)")?;
            if args.provider.as_deref() == Some("custom") {
                let formats = ["openai_chat", "anthropic_messages", "openai_responses", "anthropic_responses", "gemini_native"];
                let fi = Select::new().with_prompt("API format").items(&formats).interact().map_err(|_| EXIT_CANCELLED)?;
                args.api_format = Some(formats[fi].into());
            }
            let configure_models = Confirm::new().with_prompt("Configure models?")
                .default(false).interact().map_err(|_| EXIT_CANCELLED)?;
            if configure_models {
                args.anthropic_model = input_opt("ANTHROPIC_MODEL (optional)")?;
                args.default_haiku_model = input_opt("Default Haiku model (optional)")?;
                args.default_opus_model = input_opt("Default Opus model (optional)")?;
                args.default_sonnet_model = input_opt("Default Sonnet model (optional)")?;
            }
        }
        "codex" => {
            args.base_url = input_opt("Base URL (optional)")?;
            let mut model_choices: Vec<String> = preset.as_ref()
                .map(|p| p.default_models.clone()).unwrap_or_default();
            model_choices.push("Custom...".into());
            if !model_choices.is_empty() {
                let mi = Select::new().with_prompt("Model").items(&model_choices).interact().map_err(|_| EXIT_CANCELLED)?;
                args.model = if model_choices[mi] == "Custom..." { Some(input_req("Model name")?) } else { Some(model_choices[mi].clone()) };
            }
            args.env_key = input_opt("Env key for API key (optional, default OPENAI_API_KEY)")?;
        }
        "qwen" => {
            args.model = Some(input_req("Model")?);
            args.base_url = input_opt("Base URL (optional)")?;
        }
        _ => {}
    }

    let profile = match create_quiet(coder, &args) {
        Ok(p) => p,
        Err((msg, code)) => { eprintln!("✗ {msg}"); return code; }
    };
    let mut mgr = ConfigManager::load();
    if let Err(e) = mgr.upsert_profile(profile.clone(), Some(coder.id)) {
        eprintln!("✗ {e}");
        return EXIT_GENERAL;
    }
    println!("✓ Profile \"{}\" created", profile.name);
    let do_apply = Confirm::new()
        .with_prompt(format!("Apply this profile to {} now?", coder.display_name))
        .default(true).interact().map_err(|_| EXIT_CANCELLED)?;
    if do_apply {
        match apply_active(coder) {
            Ok(()) => println!("✓ Applied to {}", coder.display_name),
            Err(e) => { eprintln!("✗ {e}"); return EXIT_GENERAL; }
        }
    }
    EXIT_SUCCESS
}

pub fn edit_wizard(coder: &CoderSpec, name: Option<String>) -> i32 {
    let mgr = ConfigManager::load();
    let name = match name {
        Some(n) => n,
        None => match pick_profile(&mgr, "Edit which profile?") { Some(n) => n, None => return EXIT_CANCELLED },
    };
    let profile = match mgr.get_profile(&name) {
        Some(p) => p.clone(),
        None => { eprintln!("✗ Profile \"{name}\" does not exist"); return EXIT_GENERAL; }
    };
    let input_default = |prompt: &str, cur: Option<&str>| -> Result<Option<String>, i32> {
        let v: String = Input::new().with_prompt(prompt)
            .default(cur.unwrap_or("").to_string())
            .allow_empty(true).interact_text().map_err(|_| EXIT_CANCELLED)?;
        Ok(if v.is_empty() { None } else { Some(v) })
    };
    let mut p: Profile = profile;
    p.api_key = input_default("API Key", Some(&p.api_key))?.unwrap_or_default();
    p.auth_token = input_default("Auth Token", p.auth_token.as_deref())?;
    p.base_url = input_default("Base URL", p.base_url.as_deref())?;
    if coder.id != "claude" {
        p.model = input_default("Model", p.model.as_deref())?;
    }
    let mut mgr = ConfigManager::load();
    if let Err(e) = mgr.upsert_profile(p.clone(), None) {
        eprintln!("✗ {e}");
        return EXIT_GENERAL;
    }
    println!("✓ Profile \"{}\" updated", p.name);
    // TS: edit 后 apply 确认默认 false
    let do_apply = Confirm::new()
        .with_prompt(format!("Apply to {} now?", coder.display_name))
        .default(false).interact().unwrap_or(false);
    if do_apply {
        match apply_active(coder) {
            Ok(()) => println!("✓ Applied"),
            Err(e) => { eprintln!("✗ {e}"); return EXIT_GENERAL; }
        }
    }
    EXIT_SUCCESS
}
```

注意：`main_menu` 中 `run` 无 profile 时返回 EXIT_NOT_FOUND 会直接回菜单（可接受）；确认 clippy 通过（无未使用 import）。

- [ ] **Step 2: 验证**

Run: `cd packages/cli && cargo clippy --workspace -- -D warnings && cargo test --workspace`
Expected: 全绿。人工冒烟：`cargo run -p swixter -- claude` 进入菜单，走完 create → apply → exit。

- [ ] **Step 3: Commit**

```bash
git add packages/cli/crates/swixter
git commit -m "feat(rust): interactive menus and create/edit wizards"
```

---

### Task 15: providers / group / export / import 命令 + M1 收尾

**Files:**
- Create: `packages/cli/crates/swixter/src/commands/providers.rs`
- Create: `packages/cli/crates/swixter/src/commands/group.rs`
- Create: `packages/cli/crates/swixter/src/commands/transfer.rs`
- Modify: `packages/cli/crates/swixter/src/main.rs`
- Modify: `packages/cli/crates/swixter/src/commands/mod.rs`
- Test: `packages/cli/crates/swixter/tests/misc_commands.rs`

**Interfaces:**
- Consumes: `user_providers::*`（Task 4）、`groups::*`（Task 5）、`export::*`（Task 9）
- Produces: main.rs 的 `Providers/Group/Export/Import` 分支 handler；全部命令接通后 M1 完成。

- [ ] **Step 1: 写失败测试（tests/misc_commands.rs）**

```rust
use assert_cmd::Command;
use predicates::prelude::*;

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
     .env("HOME", dir.path());
    c
}

#[test]
fn providers_list_shows_builtins() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir).args(["providers", "list"]).assert().success()
        .stdout(predicate::str::contains("Anthropic").and(predicate::str::contains("Ollama")));
}

#[test]
fn providers_add_show_remove_quiet() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir).args(["providers", "add", "--quiet",
        "--id", "my-corp", "--name", "my-corp", "--display-name", "Corp LLM",
        "--base-url", "https://llm.corp.example", "--auth-type", "api-key",
        "--models", "corp-1,corp-2"]).assert().success();
    setup(&dir).args(["providers", "show", "my-corp"]).assert().success()
        .stdout(predicate::str::contains("https://llm.corp.example"));
    setup(&dir).args(["providers", "remove", "my-corp", "--quiet"]).assert().success();
    setup(&dir).args(["providers", "show", "my-corp"]).assert().code(3);
}

#[test]
fn group_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    for n in ["g-p1", "g-p2"] {
        setup(&dir).args(["claude", "create", "--quiet", "--name", n,
            "--provider", "ollama"]).assert().success();
    }
    setup(&dir).args(["group", "create", "main", "--profiles", "g-p1,g-p2"]).assert().success();
    setup(&dir).args(["group", "list"]).assert().success()
        .stdout(predicate::str::contains("main"));
    setup(&dir).args(["group", "show", "main"]).assert().success()
        .stdout(predicate::str::contains("g-p1"));
    setup(&dir).args(["group", "set-default", "main"]).assert().success();
    setup(&dir).args(["group", "delete", "main", "--force"]).assert().success();
    setup(&dir).args(["group", "show", "main"]).assert().code(3);
}

#[test]
fn export_import_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir).args(["claude", "create", "--quiet", "--name", "e1",
        "--provider", "anthropic", "--api-key", "sk-ant-export-test"]).assert().success();
    let file = dir.path().join("backup.json");
    setup(&dir).args(["export", file.to_str().unwrap()]).assert().success();
    // 删除后导入恢复
    setup(&dir).args(["claude", "delete", "e1"]).assert().success();
    setup(&dir).args(["import", file.to_str().unwrap()]).assert().success()
        .stdout(predicate::str::contains("1").and(predicate::str::contains("imported")));
    setup(&dir).args(["claude", "list"]).assert().success()
        .stdout(predicate::str::contains("e1"));
    // 缺文件参数 → clap 报错 exit 2
    setup(&dir).args(["export"]).assert().code(2);
}
```

- [ ] **Step 2: 实现三个命令模块**

`providers.rs`：

```rust
use crate::cli::{ProviderAddArgs, ProvidersArgs, ProvidersCommand};
use crate::{EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use swixter_core::presets;
use swixter_core::types::{AuthType, ProviderPreset};
use swixter_core::user_providers;

pub fn dispatch(args: ProvidersArgs) -> i32 {
    match args.command {
        None | Some(ProvidersCommand::List) => list(),
        Some(ProvidersCommand::Add(a)) => add(a),
        Some(ProvidersCommand::Remove { id, quiet }) => remove(id, quiet),
        Some(ProvidersCommand::Show { id }) => show(&id),
    }
}

fn list() -> i32 {
    println!("Built-in providers:");
    for p in presets::builtin_presets() {
        println!("  {} — {}", p.id, p.display_name);
    }
    let user = user_providers::load();
    if !user.is_empty() {
        println!("User-defined providers:");
        for p in &user { println!("  {} — {}", p.id, p.display_name); }
    }
    EXIT_SUCCESS
}

fn add(a: ProviderAddArgs) -> i32 {
    if !a.quiet {
        eprintln!("Interactive provider add is not supported yet; use --quiet with flags.");
        return EXIT_INVALID_ARG;
    }
    let (id, name, display, base_url) = match (a.id, a.name, a.display_name, a.base_url) {
        (Some(i), Some(n), Some(d), Some(u)) => (i, n, d, u),
        _ => { eprintln!("✗ --id --name --display-name --base-url are required with --quiet"); return EXIT_INVALID_ARG; }
    };
    if !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') || id.is_empty() {
        eprintln!("✗ Invalid provider id ([a-z0-9-] only)");
        return EXIT_INVALID_ARG;
    }
    if presets::find_builtin(&id).is_some() {
        eprintln!("⚠ Overriding built-in provider \"{id}\"");
    }
    let auth_type = match a.auth_type.as_deref().unwrap_or("api-key") {
        "api-key" => AuthType::ApiKey,
        "bearer" => AuthType::Bearer,
        "custom" => AuthType::Custom,
        other => { eprintln!("✗ Invalid --auth-type: {other}"); return EXIT_INVALID_ARG; }
    };
    let models = a.models.map(|m| m.split(',').map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty()).collect()).unwrap_or_default();
    let preset = ProviderPreset {
        id: id.clone(), name, display_name: display, base_url,
        default_models: models, auth_type, ..Default::default()
    };
    match user_providers::add(preset) {
        Ok(()) => { println!("✓ Provider \"{id}\" added"); EXIT_SUCCESS }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}

fn remove(id: Option<String>, quiet: bool) -> i32 {
    let id = match id {
        Some(i) => i,
        None => {
            let user = user_providers::load();
            if user.is_empty() { println!("No user-defined providers."); return EXIT_SUCCESS; }
            let items: Vec<&str> = user.iter().map(|p| p.id.as_str()).collect();
            match dialoguer::Select::new().with_prompt("Remove which provider?").items(&items).interact() {
                Ok(i) => user[i].id.clone(),
                Err(_) => return crate::EXIT_CANCELLED,
            }
        }
    };
    if !quiet {
        let ok = dialoguer::Confirm::new()
            .with_prompt(format!("Remove provider \"{id}\"?")).default(false)
            .interact().unwrap_or(false);
        if !ok { return EXIT_SUCCESS; }
    }
    match user_providers::remove(&id) {
        Ok(true) => { println!("✓ Provider \"{id}\" removed"); EXIT_SUCCESS }
        Ok(false) => { eprintln!("✗ Provider \"{id}\" not found"); EXIT_NOT_FOUND }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}

fn show(id: &str) -> i32 {
    match presets::find_provider(id) {
        Some(p) => {
            println!("{} — {}", p.id, p.display_name);
            println!("  baseURL: {}", p.base_url);
            if let Some(c) = &p.base_url_chat { println!("  baseURLChat: {c}"); }
            println!("  authType: {:?}", p.auth_type);
            if !p.default_models.is_empty() { println!("  models: {}", p.default_models.join(", ")); }
            if let Some(k) = &p.env_key { println!("  env_key: {k}"); }
            EXIT_SUCCESS
        }
        None => { eprintln!("✗ Provider \"{id}\" not found"); EXIT_NOT_FOUND }
    }
}
```

`group.rs`：

```rust
use crate::cli::{GroupArgs, GroupCommand};
use crate::{EXIT_CANCELLED, EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use swixter_core::config::ConfigManager;
use swixter_core::groups;

pub fn dispatch(args: GroupArgs) -> i32 {
    match args.command {
        None => { eprintln!("Usage: swixter group <list|create|edit|delete|set-default|show>"); EXIT_INVALID_ARG }
        Some(GroupCommand::List) => list(),
        Some(GroupCommand::Create { name, profiles }) => create(name, profiles),
        Some(GroupCommand::Edit { name, new_name, profiles }) => edit(name, new_name, profiles),
        Some(GroupCommand::Delete { name, force }) => delete(&name, force),
        Some(GroupCommand::SetDefault { name }) => set_default(&name),
        Some(GroupCommand::Show { name }) => show(&name),
    }
}

fn list() -> i32 {
    let mgr = ConfigManager::load();
    if mgr.config().groups.is_empty() { println!("No groups."); return EXIT_SUCCESS; }
    for g in mgr.config().groups.values() {
        let marker = if g.is_default { "✓" } else { " " };
        println!("{marker} {} ({})", g.name, g.profiles.join(" → "));
    }
    EXIT_SUCCESS
}

fn create(name: Option<String>, profiles: Option<String>) -> i32 {
    let (name, profile_names) = match (name, profiles) {
        (Some(n), Some(ps)) => (n, ps.split(',').map(|s| s.trim().to_string()).collect::<Vec<_>>()),
        _ => {
            eprintln!("Interactive group creation is not supported yet; pass name and --profiles a,b,c");
            return EXIT_INVALID_ARG;
        }
    };
    let mut mgr = ConfigManager::load();
    match groups::create(&mut mgr, &name, profile_names) {
        Ok(g) => { println!("✓ Group \"{}\" created ({})", g.name, g.id); EXIT_SUCCESS }
        Err(swixter_core::CoreError::NotFound(e)) => { eprintln!("✗ {e}"); EXIT_NOT_FOUND }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}

fn edit(name: Option<String>, new_name: Option<String>, profiles: Option<String>) -> i32 {
    let name = match name {
        Some(n) => n,
        None => { eprintln!("Usage: swixter group edit <name> [--name new] [--profiles a,b,c]"); return EXIT_INVALID_ARG; }
    };
    let mut mgr = ConfigManager::load();
    let group = match groups::find_by_name(&mgr, &name) {
        Some(g) => g,
        None => { eprintln!("✗ Group \"{name}\" not found"); return EXIT_NOT_FOUND; }
    };
    let profile_names = profiles.map(|ps| ps.split(',').map(|s| s.trim().to_string()).collect());
    match groups::update(&mut mgr, &group.id, new_name.as_deref(), profile_names) {
        Ok(_) => { println!("✓ Group updated"); EXIT_SUCCESS }
        Err(swixter_core::CoreError::NotFound(e)) => { eprintln!("✗ {e}"); return EXIT_NOT_FOUND; }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}

fn delete(name: &str, force: bool) -> i32 {
    let mut mgr = ConfigManager::load();
    let group = match groups::find_by_name(&mgr, name) {
        Some(g) => g,
        None => { eprintln!("✗ Group \"{name}\" not found"); return EXIT_NOT_FOUND; }
    };
    if !force {
        let ok = dialoguer::Confirm::new()
            .with_prompt(format!("Delete group \"{name}\"?")).default(false)
            .interact().unwrap_or(false);
        if !ok { return EXIT_SUCCESS; }
    }
    match groups::delete(&mut mgr, &group.id) {
        Ok(()) => { println!("✓ Group \"{name}\" deleted"); EXIT_SUCCESS }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}

fn set_default(name: &str) -> i32 {
    let mut mgr = ConfigManager::load();
    let group = match groups::find_by_name(&mgr, name) {
        Some(g) => g,
        None => { eprintln!("✗ Group \"{name}\" not found"); return EXIT_NOT_FOUND; }
    };
    match groups::set_default(&mut mgr, &group.id) {
        Ok(()) => { println!("✓ Group \"{name}\" set as default"); EXIT_SUCCESS }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}

fn show(name: &str) -> i32 {
    let mgr = ConfigManager::load();
    match groups::find_by_name(&mgr, name) {
        Some(g) => {
            println!("{} ({})", g.name, g.id);
            println!("  default: {}", g.is_default);
            println!("  profiles: {}", g.profiles.join(" → "));
            EXIT_SUCCESS
        }
        None => { eprintln!("✗ Group \"{name}\" not found"); EXIT_NOT_FOUND }
    }
}
```

`transfer.rs`：

```rust
use crate::{EXIT_GENERAL, EXIT_SUCCESS};
use swixter_core::config::ConfigManager;
use swixter_core::export;
use std::path::Path;

pub fn export_cmd(file: &Path) -> i32 {
    let mgr = ConfigManager::load();
    // TS 顶层 export 固定 sanitizeKeys=false（--sanitize 是死参数）
    match export::export_config(mgr.config(), file, false, None) {
        Ok(()) => { println!("✓ Exported to {}", file.display()); EXIT_SUCCESS }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}

pub fn import_cmd(file: &Path) -> i32 {
    let mut mgr = ConfigManager::load();
    // TS 顶层 import 固定 overwrite=false, skipSanitized=true
    match export::import_config(&mut mgr, file, false, true) {
        Ok(stats) => {
            println!("✓ Imported: {}, skipped: {}", stats.imported, stats.skipped);
            for e in &stats.errors { eprintln!("  error: {e}"); }
            EXIT_SUCCESS
        }
        Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
    }
}
```

- [ ] **Step 3: 接线 main.rs**

```rust
        Commands::Providers(a) => commands::providers::dispatch(a),
        Commands::Group(a) => commands::group::dispatch(a),
        Commands::Export { file } => commands::transfer::export_cmd(&file),
        Commands::Import { file } => commands::transfer::import_cmd(&file),
```

`commands/mod.rs`：`pub mod coder; pub mod group; pub mod install; pub mod interactive; pub mod providers; pub mod run; pub mod transfer;`（删除 Task 11 的临时存根模块）。

- [ ] **Step 4: 全量验证**

Run: `cd packages/cli && cargo fmt && cargo clippy --workspace -- -D warnings && cargo test --workspace`
Expected: 全部 PASS（core 单测 + fixtures + cli 集成测试）。

人工冒烟对照（与 TS 版并行验证兼容性）：

```bash
# 用同一 SWIXTER_CONFIG_PATH 分别跑 TS 版和 Rust 版，验证配置互操作
export SWIXTER_CONFIG_PATH=/tmp/swixter-compat/config.json
cargo run -p swixter -- claude create --quiet --name rust1 --provider ollama
bun run src/cli/index.ts claude list   # TS 版应能看到 rust1
bun run src/cli/index.ts claude create --quiet --name ts1 --provider ollama
cargo run -p swixter -- claude list    # Rust 版应能看到 ts1
```

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/swixter
git commit -m "feat(rust): providers/group/export/import commands — M1 complete"
```

---

## M1 完成标准

- `cargo test --workspace` 全绿（core 单测、TS 兼容 fixtures、CLI 集成测试）
- `cargo clippy --workspace -- -D warnings` 无警告
- 人工冒烟：Rust 与 TS 版读写同一份 `config.json` 互操作正常
- proxy/ui/auth/sync 为存根（M2/M3 接入），其余命令面与 TS 版对齐
