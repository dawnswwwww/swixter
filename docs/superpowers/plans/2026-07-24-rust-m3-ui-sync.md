# M3 Web UI 后端 + Auth/Sync/Crypto（Rust server crate）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 实现 swixter M3：新建 `swixter-server` crate（axum Web UI 后端——全部 REST 端点 + `/ws` WebSocket + rust-embed 嵌入 React 构建产物 SPA 静态服务；crypto——PBKDF2/AES-256-GCM 字段级加密，与 TS WebCrypto 逐字节兼容；auth——reqwest 云端认证客户端 + auth.json 管理；sync——status/push/pull 客户端 + 冲突检测 + dirty 流转 + auto-sync），并把 `swixter ui/auth/sync` 三组 CLI 命令接入，替换 M1 的存根。行为逐条对齐 TS 版（`packages/cli/src/{auth,sync,crypto,server}/`、`cli/{auth,sync,ui}.ts`、`utils/daemon.ts`）。React 前端（`packages/cli/ui`）不改动，只接入其构建产物。

**Architecture:** 在现有 Cargo workspace 新增第四个 crate `crates/server`（package `swixter-server`），依赖 `swixter-core`（types/config/presets/user_providers/groups/coder/export）与 `swixter-proxy`（实例 registry/logger/`events::event_bus()` 广播总线——M2 决策点 2 预留的 WS 事件源）。内部分四层：`crypto/`（纯函数，无 async）、`auth/` + `sync/`（reqwest 客户端 + 本地状态文件，async）、`server/`（axum 路由/WS/静态资源，薄层——REST handler 只做「调用 core/proxy 的同步 API + 序列化」，业务断言在 handler 测试中走真实 axum bind）。`swixter` bin 增加 `commands/{ui,auth,sync}.rs`，保持同步 main，三组命令内部按需创建 tokio runtime（与 M2 `commands/proxy.rs` 同模式）。

**Tech Stack:** Rust stable / edition 2021；tokio 1、axum 0.8、reqwest 0.12（rustls-tls, stream, json）、serde_json、bytes、futures、rand 0.8（已有 workspace 依赖）；**新增**：aes-gcm 0.10、pbkdf2 0.12、sha2 0.10、base64 0.22、tokio-tungstenite 0.26（WS 客户端仅 dev/test 用；axum 自带 WS 服务端）、rust-embed 8、open 5（开浏览器）、mime_guess 1（静态资源 Content-Type）；dev: tempfile、assert_cmd。Windows 进程/信号分支沿用 M2 决策点 4 的 `windows-sys` cfg 模式。

**Spec:**
- `docs/superpowers/specs/2026-07-24-m3-sync-ui-facts.md`（M3 行为规格事实表，下称「事实表」，行为规则以它为准）
- `docs/superpowers/specs/2026-07-23-rust-rewrite-design.md`（技术栈映射）
- `docs/superpowers/plans/2026-07-24-rust-m2-proxy.md`（本计划格式与 proxy crate 约定）

## Global Constraints

- **常量（逐字对齐 TS 源码）：**
  - `PBKDF2_ITERATIONS = 100_000`，hash SHA-256，salt **16 字节**（base64 24 字符）；password UTF-8 原始字节 → 派生 AES-256 32 字节 key
  - AES-256-GCM：nonce（IV）**12 字节**随机、auth tag **16 字节**；密文布局 `base64( IV[12] || ciphertext || tag[16] )`；无版本号、无 AAD
  - 字段级加密：只加密 `apiKey`、`authToken`（值为 string 才加密），其余明文
  - `API_BASE = "https://api.swixter.com"`
  - `DEFAULT_UI_PORT = 3141`（被占用起递增找可用端口）；host 固定 `127.0.0.1`
  - magic-link 轮询：`MAGIC_LINK_POLL_INTERVAL_MS = 2000` × `MAGIC_LINK_MAX_ATTEMPTS = 300`
  - token 刷新缓冲：`TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000`（`now >= expiresAt - 5min` 视为过期）
  - UI daemon 健康检查 `GET /api/version` 超时 3s；启动后轮询 200ms×50；`--stop` 等待 100ms×50 后补 SIGKILL
  - proxy 相关常量（UI 的 `/api/proxy/*` 复用）：`DEFAULT_PROXY_PORT = 15721` 起递增、instanceId 固定 `"default"`、type `"service"`
- **文件格式兼容（与 TS 版可交替使用）：**
  - `auth.json`（`config_path()` 同目录）：camelCase、2 空格缩进、Unix 权限 **0o600**；字段 `{accessToken, refreshToken, expiresAt, encryptionSalt, encryptionKey?, authMethod, userId, email}`
  - `config.json` 的 `syncMeta`：`{lastSyncAt, configVersion, providersVersion, localUpdatedAt, dirty?}`——**以 `core::types::SyncMeta`（M1 已有，含 dirty）为准**，事实表 sync/types.ts 那份不带 dirty 的只是客户端 DTO
  - `ui.pid`：`{pid, port, startTime}`，与 `ui.log` 同位于 `config_path()` 目录
- **crypto 与 WebCrypto 逐字节兼容。** aes-gcm crate 的 `Aes256Gcm` + 96-bit nonce 直接对应 WebCrypto AES-GCM（tag 自动附尾）；PBKDF2-HMAC-SHA256 输出取前 32 字节。双向交叉测试向量强制要求（见「测试策略」）。
- **错误格式统一：** REST 错误一律 `{error:{code, message, details?}}`，HTTP 状态码与 facts §REST 逐条一致（400/404/409 等）；auth/sync 云端错误体是 `{code,message}`（注意：比 UI 错误少一层 `error` 包装，解析时区分）。
- **CORS 仅放行本机：** origin 匹配 `http://127.0.0.1:*` / `http://localhost:*` 才回显 `Access-Control-Allow-Origin`；OPTIONS 204 + `Access-Control-Max-Age: 86400`；其余 origin 不带 CORS 头（不报错）。
- **静态资源：** rust-embed 编译期嵌入 `packages/cli/ui/dist`；SPA 模式未命中路径回退 `index.html`；`ui/dist` 不存在时 build.rs 尝试 `cd ui && bun install && bun run build`，失败则编译报错并提示先构建 UI。
- **已知偏差（有意为之）：**
  - TS `server/static.ts` 是死代码（实际用 bun-static.ts 内存版），Rust 不移植，统一 rust-embed。
  - TS MIME 表是手写映射（html/js/mjs/css/json/png/jpg/gif/svg/ico/woff/woff2/ttf/webp/avif）；Rust 用 `mime_guess` 并对该清单做测试断言，行为等价、覆盖面更广。
  - TS `JSON body 仅 POST/PUT/PATCH 且 content-type json 时解析`是 bun 手写中间件的行为；axum 的 `Json<T>` extractor 天然同语义，不单独实现中间件。

## File Structure

```
packages/cli/
├── Cargo.toml                          # workspace 根（追加 aes-gcm/pbkdf2/sha2/base64/tokio-tungstenite/rust-embed/open/mime_guess）
├── scripts/
│   ├── gen-crypto-fixtures.ts          # bun 运行：用 TS WebCrypto 生成交叉测试向量 JSON
│   └── verify-crypto-fixtures.ts       # bun 运行：解密 Rust 生成的向量（反向验证）
├── crates/
│   ├── server/                         # package: swixter-server（新增）
│   │   ├── Cargo.toml
│   │   ├── build.rs                    # ui/dist 缺失时跑 bun build / 给出编译期提示
│   │   ├── src/
│   │   │   ├── lib.rs                  # 模块导出 + ServerError + 全部常量
│   │   │   ├── crypto/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── derive.rs           # PBKDF2-HMAC-SHA256 派生 + salt 生成 + key base64 导入导出
│   │   │   │   ├── encrypt.rs          # AES-256-GCM encrypt/decrypt（IV||ct||tag 布局）
│   │   │   │   └── fields.rs           # encrypt/decryptSensitiveFields（apiKey/authToken）
│   │   │   ├── auth/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── types.rs            # AuthState / AuthApiResponse / 各请求响应 DTO
│   │   │   │   ├── client.rs           # reqwest 认证 API 客户端（base_url 可注入）
│   │   │   │   └── token.rs            # auth.json 读写（0o600）+ getAccessToken 自动刷新
│   │   │   ├── sync/
│   │   │   │   ├── mod.rs
│   │   │   │   ├── types.rs            # SyncStatusEntry / PushRequest / PullResponse / SyncConflict
│   │   │   │   ├── client.rs           # status/push/pull/delete 客户端 + SyncError{status,code,message}
│   │   │   │   ├── merge.rs            # detectConflict
│   │   │   │   ├── flow.rs             # push/pull 完整流程（加密、版本写回、dirty 流转）
│   │   │   │   └── auto_sync.rs        # 进程内开关 + isSyncing 互斥 + load/saveConfigWithSync
│   │   │   ├── server/
│   │   │   │   ├── mod.rs              # start_server / find_available_port / open_browser
│   │   │   │   ├── state.rs            # AppState（config_path 注入、proxy registry、WS 广播）
│   │   │   │   ├── error.rs            # ApiError → {error:{code,message,details?}} IntoResponse
│   │   │   │   ├── util.rs             # maskApiKey/maskAuthToken/sanitizeProfile/ETag
│   │   │   │   ├── cors.rs             # 本机 origin 放行中间件
│   │   │   │   ├── static_files.rs     # rust-embed SPA 服务 + index.html 回退
│   │   │   │   ├── ws.rs               # /ws：连接发 snapshot + 订阅 proxy event_bus 广播
│   │   │   │   └── routes/
│   │   │   │       ├── mod.rs          # Router 组装
│   │   │   │       ├── profiles.rs     # GET/POST /api/profiles, GET/PUT/DELETE /api/profiles/:name
│   │   │   │       ├── providers.rs    # GET/POST /api/providers, PUT/DELETE /api/providers/:id
│   │   │   │       ├── coders.rs       # /api/coders*（active/apply/verify）
│   │   │   │       ├── config.rs       # /api/version, /api/config(+ETag), export/import/reset
│   │   │   │       ├── groups.rs       # /api/groups*（含 PUT /:id/active 广播 group.change）
│   │   │   │       └── proxy.rs        # /api/proxy/status|instances|start|stop|logs
│   │   │   └── daemon.rs               # ui.pid 读写/存活性/健康检查/stop（供 ui 命令）
│   │   └── tests/
│   │       ├── common/mod.rs           # mock 云端 API（axum，可编程 auth/sync 端点 + 请求录制）
│   │       ├── fixtures/
│   │       │   └── crypto_ts_vectors.json   # TS 生成的加密样本（bun 脚本产出，提交入库）
│   │       ├── crypto_cross.rs         # TS→Rust 解密 + Rust→TS 解密（调 bun，无 bun 跳过）
│   │       ├── auth_client.rs          # token 刷新/magic-link 轮询/401 清除 auth.json
│   │       ├── sync_flow.rs            # detectConflict/push/pull/dirty 流转（mock server）
│   │       ├── rest_api.rs             # REST 端点集成测试（隔离 SWIXTER_CONFIG_PATH）
│   │       └── ws.rs                   # tokio-tungstenite 客户端断言 snapshot/广播
│   └── swixter/src/
│       ├── cli.rs                      # Ui/Auth/Sync(StubArgs) → UiArgs/AuthArgs/SyncArgs
│       ├── main.rs                     # 三分支接入 commands::{ui,auth,sync}::dispatch
│       └── commands/
│           ├── ui.rs                   # 前台/--daemon/--stop/--status/--port + 自动开浏览器
│           ├── auth.rs                 # register/login/logout/status/delete-account（dialoguer 交互）
│           └── sync.rs                 # push/pull/status/enable/disable
└── （现有 TS src/ 保留不动，M4 删除；packages/cli/ui 前端不动）
```

## 测试策略

- **crypto 交叉测试向量（Task 1，强制双向）：**
  - TS→Rust：`scripts/gen-crypto-fixtures.ts`（bun 运行）用 TS `deriveKey`+`encrypt` 产出 `tests/fixtures/crypto_ts_vectors.json`——固定 password/salt/key 与多条 plaintext（含中文、空串、长字符串、JSON profile 片段）的 ciphertext。该 fixture **生成一次并提交入库**；Rust 测试逐条 `decrypt` 断言明文相等、`encrypt` 后再 `decrypt` round-trip。
  - Rust→TS：Rust 测试用同一 key 生成向量写临时 JSON，spawn `bun scripts/verify-crypto-fixtures.ts <file>` 用 WebCrypto 解密断言；`bun` 不存在时 `eprintln!` 跳过（本地开发机与 release CI 有 bun，必须跑到）。
  - PBKDF2 派生本身用 RFC 7914 风格的固定向量断言（password+salt → 32 字节 key 的 hex），保证与 WebCrypto 派生一致。
- **auth/sync 客户端（Task 2/3/4）：mock HTTP server。** `tests/common/mod.rs` 用 axum 在 `127.0.0.1:0` 起假云端，可编程 `/api/auth/*` 与 `/api/sync/*` 响应（状态码/body/按请求序号切换响应）并录制请求（Authorization 头、body）。client 的 `base_url` 与状态文件路径均可注入，不依赖真实网络与 `SWIXTER_CONFIG_PATH`。
- **REST 端点（Task 6/7）：axum 集成测试。** 每个测试在 tempfile 临时目录写 config.json/providers.json，构造 `AppState { config_path: Some(tmp) }` + 真实 `axum::serve` bind `127.0.0.1:0`，reqwest 客户端发请求断言状态码与 body。**不用**进程级 `SWIXTER_CONFIG_PATH` 环境变量（并行测试互相污染，与 M2 决策点 7 同理）。
- **WS（Task 7）：** 测试起真实 server，用 tokio-tungstenite 客户端连 `/ws`：断言首条消息是 `snapshot`（内容匹配当前 registry）；随后向 `proxy::events::event_bus()` 注入 `ProxyEvent::{Log, StatusUpdate, InstanceStart, InstanceStop}`，断言客户端收到对应 `{type:"log"|"status"|"instance.start"|"instance.stop"}` 消息；`PUT /api/groups/:id/active` 后断言收到 `group.change`。
- **CLI（Task 8/9）：** 纯函数（端口分配、PID 文件读写、参数校验、掩码）单测 + assert_cmd 跑无网络路径（`sync status` 未登录、`ui --status` 无 daemon、`auth status` 未登录）。

## 已知决策点

1. **auth.json 权限 0o600（Unix）。** 写入用 `OpenOptions::mode(0o600)`；已存在文件权限不符时 `set_permissions(0o600)` 纠正（TS 只在 write 时带 mode，Rust 主动纠正一次，安全等价且更稳）。Windows 无 Unix 权限位，`#[cfg(unix)]` 隔离。
2. **auto-sync enable/disable 仅进程内（与 TS 一致）。** 开关是进程级 `AtomicBool`，默认 false，不落盘；CLI `sync enable/disable` 在当前进程内有效（对一次性 CLI 进程实际是 no-op 提示，与 TS 行为一致——TS 同样不持久化）。文档与 help 文案中明确说明，避免误导。
3. **静态资源 rust-embed 编译期嵌入。** `#[derive(RustEmbed)] #[folder = "../../ui/dist"]`（相对 server crate manifest）。dev 时 rust-embed debug 模式读文件系统，release 嵌入二进制；`ui/dist` 缺失时 build.rs 先尝试 bun build，bun 不可用则 `panic!` 并打印「先运行 cd packages/cli/ui && bun install && bun run build」。
4. **加密 key 缓存策略：进程内。** `OnceLock<Mutex<Option<Aes256GcmKey>>>` 级别的缓存都不做——每次 sync/auth 流程调用 `get_encryption_key()`：auth.json 有 `encryptionKey` 直接导入，否则交互提示 master password 现算。进程即 CLI 单次调用，缓存无意义；Web UI server 进程内 sync 未来如需缓存，在 AppState 加字段即可，本里程碑不做。
5. **token 刷新失败 → 清除 auth.json 返回 None（逐字对齐 TS）。** refresh 请求任何失败（网络/4xx/5xx）都走 `clearAuthState` 语义，不区分原因。
6. **ProxyEvent → WS 消息映射在 server crate 完成。** M2 `events.rs` 总线不动；`ws.rs` 每个连接 `subscribe()`，转 JSON `{type, ...}` 广播。broadcast lagged（消费者落后）时跳过积压消息继续（WS 是实时面板，丢旧日志可接受，与 TS 的 fire-and-forget 语义一致）。
7. **UI daemon 跨平台。** Unix：`libc::kill(pid, 0)` 存活性、SIGTERM/SIGKILL、spawn detached（`pre_exec(setsid)`）；Windows：沿用 M2 决策点 4 的 `OpenProcess`/`TerminateProcess`/`CREATE_NO_WINDOW|DETACHED_PROCESS` cfg 分支。健康检查统一走 HTTP `GET /api/version`（3s 超时），不区分平台。
8. **`/api/proxy/start|stop` 走 proxy crate 的 server/registry API**，不在 server crate 重新实现实例管理；UI 启动的实例固定 `instanceId="default"`、`type="service"`、端口从 15721 起递增（`find_available_port` 逻辑复用 proxy crate 若已导出，否则在 server crate 实现同规则函数）。
9. **交互 prompt 用 dialoguer**（M1 已引入），对齐 TS @clack/prompts 的 email/密码（≥6 注册、≥8 master password）/验证码（6 位数字）/确认选择；master password 与加密设置引导在 login/register 成功后触发。

---

### Task 1: server crate 脚手架 + crypto（含 TS 交叉测试向量）

**Files:**
- Modify: `packages/cli/Cargo.toml`（workspace members + workspace.dependencies）
- Create: `packages/cli/crates/server/Cargo.toml`
- Create: `packages/cli/crates/server/src/lib.rs`
- Create: `packages/cli/crates/server/src/crypto/{mod,derive,encrypt,fields}.rs`
- Create: `packages/cli/scripts/gen-crypto-fixtures.ts`
- Create: `packages/cli/scripts/verify-crypto-fixtures.ts`
- Create: `packages/cli/crates/server/tests/fixtures/crypto_ts_vectors.json`（脚本生成后提交）
- Test: `packages/cli/crates/server/tests/crypto_cross.rs`

**Interfaces:**
- Produces（后续任务依赖）:
  - `crypto::derive::{generate_salt() -> String, derive_key(password: &str, salt_b64: &str) -> [u8; 32], key_to_base64(&[u8;32]) -> String, key_from_base64(&str) -> Result<[u8;32], ServerError>}`
  - `crypto::encrypt::{encrypt(key: &[u8;32], plaintext: &str) -> Result<String, ServerError>, decrypt(key: &[u8;32], ciphertext_b64: &str) -> Result<String, ServerError>}`
  - `crypto::fields::{encrypt_sensitive_fields(key, obj: &serde_json::Value) -> Result<Value, ServerError>, decrypt_sensitive_fields(...)}`（浅拷贝，只处理 string 值的 `apiKey`/`authToken`）
  - `lib.rs` 常量：`PBKDF2_ITERATIONS: u32 = 100_000`、`SALT_LEN: usize = 16`、`NONCE_LEN: usize = 12`、`TAG_LEN: usize = 16`、`API_BASE: &str = "https://api.swixter.com"`、`DEFAULT_UI_PORT: u16 = 3141`、`MAGIC_LINK_POLL_INTERVAL: Duration = 2s`、`MAGIC_LINK_MAX_ATTEMPTS: u32 = 300`、`TOKEN_REFRESH_BUFFER_MS: i64 = 300_000`

- [ ] **Step 1: 写 workspace 与 crate manifest**

`packages/cli/Cargo.toml` 修改：

```toml
[workspace]
members = ["crates/core", "crates/swixter", "crates/proxy", "crates/server"]

[workspace.dependencies]
# ...（M1/M2 已有条目保留，追加：）
aes-gcm = "0.10"
pbkdf2 = "0.12"
sha2 = "0.10"
base64 = "0.22"
tokio-tungstenite = "0.26"
rust-embed = "8"
open = "5"
mime_guess = "2"
```

`packages/cli/crates/server/Cargo.toml`：

```toml
[package]
name = "swixter-server"
version.workspace = true
edition.workspace = true
license.workspace = true
build = "build.rs"

[dependencies]
swixter-core = { path = "../core" }
swixter-proxy = { path = "../proxy" }
tokio.workspace = true
axum.workspace = true
reqwest.workspace = true
bytes.workspace = true
futures.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
time.workspace = true
rand.workspace = true
aes-gcm.workspace = true
pbkdf2.workspace = true
sha2.workspace = true
base64.workspace = true
rust-embed.workspace = true
mime_guess.workspace = true
open.workspace = true

[dev-dependencies]
tokio-tungstenite.workspace = true
tempfile.workspace = true
```

先给非本任务模块建空文件（各含一行注释），保证编译通过。`build.rs` 本任务只放占位（Task 6 实现 dist 检查）。

- [ ] **Step 2: 写失败测试（tests/crypto_cross.rs + derive 内联测试）**

```rust
// tests/crypto_cross.rs
use swixter_server::crypto::{derive::*, encrypt::*};

#[test]
fn pbkdf2_matches_fixed_vector() {
    // 与 WebCrypto PBKDF2-HMAC-SHA256(100k) 对齐的固定向量
    let key = derive_key("correct horse battery staple", "AAECAwQFBgcICQoLDA0ODw==");
    assert_eq!(key_to_base64(&key).len(), 44); // 32 字节 → base64 44 字符
    // hex 断言值由 gen-crypto-fixtures.ts 首次运行时打印后填入（双向锚定）
}

#[test]
fn decrypts_ts_generated_vectors() {
    let raw = include_str!("fixtures/crypto_ts_vectors.json");
    let v: serde_json::Value = serde_json::from_str(raw).unwrap();
    let key = key_from_base64(v["keyBase64"].as_str().unwrap()).unwrap();
    // 派生一致性：TS 端用 password+salt derive，Rust 端重新 derive 必须得到同一 key
    let derived = derive_key(v["password"].as_str().unwrap(), v["saltBase64"].as_str().unwrap());
    assert_eq!(derived, key);
    for case in v["cases"].as_array().unwrap() {
        let pt = case["plaintext"].as_str().unwrap();
        let ct = case["ciphertext"].as_str().unwrap();
        assert_eq!(decrypt(&key, ct).unwrap(), pt, "TS→Rust 解密失败: {ct}");
        // round-trip：Rust 加密 → Rust 解密
        let re = encrypt(&key, pt).unwrap();
        assert_eq!(decrypt(&key, &re).unwrap(), pt);
    }
}

#[test]
fn rust_encrypt_ts_decrypt_cross_check() {
    // 无 bun 环境跳过；有 bun 时 Rust 生成向量 → TS WebCrypto 解密验证
    if std::process::Command::new("bun").arg("--version").output().is_err() {
        eprintln!("skip: bun not available");
        return;
    }
    let raw = include_str!("fixtures/crypto_ts_vectors.json");
    let v: serde_json::Value = serde_json::from_str(raw).unwrap();
    let key = key_from_base64(v["keyBase64"].as_str().unwrap()).unwrap();
    let cases: Vec<_> = v["cases"].as_array().unwrap().iter().map(|c| {
        let pt = c["plaintext"].as_str().unwrap();
        serde_json::json!({"plaintext": pt, "ciphertext": encrypt(&key, pt).unwrap()})
    }).collect();
    let out = serde_json::json!({"keyBase64": v["keyBase64"], "cases": cases});
    let tmp = std::env::temp_dir().join(format!("swixter-rust-vectors-{}.json", std::process::id()));
    std::fs::write(&tmp, serde_json::to_string(&out).unwrap()).unwrap();
    let status = std::process::Command::new("bun")
        .args(["run", concat!(env!("CARGO_MANIFEST_DIR"), "/../../scripts/verify-crypto-fixtures.ts")])
        .arg(&tmp)
        .status().unwrap();
    std::fs::remove_file(&tmp).ok();
    assert!(status.success(), "Rust→TS 解密验证失败");
}
```

`packages/cli/scripts/gen-crypto-fixtures.ts`（bun 运行，输出写入 tests/fixtures/crypto_ts_vectors.json）：

```ts
// 用法: bun run scripts/gen-crypto-fixtures.ts
// 用 TS WebCrypto 实现（src/crypto/）生成 Rust 交叉测试向量
import { deriveKey, exportKeyToBase64 } from "../src/crypto/derive.js";
import { encrypt } from "../src/crypto/encrypt.js";

const password = "test-master-password-🔑";
const saltBase64 = "AAECAwQFBgcICQoLDA0ODw=="; // 固定 salt，向量可复现
const key = await deriveKey(password, saltBase64);
const keyBase64 = await exportKeyToBase64(key);

const plaintexts = [
  "sk-ant-api03-abcdef123456",
  "",                                            // 空串
  "中文密钥-テスト-🔐",                            // 多字节 UTF-8
  "x".repeat(4096),                              // 长字符串
  JSON.stringify({ apiKey: "sk-live-123", baseURL: "https://api.example.com" }),
];

const cases = [];
for (const plaintext of plaintexts) {
  cases.push({ plaintext, ciphertext: await encrypt(key, plaintext) });
}

const out = { password, saltBase64, keyBase64, cases };
await Bun.write(
  new URL("../crates/server/tests/fixtures/crypto_ts_vectors.json", import.meta.url),
  JSON.stringify(out, null, 2)
);
console.log("keyBase64:", keyBase64);
```

`packages/cli/scripts/verify-crypto-fixtures.ts`：

```ts
// 用法: bun run scripts/verify-crypto-fixtures.ts <vectors.json>
// 用 WebCrypto 解密 Rust 生成的向量，全部成功则 exit 0
import { importKeyFromBase64 } from "../src/crypto/derive.js";
import { decrypt } from "../src/crypto/encrypt.js";

const file = process.argv[2];
const v = JSON.parse(await Bun.file(file).text());
const key = await importKeyFromBase64(v.keyBase64);
for (const c of v.cases) {
  const pt = await decrypt(key, c.ciphertext);
  if (pt !== c.plaintext) {
    console.error("mismatch:", { expected: c.plaintext, got: pt });
    process.exit(1);
  }
}
console.log(`OK: ${v.cases.length} vectors decrypted`);
```

Run: `cargo test -p swixter-server`
Expected: FAIL（crypto 模块为空、fixture 不存在）。

- [ ] **Step 3: 实现 crypto 模块并生成 fixture**

`crypto/derive.rs`：

```rust
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use pbkdf2::pbkdf2_hmac;
use rand::RngCore;
use sha2::Sha256;

use crate::{ServerError, PBKDF2_ITERATIONS, SALT_LEN};

/// TS: crypto/derive.ts generateSalt —— 16 字节随机 → base64
pub fn generate_salt() -> String {
    let mut salt = [0u8; SALT_LEN];
    rand::thread_rng().fill_bytes(&mut salt);
    B64.encode(salt)
}

/// TS: deriveKey —— PBKDF2-HMAC-SHA256(password UTF-8, salt, 100_000) → 32 字节 AES key
pub fn derive_key(password: &str, salt_b64: &str) -> [u8; 32] {
    let salt = B64.decode(salt_b64).expect("invalid salt base64");
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(password.as_bytes(), &salt, PBKDF2_ITERATIONS, &mut key);
    key
}

/// TS: exportKeyToBase64
pub fn key_to_base64(key: &[u8; 32]) -> String {
    B64.encode(key)
}

/// TS: importKeyFromBase64（必须恰好 32 字节）
pub fn key_from_base64(key_b64: &str) -> Result<[u8; 32], ServerError> {
    let bytes = B64.decode(key_b64).map_err(|e| ServerError::Crypto(e.to_string()))?;
    <[u8; 32]>::try_from(bytes.as_slice())
        .map_err(|_| ServerError::Crypto("encryption key must be 32 bytes".into()))
}
```

`crypto/encrypt.rs`：

```rust
use aes_gcm::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Aes256Gcm, Key, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};

use crate::ServerError;

/// TS: crypto/encrypt.ts encrypt —— base64( IV[12] || ciphertext || tag[16] )
pub fn encrypt(key: &[u8; 32], plaintext: &str) -> Result<String, ServerError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng); // 96-bit
    let ct = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| ServerError::Crypto(e.to_string()))?;
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ct);
    Ok(B64.encode(combined))
}

/// TS: decrypt —— 前 12 字节 IV，其余 ct+tag
pub fn decrypt(key: &[u8; 32], ciphertext_b64: &str) -> Result<String, ServerError> {
    let combined = B64.decode(ciphertext_b64).map_err(|e| ServerError::Crypto(e.to_string()))?;
    if combined.len() < crate::NONCE_LEN + crate::TAG_LEN {
        return Err(ServerError::Crypto("ciphertext too short".into()));
    }
    let (iv, ct) = combined.split_at(crate::NONCE_LEN);
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let pt = cipher
        .decrypt(Nonce::from_slice(iv), ct)
        .map_err(|e| ServerError::Crypto(e.to_string()))?;
    String::from_utf8(pt).map_err(|e| ServerError::Crypto(e.to_string()))
}
```

`crypto/fields.rs`：

```rust
use serde_json::Value;

use crate::crypto::encrypt::{decrypt, encrypt};
use crate::ServerError;

/// TS: crypto/fields.ts SENSITIVE_FIELDS
pub const SENSITIVE_FIELDS: [&str; 2] = ["apiKey", "authToken"];

/// TS: encryptSensitiveFields —— 浅拷贝，仅 string 值加密
pub fn encrypt_sensitive_fields(key: &[u8; 32], obj: &Value) -> Result<Value, ServerError> {
    let mut result = obj.clone();
    if let Some(map) = result.as_object_mut() {
        for field in SENSITIVE_FIELDS {
            if let Some(Value::String(s)) = map.get(field) {
                let ct = encrypt(key, s)?;
                map.insert(field.to_string(), Value::String(ct));
            }
        }
    }
    Ok(result)
}

/// TS: decryptSensitiveFields
pub fn decrypt_sensitive_fields(key: &[u8; 32], obj: &Value) -> Result<Value, ServerError> {
    let mut result = obj.clone();
    if let Some(map) = result.as_object_mut() {
        for field in SENSITIVE_FIELDS {
            if let Some(Value::String(s)) = map.get(field) {
                let pt = decrypt(key, s)?;
                map.insert(field.to_string(), Value::String(pt));
            }
        }
    }
    Ok(result)
}
```

然后运行 `cd packages/cli && bun run scripts/gen-crypto-fixtures.ts` 生成 fixture，把打印的 keyBase64 对应的 hex 填入 `pbkdf2_matches_fixed_vector` 的断言。

Run: `cargo test -p swixter-server`
Expected: 全部 PASS（含 bun 反向验证）。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/Cargo.toml packages/cli/crates/server packages/cli/scripts
git commit -m "feat(rust): server crate scaffolding + WebCrypto-compatible crypto with cross test vectors"
```

---

### Task 2: auth（reqwest 客户端 + auth.json + token 刷新 + magic-link 轮询）

**Files:**
- Create: `packages/cli/crates/server/src/auth/{mod,types,client,token}.rs`
- Create: `packages/cli/crates/server/tests/common/mod.rs`（mock 云端，Task 3/4 复用）
- Test: `packages/cli/crates/server/tests/auth_client.rs`

**Interfaces:**
- Produces:
  - `auth::types::AuthState`（camelCase，与 auth.json 逐字段一致）、`AuthApiResponse`、`MagicLinkSessionResponse` 等 DTO
  - `auth::client::AuthClient::new(base_url: impl Into<String>) -> Self` + 方法：`send_verification_code(email)`、`verify_and_register(email, code, password, display_name)`、`register_legacy(...)`、`login(email, password)`、`refresh(refresh_token)`、`logout(refresh_token)`、`set_password(password, access_token)`、`delete_account(access_token)`、`send_magic_link(email)`、`verify_magic_link(email, token)`、`check_magic_link_session(session_id)`
  - `auth::token::TokenStore::new(auth_path: PathBuf)`：`load() -> Option<AuthState>`、`save(&AuthState)`（0o600，2 空格缩进）、`clear()`、`get_access_token(&AuthClient) -> Option<String>`（过期自动刷新，失败清除返回 None）
  - `AuthApiError { status: u16, code: String, message: String }`（云端错误体 `{code,message}`）

行为规则（事实表 §2 逐条）：
- `get_access_token`：`now >= expiresAt - 5min` → 调 `refresh`；成功更新 auth.json（保留其余字段）；**任何失败 → clear + None**（决策点 5）。
- magic-link 轮询在 Task 8 CLI 层编排（2s×300、404=session 过期、无 sessionId 手动输 token），client 只提供三个原子调用。
- 全部请求 `Content-Type: application/json`；`set_password`/`delete_account` 带 `Authorization: Bearer`。

- [ ] **Step 1: 写 mock 云端 helper + 失败测试**

`tests/common/mod.rs`：

```rust
use axum::{body::Bytes, extract::State, http::HeaderMap, routing::post, Router};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub authorization: Option<String>,
    pub body: serde_json::Value,
}

/// 可编程 mock：按路径前缀匹配响应队列（每次调用弹一个，空了用最后一个）
pub struct MockCloud {
    pub addr: SocketAddr,
    pub base_url: String,
    pub recorded: Arc<Mutex<Vec<RecordedRequest>>>,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockCloud {
    /// routes: (path, 响应序列[(status, body)])
    pub async fn start(routes: Vec<(&'static str, Vec<(u16, serde_json::Value)>)>) -> Self {
        // 落地要点：State 存 HashMap<String, VecDeque<(u16, Value)>>，
        // handler 按 uri.path() 弹出响应并录制请求；bind 127.0.0.1:0，spawn axum::serve。
        // 形态参照 M2 proxy/tests/common/mod.rs 的 MockUpstream。
        todo!()
    }
}

impl Drop for MockCloud {
    fn drop(&mut self) { let _ = self.shutdown.send(()); }
}
```

`tests/auth_client.rs`：

```rust
mod common;
use common::MockCloud;
use swixter_server::auth::{client::AuthClient, token::TokenStore, types::AuthState};

fn auth_state(expires_at: &str) -> AuthState { /* 构造固定字段的 AuthState */ todo!() }

#[tokio::test]
async fn get_access_token_returns_when_fresh() {
    let dir = tempfile::tempdir().unwrap();
    let store = TokenStore::new(dir.path().join("auth.json"));
    let future = (time::OffsetDateTime::now_utc() + time::Duration::hours(1))
        .format(&time::format_description::well_known::Rfc3339).unwrap();
    store.save(&auth_state(&future)).unwrap();
    let client = AuthClient::new("http://127.0.0.1:1"); // 不可达也没关系，不该发请求
    assert_eq!(store.get_access_token(&client).await.as_deref(), Some("access-0"));
}

#[tokio::test]
async fn get_access_token_refreshes_within_buffer() {
    let mock = MockCloud::start(vec![("/api/auth/refresh", vec![
        (200, serde_json::json!({"accessToken":"access-1","expiresAt":"2999-01-01T00:00:00Z"})),
    ])]).await;
    let dir = tempfile::tempdir().unwrap();
    let store = TokenStore::new(dir.path().join("auth.json"));
    let soon = (time::OffsetDateTime::now_utc() + time::Duration::minutes(4)) // < 5min 缓冲
        .format(&time::format_description::well_known::Rfc3339).unwrap();
    store.save(&auth_state(&soon)).unwrap();
    let client = AuthClient::new(&mock.base_url);
    assert_eq!(store.get_access_token(&client).await.as_deref(), Some("access-1"));
    // 持久化：auth.json 已更新且仍是 0o600
    let saved = store.load().unwrap();
    assert_eq!(saved.access_token, "access-1");
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(std::fs::metadata(dir.path().join("auth.json")).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec[0].path, "/api/auth/refresh");
    assert_eq!(rec[0].body["refreshToken"], "refresh-0");
}

#[tokio::test]
async fn refresh_failure_clears_auth_and_returns_none() {
    let mock = MockCloud::start(vec![("/api/auth/refresh", vec![
        (401, serde_json::json!({"code":"INVALID_REFRESH_TOKEN","message":"expired"})),
    ])]).await;
    let dir = tempfile::tempdir().unwrap();
    let store = TokenStore::new(dir.path().join("auth.json"));
    let past = "2020-01-01T00:00:00Z";
    store.save(&auth_state(past)).unwrap();
    let client = AuthClient::new(&mock.base_url);
    assert!(store.get_access_token(&client).await.is_none());
    assert!(store.load().is_none()); // auth.json 已删除
}

#[tokio::test]
async fn login_and_magic_link_session_polling_contract() {
    let mock = MockCloud::start(vec![
        ("/api/auth/login", vec![(200, serde_json::json!({
            "accessToken":"a","refreshToken":"r","expiresAt":"2999-01-01T00:00:00Z",
            "user":{"id":"u1","email":"e@x.com","displayName":null},
            "encryptionSalt":"AAECAwQFBgcICQoLDA0ODw=="}))]),
        ("/api/auth/magic-link/session/s1", vec![
            (200, serde_json::json!({"status":"pending"})),
            (200, serde_json::json!({"status":"completed","accessToken":"a2","refreshToken":"r2",
                "expiresAt":"2999-01-01T00:00:00Z",
                "user":{"id":"u1","email":"e@x.com","displayName":null},
                "encryptionSalt":"AAECAwQFBgcICQoLDA0ODw==","hasPassword":true})),
        ]),
    ]).await;
    let client = AuthClient::new(&mock.base_url);
    let resp = client.login("e@x.com", "pw123456").await.unwrap();
    assert_eq!(resp.user.id, "u1");
    assert_eq!(client.check_magic_link_session("s1").await.unwrap().status, "pending");
    assert_eq!(client.check_magic_link_session("s1").await.unwrap().status, "completed");
}
```

Run: `cargo test -p swixter-server --test auth_client`
Expected: FAIL。

- [ ] **Step 2: 实现 auth 模块**

`auth/types.rs`（关键 DTO）：

```rust
use serde::{Deserialize, Serialize};

/// TS: auth/types.ts AuthState —— auth.json 序列化逐字段对齐
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub encryption_salt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_key: Option<String>,
    pub auth_method: String,
    pub user_id: String,
    pub email: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthApiResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub user: AuthUser,
    pub encryption_salt: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicLinkSessionResponse {
    pub status: String, // "pending" | "completed"
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub user: Option<AuthUser>,
    pub encryption_salt: Option<String>,
    pub has_password: Option<bool>,
}
// 其余 DTO（RefreshResponse / VerificationCodeResponse / MagicLinkSendResponse /
// MagicLinkVerifyResponse）按 auth/types.ts 逐一补齐，同风格。
```

`auth/token.rs`（核心逻辑）：

```rust
use std::fs;
use std::path::PathBuf;

use crate::auth::client::AuthClient;
use crate::auth::types::AuthState;
use crate::{ServerError, TOKEN_REFRESH_BUFFER_MS};

pub struct TokenStore {
    auth_path: PathBuf,
}

impl TokenStore {
    pub fn new(auth_path: PathBuf) -> Self { Self { auth_path } }

    /// TS: loadAuthState —— 不存在或解析失败返回 None
    pub fn load(&self) -> Option<AuthState> {
        let raw = fs::read_to_string(&self.auth_path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    /// TS: saveAuthState —— 2 空格缩进；Unix 0o600（决策点 1）
    pub fn save(&self, state: &AuthState) -> Result<(), ServerError> {
        if let Some(dir) = self.auth_path.parent() { fs::create_dir_all(dir)?; }
        let json = serde_json::to_string_pretty(state)?;
        #[cfg(unix)] {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            let mut f = fs::OpenOptions::new()
                .write(true).create(true).truncate(true)
                .mode(0o600)
                .open(&self.auth_path)?;
            f.write_all(json.as_bytes())?;
            // 已存在文件 mode 不生效，显式纠正一次
            let mut perm = f.metadata()?.permissions();
            use std::os::unix::fs::PermissionsExt;
            perm.set_mode(0o600);
            fs::set_permissions(&self.auth_path, perm)?;
        }
        #[cfg(not(unix))] {
            fs::write(&self.auth_path, json)?;
        }
        Ok(())
    }

    pub fn clear(&self) {
        let _ = fs::remove_file(&self.auth_path);
    }

    /// TS: getAccessToken —— 5min 缓冲；刷新失败清除并返回 None（决策点 5）
    pub async fn get_access_token(&self, client: &AuthClient) -> Option<String> {
        let mut state = self.load()?;
        let expiry = time::OffsetDateTime::parse(&state.expires_at,
            &time::format_description::well_known::Rfc3339).ok()?;
        let buffer = time::Duration::milliseconds(TOKEN_REFRESH_BUFFER_MS);
        if time::OffsetDateTime::now_utc() < expiry - buffer {
            return Some(state.access_token);
        }
        match client.refresh(&state.refresh_token).await {
            Ok(r) => {
                state.access_token = r.access_token.clone();
                state.expires_at = r.expires_at;
                self.save(&state).ok()?;
                Some(r.access_token)
            }
            Err(_) => {
                self.clear();
                None
            }
        }
    }
}
```

`auth/client.rs`：reqwest 客户端，`base_url.trim_end_matches('/')` 拼接；非 2xx 时解析 `{code,message}` 为 `AuthApiError{status,code,message}`（解析失败 `code="UNKNOWN"`）。方法签名见 Interfaces，逐一对应事实表 §2 的 11 个端点。

- [ ] **Step 3: 跑测试**

Run: `cargo test -p swixter-server --test auth_client`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/server/src/auth packages/cli/crates/server/tests
git commit -m "feat(rust): auth client, auth.json token store with 5min refresh buffer"
```

---

### Task 3: sync 客户端 + detectConflict + push/pull 流程

**Files:**
- Create: `packages/cli/crates/server/src/sync/{mod,types,client,merge,flow}.rs`
- Test: `packages/cli/crates/server/tests/sync_flow.rs`

**Interfaces:**
- Consumes: `crypto::{derive,encrypt,fields}`（Task 1）、`auth::{client::AuthClient, token::TokenStore}`（Task 2）、`swixter_core::{ConfigManager, user_providers}`（M1）
- Produces:
  - `sync::client::SyncClient::new(base_url, access_token)`：`status() -> Vec<SyncStatusEntry>`、`push(PushRequest) -> Result<PushResponse, SyncError>`、`pull(data_key) -> Result<Option<PullResponse>, SyncError>`（404→None）、`delete(data_key: Option<&str>)`
  - `sync::client::SyncError { status: u16, code: String, message: String }`（409 时 `code=="CONFLICT"`）
  - `sync::merge::detect_conflict(local_meta: Option<&SyncMeta>, remote: &[SyncStatusEntry], data_key: &str) -> Option<SyncConflict>`
  - `sync::flow::{push_flow(ctx, force_local: bool), pull_flow(ctx, force_remote: bool)}`，`ctx` 见下

行为规则（事实表 §3 逐条）：
- dataKey 仅 `"config"` / `"providers"`；push 的 `dataVersion` 发**远端当前版本**（无则 0），服务端乐观锁；409 → 调用方提示 `--force-local`。
- push 流程：status → `detect_conflict("config")`（冲突且非 force_local → 返回冲突错误）→ 取加密 key（auth.json `encryptionKey` 优先，否则回调 CLI 层交互提示——flow 接受 `key_provider: &dyn Fn() -> Result<[u8;32], ServerError>` 注入，CLI 层给 dialoguer 实现，测试给固定 key）→ config 逐 profile `encrypt_sensitive_fields` → `{profileId: profile}` JSON push → providers 包 `{providers:[...]}` push → 写回 syncMeta（服务端版本号 + `lastSyncAt`，**不带 dirty 字段即清除**）。
- pull 流程：pull config（404 → 提示先 push）→ 冲突检查（非 force_remote）→ 解密**覆盖写入**同名 profile（本地独有保留）→ pull providers（404 容忍）→ 覆盖写 providers.json → 写回 syncMeta。
- `detectConflict`：local==remote 或任一方为 0 → 无冲突；双方非零且不等 → 冲突。local 版本取 `syncMeta.configVersion/providersVersion`（core `SyncMeta` 已有）。

- [ ] **Step 1: 写失败测试（tests/sync_flow.rs）**

```rust
mod common;
use common::MockCloud;
use swixter_core::types::SyncMeta;
use swixter_server::sync::{merge::*, types::*};

#[test]
fn detect_conflict_matrix() {
    let meta = |cv: u64| SyncMeta { config_version: cv, ..Default::default() };
    let remote = |v: u64| vec![SyncStatusEntry { data_key: "config".into(), data_version: v, updated_at: "t".into() }];
    assert!(detect_conflict(Some(&meta(3)), &remote(3), "config").is_none()); // 相等
    assert!(detect_conflict(Some(&meta(0)), &remote(3), "config").is_none()); // local 0
    assert!(detect_conflict(Some(&meta(3)), &remote(0), "config").is_none()); // remote 0
    assert!(detect_conflict(None, &remote(3), "config").is_none());           // 无 meta
    let c = detect_conflict(Some(&meta(3)), &remote(5), "config").unwrap();
    assert_eq!((c.local_version, c.remote_version), (3, 5));
    // providers 走 providersVersion 字段
    assert!(detect_conflict(Some(&meta(3)), &remote(9), "providers").is_none()); // providersVersion=0
}

#[tokio::test]
async fn push_flow_encrypts_and_writes_back_sync_meta() {
    // mock: status 返回 config v3 / providers v1；push 各返回新版本
    // 临时目录写 config.json（2 个 profile，含 apiKey/authToken）+ providers.json
    // key_provider 返回固定 key；断言：
    // 1. push 请求体 encryptedData 是 base64，解回后 apiKey 是密文（可用 Task1 decrypt 验证）
    // 2. config.json 的 syncMeta = 服务端新版本号，且无 dirty 字段
    todo!()
}

#[tokio::test]
async fn push_flow_conflict_aborts_without_force() {
    // local configVersion=3，remote=5 → 返回冲突错误，不发 push 请求
    todo!()
}

#[tokio::test]
async fn pull_flow_overwrites_same_name_keeps_local_only() {
    // 远端 profile A（加密）覆盖本地 A；本地独有 B 保留；
    // providers 404 容忍；syncMeta 写回远端版本
    todo!()
}
```

Run: `cargo test -p swixter-server --test sync_flow`
Expected: FAIL。

- [ ] **Step 2: 实现 merge.rs + client.rs**

`sync/merge.rs`：

```rust
use swixter_core::types::SyncMeta;

use crate::sync::types::{SyncConflict, SyncStatusEntry};

fn local_version(meta: Option<&SyncMeta>, data_key: &str) -> u64 {
    match (meta, data_key) {
        (Some(m), "config") => m.config_version,
        (Some(m), "providers") => m.providers_version,
        _ => 0,
    }
}

/// TS: sync/merge.ts detectConflict
pub fn detect_conflict(
    local_meta: Option<&SyncMeta>,
    remote_statuses: &[SyncStatusEntry],
    data_key: &str,
) -> Option<SyncConflict> {
    let local = local_version(local_meta, data_key);
    let remote = remote_statuses
        .iter()
        .find(|s| s.data_key == data_key)
        .map(|s| s.data_version)
        .unwrap_or(0);
    if local == remote || local == 0 || remote == 0 {
        return None;
    }
    Some(SyncConflict { local_version: local, remote_version: remote, data_key: data_key.to_string() })
}
```

`sync/client.rs`：`SyncClient` 持 `reqwest::Client` + `base_url` + `access_token`；所有请求 `Authorization: Bearer` + JSON；非 2xx 解析 `{code,message}` → `SyncError`；`pull` 把 404 映射为 `Ok(None)`；DTO 按事实表 §3 表格逐字段 camelCase。

- [ ] **Step 3: 实现 flow.rs**

```rust
use swixter_core::{config::ConfigManager, types::SyncMeta, user_providers};

use crate::crypto::{encrypt::encrypt, fields::*};
use crate::sync::{client::{SyncClient, SyncError}, merge::detect_conflict, types::*};
use crate::ServerError;

pub struct SyncContext<'a> {
    pub client: &'a SyncClient,
    pub config: ConfigManager,          // load_from 注入路径
    pub providers_path: std::path::PathBuf,
    /// 取加密 key 的回调（CLI 层交互提示 / 测试固定 key）
    pub key_provider: &'a dyn Fn() -> Result<[u8; 32], ServerError>,
}

/// TS: cli/sync.ts cmdPush
pub async fn push_flow(ctx: &mut SyncContext<'_>, force_local: bool) -> Result<(), ServerError> {
    let statuses = ctx.client.status().await?;
    let meta = ctx.config.config().sync_meta.clone();
    if !force_local {
        if let Some(c) = detect_conflict(meta.as_ref(), &statuses, "config") {
            return Err(ServerError::SyncConflict(c));
        }
    }
    let key = (ctx.key_provider)()?;

    // config：{profileId: profile}，逐 profile 加密敏感字段
    let mut profiles = serde_json::Map::new();
    for (id, p) in &ctx.config.config().profiles {
        let v = serde_json::to_value(p)?;
        profiles.insert(id.clone(), encrypt_sensitive_fields(&key, &v)?);
    }
    let config_version = remote_version(&statuses, "config");
    let encrypted = encrypt(&key, &serde_json::to_string(&profiles)?)?;
    let resp = ctx.client.push(PushRequest {
        data_key: "config".into(), encrypted_data: encrypt_wrapper(...), data_version: config_version,
        client_timestamp: now_rfc3339(),
    }).await.map_err(conflict_hint)?; // 409 → SyncConflict 错误，提示 --force-local

    // providers：{providers:[...]}，逐 provider 加密
    // ...（同模式，dataKey "providers"）

    // 写回 syncMeta：服务端版本号，不带 dirty（清除）
    let mut cfg = ctx.config.config().clone();
    cfg.sync_meta = Some(SyncMeta {
        last_sync_at: now_rfc3339(),
        config_version: resp.data_version,
        providers_version: /* providers push 的版本 */ 0,
        local_updated_at: now_rfc3339(),
        dirty: None,
    });
    // ... save
    Ok(())
}
```

（`encryptedData` 字段的嵌套——TS 里 push 的是 `{profileId: profile}` 序列化后整体再 encrypt 一次，实施时逐行对照 `cli/sync.ts cmdPush/cmdPull` 校准包裹层次；测试用 Task 1 的 `decrypt` 解断言，保证可还原。）

- [ ] **Step 4: 跑测试 + Commit**

Run: `cargo test -p swixter-server --test sync_flow`
Expected: 全部 PASS。

```bash
git add packages/cli/crates/server/src/sync packages/cli/crates/server/tests/sync_flow.rs
git commit -m "feat(rust): sync client, detectConflict, push/pull flows with field encryption"
```

---

### Task 4: auto-sync（进程内开关 + 包装器）

**Files:**
- Create: `packages/cli/crates/server/src/sync/auto_sync.rs`
- Test: `packages/cli/crates/server/tests/sync_flow.rs`（追加）

**Interfaces:**
- Produces:
  - `auto_sync::{is_enabled() -> bool, set_enabled(bool)}`（进程级 `AtomicBool`，默认 false，不持久化——决策点 2）
  - `auto_sync::sync_push_if_enabled(ctx)` / `sync_pull_if_enabled(ctx)`：未登录或无 `encryptionKey` → 静默跳过；`AtomicBool is_syncing` 互斥（CAS 失败直接返回）；任何 sync 错误吞掉不阻塞（eprintln! 警告即可）
  - `auto_sync::{load_config_with_sync(path), save_config_with_sync(config_mgr)}` 包装器：load 前先 pull、save 先写盘再 push

- [ ] **Step 1: 写失败测试**

```rust
#[tokio::test]
async fn auto_sync_skips_when_disabled_or_no_key() {
    // disabled：mock server 零请求
    // enabled 但 auth.json 无 encryptionKey：零请求（静默跳过）
    todo!()
}

#[tokio::test]
async fn auto_sync_pushes_when_dirty_and_clears_dirty() {
    // enabled + 有 key + syncMeta.dirty=true → 触发 push，成功后 dirty:false 写回
    // （注意：auto-sync push 成功写回 dirty:false，与手动 sync 的「不带 dirty 字段」路径不同——事实表 §3）
    todo!()
}

#[tokio::test]
async fn auto_sync_is_syncing_mutex() {
    // 第一次调用挂起期间第二次调用直接返回（用 mock 延迟响应制造窗口）
    todo!()
}

#[tokio::test]
async fn auto_sync_swallows_errors() {
    // mock 全 500 → load/saveConfigWithSync 正常返回，不传播错误
    todo!()
}
```

- [ ] **Step 2: 实现 auto_sync.rs**

```rust
use std::sync::atomic::{AtomicBool, Ordering};

static ENABLED: AtomicBool = AtomicBool::new(false);
static IS_SYNCING: AtomicBool = AtomicBool::new(false);

/// TS: sync/auto-sync.ts —— 进程内开关，默认 false，无持久化（决策点 2）
pub fn is_enabled() -> bool { ENABLED.load(Ordering::Relaxed) }
pub fn set_enabled(enabled: bool) { ENABLED.store(enabled, Ordering::Relaxed); }

/// TS: auto-sync push 触发条件：dirty || !syncMeta || localVersion !== remoteVersion
/// 前置：已登录且 auth.json 存有 encryptionKey，否则静默跳过；错误吞掉。
pub async fn sync_push_if_enabled(/* ctx 参数同 flow::SyncContext 所需 */) {
    if !is_enabled() { return; }
    if IS_SYNCING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return; // 互斥：进行中直接跳过
    }
    let _guard = scopeguard::guard((), |_| IS_SYNCING.store(false, Ordering::SeqCst));
    // ... 未登录/无 encryptionKey → return；否则 flow::push_flow，错误 eprintln! 吞掉
}
// sync_pull_if_enabled / load_config_with_sync / save_config_with_sync 同模式。
```

（`scopeguard` 若不想加依赖，用结构体 Drop 手写守卫；落地时以不加新依赖为优先。）

- [ ] **Step 3: 跑测试 + Commit**

Run: `cargo test -p swixter-server --test sync_flow`
Expected: 全部 PASS。

```bash
git add packages/cli/crates/server/src/sync/auto_sync.rs packages/cli/crates/server/tests/sync_flow.rs
git commit -m "feat(rust): auto-sync in-process toggle with isSyncing mutex and config wrappers"
```

---

### Task 5: REST —— profiles/providers/coders/config/groups

**Files:**
- Create: `packages/cli/crates/server/src/server/{mod,state,error,util,cors}.rs`
- Create: `packages/cli/crates/server/src/server/routes/{mod,profiles,providers,coders,config,groups}.rs`
- Test: `packages/cli/crates/server/tests/rest_api.rs`

**Interfaces:**
- Produces:
  - `server::state::AppState { config_path: Option<PathBuf> /* 注入，None → core::paths::config_path() */ }`（`Clone`，axum State）
  - `server::error::ApiError { status, code, message, details: Option<Value> }` + `IntoResponse` → `{error:{code,message,details?}}`
  - `server::util::{mask_api_key, mask_auth_token, sanitize_profile, generate_etag(mtime_secs, size) -> String /* "\"<秒>-<size>\"" */, parse_if_none_match}`
  - `server::routes::router(state: AppState) -> Router`（本任务先挂 5 组路由；Task 6 加 proxy/WS/静态）
  - `server::start_server(port: Option<u16>, opts)` / `find_available_port(start: u16)`（3141 起递增 bind 探测）

端点行为（事实表 §REST 逐条，落地时逐行对照 TS `server/api/*.ts`）：
- **Profiles**：`GET /api/profiles`（sanitize 掩码）；`GET /:name`（404 `PROFILE_NOT_FOUND`）；`POST`（缺 name/providerId 400；未知 provider 400 `UNKNOWN_PROVIDER`；重名 409 `PROFILE_EXISTS`；201 返回完整 profile）；`PUT /:name`、`DELETE /:name`。写入走 `ConfigManager::{upsert_profile, delete_profile}`。
- **Providers**：`GET`（presets+user 合并，附 `isUser`）；`POST`（需 id/name/displayName；重复 409）；`PUT/DELETE /:id` 仅 user provider，否则 400 `NOT_USER_PROVIDER`。走 `core::user_providers`。
- **Coders**：`GET /api/coders`（含 activeProfile 摘要）；`GET/PUT /api/coders/:coder/active`；`POST /:coder/apply`（wire_api 兼容性检查，不兼容返回 200 `{success:false,warning:true}`）；`GET /:coder/verify`；未知 coder 404 `UNKNOWN_CODER`。走 `core::coder`/`adapters`。
- **Config**：`GET /api/version` → `{appVersion, configVersion, exportVersion}`（daemon 健康检查用，appVersion 取 `env!("CARGO_PKG_VERSION")`）；`GET /api/config`（ETag `"<mtime秒>-<size>"` + `Cache-Control: no-cache`，If-None-Match 匹配 → 304）；`GET /api/config/export?sanitize=true`（`Content-Disposition: attachment`）；`POST /api/config/import`（body `{config, overwrite?=true}`）；`POST /api/config/reset`。
- **Groups**：`GET /api/groups`（附 profileDetails）、`GET/:id`、`POST`（需 name，201）、`PUT/:id`、`DELETE/:id`、`PUT/:id/active`（本任务先写 config，`group.change` 广播 Task 6 接 WS 后补）。
- 每请求重新加载配置（对齐 M2 约定：改配置即时生效）。

- [ ] **Step 1: 写失败测试（tests/rest_api.rs，选代表性断言）**

```rust
mod common;

async fn spawn_server(dir: &tempfile::TempDir) -> String {
    // 写最小 config.json/providers.json 到 dir；构造 AppState{config_path: Some(...)}
    // axum::serve bind 127.0.0.1:0，返回 base_url
    todo!()
}

#[tokio::test]
async fn profiles_crud_with_masking_and_error_codes() {
    // GET 列表 apiKey 掩码 "sk-a**********1234" 形态；长度≤8 → "****"
    // POST 未知 provider → 400 {error:{code:"UNKNOWN_PROVIDER"}}
    // POST 重名 → 409 PROFILE_EXISTS；GET 不存在 → 404 PROFILE_NOT_FOUND
    todo!()
}

#[tokio::test]
async fn config_etag_roundtrip() {
    // GET /api/config → 200 + ETag "\"<秒>-<size>\""；带 If-None-Match 再 GET → 304
    todo!()
}

#[tokio::test]
async fn providers_user_only_mutation() {
    // PUT /api/providers/<preset-id> → 400 NOT_USER_PROVIDER；user provider 正常
    todo!()
}

#[tokio::test]
async fn coders_apply_wire_api_warning_and_unknown_coder() {
    // 不兼容 apply → 200 {success:false,warning:true}；GET /api/coders/nope/active → 404 UNKNOWN_CODER
    todo!()
}

#[tokio::test]
async fn version_endpoint_for_daemon_healthcheck() {
    // GET /api/version → 200 {appVersion, configVersion, exportVersion}
    todo!()
}
```

掩码纯函数单测（util.rs 内联）：

```rust
#[test]
fn mask_rules_match_ts() {
    assert_eq!(mask_api_key(""), "****");
    assert_eq!(mask_api_key("short123"), "****"); // ≤8
    assert_eq!(mask_api_key("sk-abcdefgh1234"), "sk-a****1234");
    // 星号数量 min(len-8, 20)
    assert_eq!(mask_api_key(&"x".repeat(40)), format!("xxxx{}xxxx", "*".repeat(20)));
}
```

Run: `cargo test -p swixter-server --test rest_api`
Expected: FAIL。

- [ ] **Step 2: 实现 util/error/state/cors + routes**

`server/util.rs`：

```rust
use swixter_core::types::Profile;

/// TS: server/api/util.ts maskApiKey
pub fn mask_api_key(api_key: &str) -> String {
    mask_secret(api_key)
}

pub fn mask_auth_token(token: Option<&str>) -> Option<String> {
    token.map(mask_secret)
}

fn mask_secret(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 8 { return "****".into(); }
    let first: String = chars[..4].iter().collect();
    let last: String = chars[chars.len() - 4..].iter().collect();
    let stars = "*".repeat((chars.len() - 8).min(20));
    format!("{first}{stars}{last}")
}

/// TS: sanitizeProfile —— GET 响应默认掩码（apiKey/authToken 替换为掩码值）
pub fn sanitize_profile(profile: &Profile) -> Profile {
    let mut p = profile.clone();
    p.api_key = mask_api_key(&p.api_key);
    if let Some(t) = &p.auth_token { p.auth_token = Some(mask_secret(t)); }
    p
}

/// TS: generateETag —— "\"<mtime秒>-<size>\""
pub fn generate_etag(mtime_secs: u64, size: u64) -> String {
    format!("\"{mtime_secs}-{size}\"")
}

/// TS: parseIfNoneMatch —— 去引号
pub fn parse_if_none_match(header: &str) -> &str {
    header.trim_matches('"')
}
```

`server/error.rs`：

```rust
use axum::{http::StatusCode, response::{IntoResponse, Response}, Json};

pub struct ApiError {
    pub status: StatusCode,
    pub code: String,
    pub message: String,
    pub details: Option<serde_json::Value>,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &str, message: impl Into<String>) -> Self {
        Self { status, code: code.into(), message: message.into(), details: None }
    }
    pub fn not_found(code: &str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::NOT_FOUND, code, message)
    }
    pub fn conflict(code: &str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message)
    }
    pub fn bad_request(code: &str, message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut err = serde_json::json!({"code": self.code, "message": self.message});
        if let Some(d) = self.details { err["details"] = d; }
        (self.status, Json(serde_json::json!({"error": err}))).into_response()
    }
}
```

`server/cors.rs`（中间件）：

```rust
use axum::{extract::Request, http::{HeaderValue, StatusCode}, middleware::Next, response::Response};

/// 事实表 §中间件：仅放行 http://127.0.0.1:* / http://localhost:*（回显 origin）；
/// OPTIONS 204 + Max-Age 86400；其余 origin 不加 CORS 头
pub async fn cors_middleware(req: Request, next: Next) -> Response {
    let origin = req.headers().get("origin")
        .and_then(|v| v.to_str().ok())
        .filter(|o| o.starts_with("http://127.0.0.1") || o.starts_with("http://localhost"))
        .map(|s| s.to_string());
    let is_options = req.method() == axum::http::Method::OPTIONS;
    let mut resp = if is_options {
        let mut r = Response::new(axum::body::Body::empty());
        *r.status_mut() = StatusCode::NO_CONTENT;
        r
    } else {
        next.run(req).await
    };
    if let Some(o) = origin {
        let h = resp.headers_mut();
        h.insert("access-control-allow-origin", HeaderValue::from_str(&o).unwrap());
        h.insert("access-control-allow-methods", HeaderValue::from_static("GET,POST,PUT,DELETE,PATCH,OPTIONS"));
        h.insert("access-control-allow-headers", HeaderValue::from_static("content-type,authorization"));
        if is_options {
            h.insert("access-control-max-age", HeaderValue::from_static("86400"));
        }
    }
    resp
}
```

`routes/*.rs`：每文件导出 `pub fn routes() -> Router<AppState>`，`routes/mod.rs` 合并。handler 是薄层：`ConfigManager::load_from(state.config_path())` → 调 core API → `Json(...)` / `ApiError`。POST/PUT body 用 `Json<serde_json::Value>` 接（对齐 TS 的动态对象行为，不做严格 schema，未知字段透传）。

- [ ] **Step 3: 跑测试 + Commit**

Run: `cargo test -p swixter-server --test rest_api`
Expected: 全部 PASS。

```bash
git add packages/cli/crates/server/src/server packages/cli/crates/server/tests/rest_api.rs
git commit -m "feat(rust): Web UI REST endpoints for profiles/providers/coders/config/groups"
```

---

### Task 6: proxy 端点 + WebSocket + 静态资源 + build.rs

**Files:**
- Create: `packages/cli/crates/server/src/server/routes/proxy.rs`
- Create: `packages/cli/crates/server/src/server/{ws,static_files}.rs`
- Create: `packages/cli/crates/server/build.rs`
- Test: `packages/cli/crates/server/tests/{rest_api.rs（追加）,ws.rs}`

**Interfaces:**
- Consumes: `swixter_proxy::{registry, logger, events::event_bus, server（start/stop API）}`（M2）
- Produces:
  - `routes/proxy.rs`：`GET /api/proxy/status`、`GET /api/proxy/instances`、`POST /api/proxy/start`（body `{host?,port?}`，instanceId 固定 `"default"`、type `"service"`、端口 15721 起递增）、`POST /api/proxy/stop`（`{instanceId?}`）、`GET /api/proxy/logs?instanceId&lines=N`（N 默认 200 上限 1000，NDJSON 逐行解析，最新在前）
  - `ws::ws_handler`：`GET /ws` upgrade；连接即单发 snapshot；随后把 `event_bus().subscribe()` 的 `ProxyEvent` 转 JSON 广播；`PUT /api/groups/:id/active` 在同一进程内直接往 WS 广播队列发 `group.change`（不走 proxy 总线——group 变更不属于 proxy 事件，见下）
  - `static_files::static_handler`：rust-embed SPA 服务
  - `build.rs`：`ui/dist/index.html` 缺失时尝试 `cd ../../ui && bun install && bun run build`，失败 `panic!` 提示

WS 协议（事实表 §WebSocket 逐条）：
- 纯服务端→客户端；连接即单发：`{type:"snapshot", instances, activeGroupId?, activeGroupName?}`。
- 事件映射：`ProxyEvent::InstanceStart(s)` → `{type:"instance.start", status:s}`；`InstanceStop(id)` → `{type:"instance.stop", instanceId:id}`；`StatusUpdate(s)` → `{type:"status", status:s}`；`Log{instance_id,entry}` → `{type:"log", instanceId, entry}`。
- `group.change`：`PUT /api/groups/:id/active` 成功后发 `{type:"group.change", groupId, groupName}`——AppState 增加 `ws_broadcast: broadcast::Sender<serde_json::Value>`，ws 任务同时 select proxy 总线与该队列（group 事件与 proxy 事件合流后统一发给客户端）。

- [ ] **Step 1: 写失败测试**

`tests/ws.rs`：

```rust
use futures::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

#[tokio::test]
async fn ws_sends_snapshot_then_broadcasts_events() {
    let base = spawn_server_with_default_proxy_instance().await; // registry 预置一个实例
    let (mut socket, _) = tokio_tungstenite::connect_async(format!("{}/ws", base.replace("http", "ws"))).await.unwrap();

    // 首条：snapshot
    let msg = socket.next().await.unwrap().unwrap();
    let snap: serde_json::Value = serde_json::from_str(&msg.into_text().unwrap()).unwrap();
    assert_eq!(snap["type"], "snapshot");
    assert_eq!(snap["instances"].as_array().unwrap().len(), 1);

    // 注入 proxy 事件 → 客户端收到对应广播
    swixter_proxy::events::event_bus().send(swixter_proxy::events::ProxyEvent::Log {
        instance_id: "default".into(),
        entry: serde_json::json!({"ts":"t","level":"info","msg":"hello"}),
    }).ok();
    let msg = socket.next().await.unwrap().unwrap();
    let v: serde_json::Value = serde_json::from_str(&msg.into_text().unwrap()).unwrap();
    assert_eq!(v["type"], "log");
    assert_eq!(v["entry"]["msg"], "hello");
}

#[tokio::test]
async fn group_active_broadcasts_change() {
    // PUT /api/groups/:id/active → WS 客户端收到 {type:"group.change", groupId, groupName}
    todo!()
}
```

`tests/rest_api.rs` 追加：

```rust
#[tokio::test]
async fn proxy_logs_parsed_ndjson_latest_first() {
    // 写 JSONL 日志 → GET /api/proxy/logs?lines=2 → 2 条，最新在前；非法行跳过
    todo!()
}

#[tokio::test]
async fn static_spa_fallback_and_mime() {
    // GET / → 200 text/html；GET /assets/index-xxx.js → application/javascript（存在时）；
    // GET /no/such/route → 200 index.html（SPA 回退）；GET /api/ 前缀不落入静态
    todo!()
}
```

Run: `cargo test -p swixter-server`
Expected: FAIL。

- [ ] **Step 2: 实现 ws.rs / static_files.rs / routes/proxy.rs / build.rs**

`ws.rs`：

```rust
use axum::{extract::{State, WebSocketUpgrade}, response::Response};
use axum::extract::ws::{Message, WebSocket};
use futures::StreamExt;

use crate::server::state::AppState;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    // 1) 连接即单发 snapshot（registry 当前实例 + activeGroup）
    let snapshot = build_snapshot(&state);
    if socket.send(Message::Text(snapshot.to_string().into())).await.is_err() { return; }

    // 2) 合流：proxy event_bus + 进程内 ws_broadcast（group.change），逐条转发
    let mut proxy_rx = swixter_proxy::events::event_bus().subscribe();
    let mut app_rx = state.ws_broadcast.subscribe();
    loop {
        let text = tokio::select! {
            ev = proxy_rx.recv() => match ev {
                Ok(ev) => Some(proxy_event_to_json(ev).to_string()),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue, // 决策点 6
                Err(_) => None,
            },
            v = app_rx.recv() => match v {
                Ok(v) => Some(v.to_string()),
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(_) => None,
            },
        };
        let Some(text) = text else { break };
        if socket.send(Message::Text(text.into())).await.is_err() { break; }
    }
}

fn proxy_event_to_json(ev: swixter_proxy::events::ProxyEvent) -> serde_json::Value {
    use swixter_proxy::events::ProxyEvent as E;
    match ev {
        E::InstanceStart(status) => serde_json::json!({"type":"instance.start","status":status}),
        E::InstanceStop(id) => serde_json::json!({"type":"instance.stop","instanceId":id}),
        E::StatusUpdate(status) => serde_json::json!({"type":"status","status":status}),
        E::Log { instance_id, entry } => serde_json::json!({"type":"log","instanceId":instance_id,"entry":entry}),
    }
}
```

`static_files.rs`：

```rust
use axum::{extract::Path, http::{header, StatusCode}, response::{IntoResponse, Response}};
use rust_embed::RustEmbed;

/// 决策点 3：编译期嵌入 ui/dist
#[derive(RustEmbed)]
#[folder = "../../ui/dist"]
struct UiAssets;

pub async fn static_handler(path: Option<Path<String>>) -> Response {
    let path = path.map(|p| p.0).unwrap_or_default();
    serve_asset(&path)
}

/// SPA：命中返回资源（mime_guess Content-Type），未命中回退 index.html
fn serve_asset(path: &str) -> Response {
    let lookup = if path.is_empty() { "index.html" } else { path.trim_start_matches('/') };
    if let Some(file) = UiAssets::get(lookup) {
        return asset_response(lookup, file.data.into_owned());
    }
    match UiAssets::get("index.html") {
        Some(file) => asset_response("index.html", file.data.into_owned()),
        None => (StatusCode::NOT_FOUND, "ui assets not embedded").into_response(),
    }
}

fn asset_response(path: &str, body: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    ([(header::CONTENT_TYPE, mime.essence_str())], body).into_response()
}
```

`routes/proxy.rs`：handler 调 `swixter_proxy::registry::{list, remove}` 与 proxy server start/stop API；logs 读 `logger` 的日志路径（registry 条目 → 日志文件），逐行 `serde_json::from_str`（坏行跳过），收集后 reverse，取 `lines.min(1000)`（默认 200）。

`build.rs`：

```rust
use std::path::Path;
use std::process::Command;

fn main() {
    let dist = Path::new("../../ui/dist/index.html");
    println!("cargo:rerun-if-changed=../../ui/dist");
    if dist.exists() { return; }
    // 决策点 3：dist 缺失时尝试 bun build
    let ok = Command::new("bun").args(["install"]).current_dir("../../ui").status()
        .map(|s| s.success()).unwrap_or(false)
        && Command::new("bun").args(["run", "build"]).current_dir("../../ui").status()
        .map(|s| s.success()).unwrap_or(false);
    if !ok || !dist.exists() {
        panic!("packages/cli/ui/dist missing and auto-build failed. Run: cd packages/cli/ui && bun install && bun run build");
    }
}
```

- [ ] **Step 3: 跑测试 + Commit**

Run: `cargo test -p swixter-server`
Expected: 全部 PASS（WS/静态/proxy 端点 + 既有测试不回归）。

```bash
git add packages/cli/crates/server
git commit -m "feat(rust): proxy endpoints, /ws broadcast from proxy event bus, embedded SPA static"
```

---

### Task 7: `swixter ui` 命令（daemon PID 管理）

**Files:**
- Create: `packages/cli/crates/server/src/daemon.rs`
- Modify: `packages/cli/crates/swixter/Cargo.toml`（加 swixter-server 依赖）
- Modify: `packages/cli/crates/swixter/src/cli.rs`（`Ui(StubArgs)` → `Ui(UiArgs)`）
- Modify: `packages/cli/crates/swixter/src/main.rs`
- Create: `packages/cli/crates/swixter/src/commands/ui.rs`
- Test: `daemon.rs` 内联单测 + assert_cmd（`ui --status` 无 daemon）

**Interfaces:**
- Consumes: `server::{start_server, find_available_port}`、`core::paths`
- Produces:
  - `daemon.rs`：`UiPidFile { pid: u32, port: u16, start_time: String }`（camelCase）、`{read,write,remove}_pid_file(dir)`、`is_ui_running(dir) -> Option<UiPidFile>`（pid 存活 + `GET /api/version` 3s 200 双重判定）、`stop_daemon(dir) -> Result<String, String>`（SIGTERM → 100ms×50 → SIGKILL → 删 PID）、`cleanup_stale_pid_file(dir)`
  - CLI 表面：`swixter ui [--port <u16>] [--daemon] [--stop] [--status]`（`--no-browser` 可选追加，对齐 TS `noBrowser`）

行为（事实表 §UI 守护进程 + `cli/ui.ts` 逐条）：
- 默认前台：已在运行 → 直接开浏览器；否则 `find_available_port(3141)` → `start_server` → 自动开浏览器（`open` crate；`SWIXTER_UI_DAEMON=1` 抑制——daemon 子进程不开）。
- `--daemon`：已在运行 → 开浏览器返回；否则 spawn 自身 detached（argv 去掉 `--daemon`，stdio → ui.log，env `SWIXTER_UI_DAEMON=1`）+ 立即写 PID + 200ms×50 轮询 `GET /api/version`，超时 SIGTERM。
- `--stop`：读 PID → SIGTERM → 100ms×50 等待 → 仍存活 SIGKILL → 删 PID（跨平台按决策点 7 cfg 分支）。
- `--status`：cleanup stale → 打印 PID/port/uptime/日志路径。

- [ ] **Step 1: 写失败测试（daemon.rs 内联 + assert_cmd）**

```rust
#[test]
fn pid_file_roundtrip_and_stale_cleanup() {
    let dir = tempfile::tempdir().unwrap();
    write_pid_file(dir.path(), &UiPidFile { pid: std::process::id(), port: 3141, start_time: "2026-07-24T00:00:00Z".into() }).unwrap();
    let pf = read_pid_file(dir.path()).unwrap().unwrap();
    assert_eq!(pf.port, 3141);
    // 大数值 pid（不存在）→ 判死并清理
    write_pid_file(dir.path(), &UiPidFile { pid: 4_000_000, port: 3141, start_time: "t".into() }).unwrap();
    cleanup_stale_pid_file(dir.path());
    assert!(read_pid_file(dir.path()).unwrap().is_none());
}
```

assert_cmd：`swixter ui --status`（隔离 HOME/SWIXTER_CONFIG_PATH 临时目录）→ 输出「未运行」语义且 exit 0。

Run: `cargo test -p swixter`
Expected: FAIL。

- [ ] **Step 2: 实现 daemon.rs + commands/ui.rs**

`daemon.rs`（核心片段）：

```rust
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPidFile {
    pub pid: u32,
    pub port: u16,
    pub start_time: String,
}

pub fn pid_file_path(config_dir: &Path) -> PathBuf { config_dir.join("ui.pid") }
pub fn log_file_path(config_dir: &Path) -> PathBuf { config_dir.join("ui.log") }

pub fn pid_alive(pid: u32) -> bool {
    #[cfg(unix)] { unsafe { libc::kill(pid as i32, 0) == 0 } }
    #[cfg(windows)] { /* M2 决策点 4：OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION) */ todo!() }
}

/// 健康检查：GET /api/version 3s 200（决策点 7，跨平台统一 HTTP）
pub async fn health_check(port: u16) -> bool {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(3)).build().unwrap();
    client.get(format!("http://127.0.0.1:{port}/api/version"))
        .send().await.map(|r| r.status().is_success()).unwrap_or(false)
}

/// TS: utils/daemon.ts isSwixterUiRunning —— pid 存活 + 健康检查双重判定
pub async fn is_ui_running(config_dir: &Path) -> Option<UiPidFile> {
    let pf = read_pid_file(config_dir).ok()??;
    if !pid_alive(pf.pid) { return None; }
    if !health_check(pf.port).await { return None; }
    Some(pf)
}

/// TS: stopDaemon —— SIGTERM → 100ms×50 → SIGKILL → 删 PID
pub async fn stop_daemon(config_dir: &Path) -> Result<String, String> {
    let pf = read_pid_file(config_dir).map_err(|e| e.to_string())?
        .ok_or_else(|| "UI daemon is not running".to_string())?;
    terminate(pf.pid, /* graceful */ true);
    for _ in 0..50 {
        if !pid_alive(pf.pid) { break; }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if pid_alive(pf.pid) { terminate(pf.pid, /* graceful */ false); }
    remove_pid_file(config_dir).ok();
    Ok(format!("UI daemon stopped (pid {})", pf.pid))
}
// terminate(): Unix SIGTERM/SIGKILL；Windows TerminateProcess（cfg 分支）
```

`commands/ui.rs`：

```rust
pub fn dispatch(args: UiArgs) -> i32 {
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(async move {
        if args.stop { return stop().await; }
        if args.status { return status().await; }
        if args.daemon { return start_daemon(args.port).await; }
        run_foreground(args.port, args.no_browser).await
    })
}

async fn run_foreground(port: Option<u16>, no_browser: bool) -> i32 {
    let dir = config_dir();
    if let Some(pf) = swixter_server::daemon::is_ui_running(&dir).await {
        open_browser(pf.port); // 已在运行 → 直接开浏览器
        return 0;
    }
    let port = swixter_server::find_available_port(port.unwrap_or(swixter_server::DEFAULT_UI_PORT)).await;
    let url = format!("http://127.0.0.1:{port}");
    if !no_browser && std::env::var("SWIXTER_UI_DAEMON").is_err() {
        let _ = open::that_detached(&url); // daemon 子进程不开浏览器
    }
    // start_server 阻塞至 ctrl-c
    swixter_server::start_server(port, Default::default()).await;
    0
}
// start_daemon: spawn 自身（去 --daemon，stdio→ui.log，env SWIXTER_UI_DAEMON=1）detached
//   → 写 PID → 200ms×50 轮询健康检查，超时 SIGTERM 报错。
```

- [ ] **Step 3: 跑测试 + 手工冒烟 + Commit**

Run: `cargo test -p swixter`；另手工 `cargo run -p swixter -- ui --port 0`（或临时高端口）确认 server 起、`GET /api/version` 200、`ui --status`/`--stop` 正常。
Expected: PASS。

```bash
git add packages/cli/crates/server/src/daemon.rs packages/cli/crates/swixter
git commit -m "feat(rust): swixter ui command with daemon pid management"
```

---

### Task 8: `swixter auth` 命令

**Files:**
- Modify: `packages/cli/crates/swixter/src/cli.rs`（`Auth(StubArgs)` → `Auth(AuthArgs)`）
- Modify: `packages/cli/crates/swixter/src/main.rs`
- Create: `packages/cli/crates/swixter/src/commands/auth.rs`
- Test: assert_cmd（`auth status` 未登录）+ 交互函数以回调注入便于单测

**Interfaces:**
- Consumes: `server::auth::{client::AuthClient, token::TokenStore}`、`server::crypto::derive`、`core::ConfigManager::clear_sync_meta`
- CLI 表面（对齐 TS `cli/auth.ts`）：
  - `swixter auth register`（email → send-code → 6 位验证码 → 密码 ≥6 → displayName 可选 → verify）
  - `swixter auth login [--magic-link]`（默认密码登录；`--magic-link` 走 send → 有 sessionId 轮询 2s×300 / 无则手动输 token；404=session 过期）
  - `swixter auth logout`（调云端 logout → clear auth.json → `clear_sync_meta()`）
  - `swixter auth status`（登录态 + email/userId/authMethod）
  - `swixter auth delete-account`（确认 → DELETE → clear auth.json + `clear_sync_meta()`）

行为要点（TS `cli/auth.ts` 逐条）：
- 登录/注册成功后：写 auth.json（`authMethod` 记录 password/magic-link）→ 引导设 master password（≥8，dialoguer 密码二次确认）→ `derive_key` → 询问是否保存 `encryptionKey`（供 auto-sync 免密）。
- 换账号登录（已登录且 email 不同）：清 syncMeta 并提示 pull/push/skip 选择。
- magic-link 完成且无 `hasPassword` → 提示 `set-password` 引导。

- [ ] **Step 1: 写失败测试（无网络路径 + 加密设置引导纯逻辑）**

```rust
#[test]
fn auth_status_not_logged_in() {
    // assert_cmd，隔离 HOME/SWIXTER_CONFIG_PATH → 输出未登录提示，exit 0
}

#[test]
fn encryption_setup_derives_and_optionally_stores_key() {
    // 注入固定 password/salt：derive 结果 == Task 1 固定向量 key；
    // 选择保存 → auth.json 带 encryptionKey；不保存 → 无该字段
}
```

Run: `cargo test -p swixter auth`
Expected: FAIL。

- [ ] **Step 2: 实现 commands/auth.rs**

```rust
pub fn dispatch(args: AuthArgs) -> i32 {
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(async move {
        let client = AuthClient::new(swixter_server::API_BASE);
        let store = TokenStore::new(auth_path());
        match args.command {
            AuthCommand::Register => register(&client, &store).await,
            AuthCommand::Login { magic_link } => login(&client, &store, magic_link).await,
            AuthCommand::Logout => logout(&client, &store).await,
            AuthCommand::Status => status(&store).await,
            AuthCommand::DeleteAccount => delete_account(&client, &store).await,
        }
    })
}

async fn login(client: &AuthClient, store: &TokenStore, magic_link: bool) -> i32 {
    let email = prompt_email(); // dialoguer::Input，含 @ 校验
    let resp = if magic_link {
        magic_link_flow(client, &email).await // send → 轮询 2s×300 / 手动 token；404=过期
    } else {
        let password = dialoguer::Password::new().with_prompt("Password").interact().unwrap();
        client.login(&email, &password).await
    };
    let resp = match resp { Ok(r) => r, Err(e) => { eprintln!("Login failed: {e}"); return 1; } };

    // 换账号：清 syncMeta 并提示 pull/push/skip
    if let Some(old) = store.load() {
        if old.email != resp.user.email {
            ConfigManager::load().clear_sync_meta().ok();
            // dialoguer::Select: pull / push / skip
        }
    }
    let state = AuthState {
        access_token: resp.access_token, refresh_token: resp.refresh_token,
        expires_at: resp.expires_at, encryption_salt: resp.encryption_salt,
        encryption_key: None, auth_method: if magic_link { "magic-link".into() } else { "password".into() },
        user_id: resp.user.id, email: resp.user.email,
    };
    if let Err(e) = store.save(&state) { eprintln!("{e}"); return 1; }
    encryption_setup_prompt(store); // master password ≥8 → derive → 询问保存 encryptionKey
    0
}
```

（magic_link_flow 轮询实现：`tokio::time::sleep(MAGIC_LINK_POLL_INTERVAL)` × `MAGIC_LINK_MAX_ATTEMPTS`；`completed` → 组装 AuthApiResponse 等价物；`pending` 继续；404 → session 过期报错返回；超时 → 报错。）

- [ ] **Step 3: 跑测试 + Commit**

Run: `cargo test -p swixter auth`
Expected: PASS。

```bash
git add packages/cli/crates/swixter
git commit -m "feat(rust): swixter auth commands with magic-link polling and encryption setup"
```

---

### Task 9: `swixter sync` 命令 + 收尾接线

**Files:**
- Modify: `packages/cli/crates/swixter/src/cli.rs`（`Sync(StubArgs)` → `Sync(SyncArgs)`）
- Modify: `packages/cli/crates/swixter/src/main.rs`
- Create: `packages/cli/crates/swixter/src/commands/sync.rs`
- Test: assert_cmd（未登录 `sync status` → 提示先登录 exit 1）+ flow 层已在 Task 3 覆盖

**Interfaces:**
- CLI 表面（对齐 TS `cli/sync.ts`）：
  - `swixter sync status`（本地 syncMeta + 远端 status 表格）
  - `swixter sync push [--force-local]`
  - `swixter sync pull [--force-remote]`
  - `swixter sync enable` / `swixter sync disable`（进程内开关，help 文案注明不持久化——决策点 2）
- 编排：`require_auth`（`get_access_token` → None 则提示 `swixter auth login` 先登录，exit 1）→ 构造 `SyncClient` + `SyncContext`（`key_provider` 闭包：auth.json 有 `encryptionKey` 直接 `key_from_base64`，否则 dialoguer 密码 + `derive_key`）→ 调 `flow::{push_flow, pull_flow}` → 冲突错误打印 `--force-local/--force-remote` 提示。

- [ ] **Step 1: 写失败测试**

```rust
#[test]
fn sync_status_requires_login() {
    // assert_cmd，隔离环境无 auth.json → 输出 "Not logged in" + exit 1
}

#[test]
fn sync_enable_disable_prints_in_process_notice() {
    // exit 0，输出注明「仅当前进程有效，不持久化」
}
```

Run: `cargo test -p swixter sync`
Expected: FAIL。

- [ ] **Step 2: 实现 commands/sync.rs + main.rs/cli.rs 接线**

```rust
pub fn dispatch(args: SyncArgs) -> i32 {
    let rt = tokio::runtime::Runtime::new().expect("tokio runtime");
    rt.block_on(async move {
        match args.command {
            SyncCommand::Enable => { auto_sync::set_enabled(true); println!("Auto-sync enabled (current process only, not persisted)"); 0 }
            SyncCommand::Disable => { auto_sync::set_enabled(false); println!("Auto-sync disabled"); 0 }
            SyncCommand::Status => status().await,
            SyncCommand::Push { force_local } => push(force_local).await,
            SyncCommand::Pull { force_remote } => pull(force_remote).await,
        }
    })
}

async fn require_auth() -> Option<(SyncClient, TokenStore)> {
    let store = TokenStore::new(auth_path());
    let auth = AuthClient::new(swixter_server::API_BASE);
    let token = store.get_access_token(&auth).await;
    token.map(|t| (SyncClient::new(swixter_server::API_BASE, t), store))
    // None → 打印 "Not logged in. Run 'swixter auth login' first"，调用方 exit 1
}
```

`cli.rs` 定义 `UiArgs/AuthArgs/SyncArgs` 三个 clap 结构（替换 `StubArgs` 的三处使用）；`main.rs` 三个分支改调 `commands::{ui,auth,sync}::dispatch` 并以其返回值作 exit code。删除 `[M3]` 存根注释与 `StubArgs`（如无其他使用者）。

- [ ] **Step 3: 全量回归 + Commit**

Run: `cd packages/cli && cargo test --workspace && cargo clippy --workspace -- -D warnings`
Expected: 全 PASS、无 clippy 告警。

```bash
git add packages/cli/crates/swixter packages/cli/Cargo.toml
git commit -m "feat(rust): swixter sync commands; M3 CLI wiring complete"
```

---

## M3 完成标准

1. `cargo test --workspace` 全绿，含：crypto 双向交叉向量（TS→Rust fixture 解密 + Rust→TS bun 验证）、auth/sync mock server 测试、REST 集成测试、WS snapshot/广播测试、CLI assert_cmd 测试；`cargo clippy --workspace -- -D warnings` 无告警。
2. **加密互操作**：TS 版加密过的 apiKey/authToken，Rust 版能解密（反之亦然）；PBKDF2 派生 key 与 WebCrypto 逐字节一致（固定向量锚定）。
3. `swixter ui` 前台/daemon/--stop/--status 全流程可用：浏览器自动打开、React SPA 加载、REST 全端点与 TS 版响应格式一致（错误 `{error:{code,message,details?}}`、掩码、ETag/304、CORS 仅本机）、`/ws` snapshot + proxy 事件/group.change 实时推送。
4. `swixter auth register/login/logout/status/delete-account` 全流程可用（含 magic-link 轮询、token 5min 缓冲自动刷新、刷新失败清除 auth.json、auth.json 恒为 0o600）。
5. `swixter sync push/pull/status/enable/disable` 全流程可用：冲突检测与 `--force-local/--force-remote`、字段级加密上传、syncMeta/dirty 流转与 TS 版语义一致、auto-sync 进程内开关。
6. 文件格式与 TS 版可交替使用：auth.json、config.json（syncMeta）、ui.pid 逐字段 camelCase 兼容。
7. UI daemon 与 server 在 macOS/Linux/Windows 三平台编译（CI 矩阵），Unix 专属代码（0o600、信号）全部 `#[cfg]` 隔离。
