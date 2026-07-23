# M2 本地代理（Rust proxy crate）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Rust 实现 swixter 本地代理：新建 `swixter-proxy` crate（axum HTTP server + reqwest forwarder + 熔断器 + Anthropic↔OpenAI 双向协议转换含 SSE 流式 + group 故障转移 + 实例注册表 + JSONL 日志），并把 `swixter proxy start/stop/status/run` 四个 CLI 命令接入，替换 M1 的存根。行为逐条对齐 TS 版（`packages/cli/src/proxy/`、`cli/proxy.ts`）。

**Architecture:** 在现有 Cargo workspace 新增第三个 crate `crates/proxy`（package `swixter-proxy`），依赖 `swixter-core`（复用 `types::Profile/Group/ProviderPreset/ApiFormat`、`ConfigManager`、`groups::find_by_name`、`presets::find_provider`）。核心请求处理逻辑（`ProxyHandler`）设计为框架无关（输入 method/path/headers/bytes，输出 status/headers/body stream），axum 仅作薄适配层，使 handler/failover 可不起 HTTP server 直接单测。`swixter` bin 增加 `commands/proxy.rs`，仍保持同步 main，proxy 命令内部按需创建 tokio runtime。

**Tech Stack:** Rust stable / edition 2021；tokio 1（rt-multi-thread, macros, time, sync, process, signal）、axum 0.8、reqwest 0.12（rustls-tls, stream）、bytes、futures、serde_json、dashmap、libc（unix）；dev: tempfile、assert_cmd。

**Spec:**
- `docs/superpowers/specs/2026-07-24-m2-proxy-facts.md`（M2 行为规格事实表，下称「事实表」，字段映射规则以它为准）
- `docs/superpowers/specs/2026-07-23-rust-rewrite-design.md`（技术栈映射）

## Global Constraints

- **常量（逐字对齐 TS `constants/proxy.ts` 与 proxy 源码）：**
  - `FAILURE_THRESHOLD = 3`、`RECOVERY_TIMEOUT_MS = 60000`（熔断器）
  - 默认超时 `3000000` ms（50 分钟，长流式有意为之）；reqwest 默认无总超时，**必须逐请求显式设置**
  - `DEFAULT_PROXY_PORT = 15721`、`DEFAULT_PROXY_HOST = "127.0.0.1"`
  - `SWIXTER_PROXY_AUTH_TOKEN = "swixter-local-proxy"`（除 `/health` 外所有端点要求 `Authorization: Bearer <token>`）
  - model marker：`SWIXTER_CLAUDE_MODEL` / `SWIXTER_CLAUDE_HAIKU_MODEL` / `SWIXTER_CLAUDE_SONNET_MODEL` / `SWIXTER_CLAUDE_OPUS_MODEL`
  - 日志滚动阈值 `100 * 1024 * 1024` 字节，单代滚动 `<log>.1`
- **文件格式兼容（与 TS 版可交替使用）：** `proxy-instances.json` 字段 camelCase、2 空格缩进，与 TS `ProxyStatus` 逐字段一致；旧格式 `proxy-runtime.json` 一次性迁移；JSONL 日志字段 `{ts,level,msg|method,path,status,durationMs,instanceId,...}` 一致；文件均位于 `paths::config_path()` 同目录。
- **容错语义对齐 TS：** SSE `data:` JSON 解析失败**丢弃该事件**；请求/响应 transform 抛错**回退原始透传**；model 改写 JSON 解析失败回退原样；日志写失败静默。
- **body 一律用 `serde_json::Value` 处理**（对齐 TS 的动态对象行为），未知字段透传，禁止 `deny_unknown_fields`。
- `swixter-core` **不新增 tokio/async 依赖**；全部 async 代码在 `swixter-proxy`。core 唯一允许的改动是 Task 10 给 `model.rs` 追加 `build_claude_proxy_marker_models`（同步纯函数）。
- 每个请求重新加载配置（`ConfigManager::load()` 或从注入路径 load），对齐 TS `getProfile/getGroup` 每请求读文件的行为，使运行中改配置即时生效。
- **已知偏差（有意为之）：**
  - `proxy stop` 对 daemon 进程按 registry 中 pid 发信号 kill（TS 现状只删 registry 条目不 kill，见「已知决策点」）。
  - TS `forwardToProvider(req, "chat"|"anthropic")` 的 format 参数是死代码（`forwardSingleProfile` 中形参为 `_format`，未被使用），Rust 不保留该参数。
  - TS `rewriteRequestBodyForProfile` 检查 `"cannot resolve requested proxy model marker"` 错误并 rethrow，但当前 `model-helper.ts` 的 `resolveSwixterClaudeProxyMarker` 从不抛该错误（死分支）；Rust 版 marker 解析失败统一回退原样透传。
  - `proxy run` 复用已有实例时，coder 退出**不**停掉被复用的实例（TS 会无差别 `stopProxyServer("run-<port>")`，Rust 只停自己创建的实例）。

## File Structure

```
packages/cli/
├── Cargo.toml                          # workspace 根（追加 tokio/axum/reqwest/bytes/futures/dashmap/libc）
├── crates/
│   ├── core/                           # 仅 Task 10 在 model.rs 追加一个函数
│   ├── proxy/                          # package: swixter-proxy（新增）
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   ├── lib.rs                  # 模块导出 + ProxyError + 全部常量
│   │   │   ├── types.rs                # ProxyStatus / InstanceKind / ProxyServerConfig
│   │   │   ├── sse.rs                  # SSE 解析/序列化/跨 chunk 缓冲（复刻 TS 容错规则）
│   │   │   ├── breaker.rs              # 熔断器（惰性时间戳，无定时任务）
│   │   │   ├── forwarder.rs            # reqwest 转发（URL 拼接/header 过滤/凭据注入/流式检测）
│   │   │   ├── transform/
│   │   │   │   ├── mod.rs              # 格式推断 + 转换器 registry + 三个入口函数
│   │   │   │   ├── request.rs          # anthropic→openai_chat、openai_responses→openai_chat
│   │   │   │   ├── response.rs         # openai_chat→anthropic、openai_chat→openai_responses
│   │   │   │   └── streaming.rs        # 两个 SSE 流式转换器（状态机）
│   │   │   ├── model.rs                # marker 解析 + general model 强制覆盖
│   │   │   ├── handler.rs              # 鉴权 + 单 profile + group 故障转移（框架无关）
│   │   │   ├── server.rs               # axum 路由 + 实例生命周期（in-process map + registry）
│   │   │   ├── registry.rs             # proxy-instances.json 读写 + pid 存活性 + 旧格式迁移
│   │   │   ├── logger.rs               # JSONL 日志 + 100MB 单代滚动
│   │   │   └── events.rs               # tokio::sync::broadcast 事件总线占位（M3 订阅）
│   │   └── tests/
│   │       ├── common/mod.rs           # mock upstream（axum 假 provider + 请求录制）
│   │       ├── fixtures/               # 手写请求/响应 JSON + SSE 事件序列
│   │       │   ├── req_anthropic_basic.json
│   │       │   ├── req_anthropic_basic.expected.json
│   │       │   ├── req_anthropic_tools.json
│   │       │   ├── req_anthropic_tools.expected.json
│   │       │   ├── req_responses_basic.json
│   │       │   ├── req_responses_basic.expected.json
│   │       │   ├── resp_openai_basic.json
│   │       │   ├── resp_openai_basic.expected.json
│   │       │   ├── resp_openai_tools.json
│   │       │   ├── resp_openai_tools.expected.json
│   │       │   ├── sse_openai_text.upstream.sse
│   │       │   ├── sse_openai_text.expected_anthropic.sse
│   │       │   ├── sse_openai_tools.upstream.sse
│   │       │   └── sse_openai_tools.expected_anthropic.sse
│   │       ├── transform_request.rs
│   │       ├── transform_response.rs
│   │       ├── transform_streaming.rs
│   │       └── server_integration.rs
│   └── swixter/src/
│       ├── cli.rs                      # Proxy(StubArgs) → Proxy(ProxyArgs) 四个子命令
│       ├── main.rs                     # proxy 分支接入 commands::proxy::dispatch
│       └── commands/proxy.rs           # start/stop/status/run + daemon spawn + env 注入
└── （现有 TS src/ 保留不动，M4 删除）
```

## 测试策略

- **transform（Task 5/6/7）：录制样本回放。** 手写 fixtures（见 File Structure）：请求/响应对为 JSON 文件，`*` + `.expected.json` 成对，测试做 `serde_json::Value` 相等断言（字段顺序不敏感）；SSE 为文本文件，按事件序列断言（逐事件 `event:`/`data:` 行比对）。覆盖：纯文本、system 数组合并、image block、tool_use/tool_result、tool_choice 各分支、thinking budget 三档、流式 text/thinking/tool_calls 交错、`[DONE]` 丢弃、坏 JSON 事件丢弃。
- **server/handler/failover（Task 9）：`tokio::test` + 本地 mock upstream。** `tests/common/mod.rs` 用 axum 在 `127.0.0.1:0` 起假 provider，可编程响应（状态码/body/content-type/SSE 流）并录制收到的请求（method/path/headers/body）。handler 测试直接构造 `ProxyHandler`（不起 server），通过 `config_path` 注入临时目录配置；server 集成测试走真实 axum bind + reqwest 客户端。
- **registry/logger（Task 8）：** tempfile 临时目录 + 注入路径；pid 存活性用当前进程 pid（alive）与大数值 pid（dead）断言。
- **CLI（Task 10）：** 纯函数（env 构造、端口分配、参数校验）单测 + assert_cmd 跑 `proxy status`（无实例）、`proxy stop`（未运行）等无需 server 的路径。

## 已知决策点

1. **熔断器用惰性时间戳而非定时任务。** TS 用 `setTimeout` 调度 open→half_open；Rust 只在 `is_available/record_failure` 调用时比较 `opened_at.elapsed()` 与 `RECOVERY_TIMEOUT_MS`，无后台任务、无定时器泄漏。状态用 `DashMap<String, BreakerState>`。
2. **事件总线用 `tokio::sync::broadcast` 占位。** `events.rs` 提供进程级 `broadcast::Sender<ProxyEvent>`（capacity 256）与 `ProxyEvent::{InstanceStart, InstanceStop, StatusUpdate, Log}`，proxy 内部 emit；M3 Web UI 的 WebSocket 广播直接 `subscribe()`。M2 没有订阅者，`send` 返回 Err（无 receiver）时忽略。
3. **`proxy stop` 按 registry pid 发信号 kill（改进 TS 现状）。** TS 对 daemon 进程只删 registry 条目（`stopProxyServer` 的 `servers` map 是进程内的，CLI stop 跑在新进程里摸不到 daemon 的 server）。Rust：`stop` 先查 in-process map（`proxy run` 同进程场景），再查 registry：pid 存活则 Unix 发 `SIGTERM`、轮询至多 5s、仍存活补 `SIGKILL`；最后删 registry 条目。
4. **Windows 信号/进程差异。** Unix：pid 存活性用 `libc::kill(pid, 0)`；daemon detach 用 `pre_exec(setsid)`。Windows：无 `SIGTERM`，存活性与终止用 `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` / `TerminateProcess`（`windows-sys`，target cfg 依赖）；detach 用 `CommandExt::creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS)`。`tokio::signal::ctrl_c` 两平台通用。CI 矩阵覆盖 Windows，相关代码必须 `#[cfg]` 隔离编译。
5. **reqwest 显式超时 + rustls-tls。** reqwest 默认无请求总超时，逐请求 `.timeout()`；TLS 用 rustls（静态链接，musl/Windows 目标免 OpenSSL）。
6. **handler 框架无关。** `ProxyHandler::handle(method, path_and_query, headers, body) -> HandlerResponse`，axum 只做请求/响应类型转换。TS 中 dead 的 `format` 参数不保留（见 Global Constraints 已知偏差）。
7. **config_path 可注入。** `ProxyServerConfig.config_path: Option<PathBuf>`，默认 `core::paths::config_path()`；测试注入临时目录，避免依赖进程级 `SWIXTER_CONFIG_PATH` 环境变量（并行测试会互相污染）。

---

### Task 1: proxy crate 脚手架 + 常量 + 类型

**Files:**
- Modify: `packages/cli/Cargo.toml`（workspace members + workspace.dependencies）
- Create: `packages/cli/crates/proxy/Cargo.toml`
- Create: `packages/cli/crates/proxy/src/lib.rs`
- Create: `packages/cli/crates/proxy/src/types.rs`

**Interfaces:**
- Consumes: `swixter-core`（M1 已有）
- Produces（后续所有任务依赖）:
  - `lib.rs` 常量：`DEFAULT_PROXY_HOST: &str = "127.0.0.1"`、`DEFAULT_PROXY_PORT: u16 = 15721`、`SWIXTER_PROXY_AUTH_TOKEN: &str = "swixter-local-proxy"`、`DEFAULT_TIMEOUT_MS: u64 = 3_000_000`、`FAILURE_THRESHOLD: u32 = 3`、`RECOVERY_TIMEOUT_MS: u64 = 60_000`、`MAX_PROXY_LOG_SIZE_BYTES: u64 = 100 * 1024 * 1024`、`SWIXTER_CLAUDE_MODEL` / `_HAIKU_MODEL` / `_SONNET_MODEL` / `_OPUS_MODEL: &str`
  - `ProxyError`：`Io`、`Json(serde_json::Error)`、`Reqwest(reqwest::Error)`、`Core(swixter_core::CoreError)`、`AddrInUse(String)`、`Transform(String)`
  - `types::InstanceKind { Service, Run }`（serde lowercase）
  - `types::ProxyStatus`（camelCase，与 TS 逐字段一致）
  - `types::ProxyServerConfig { instance_id, kind, host, port, timeout: Duration, group_name, profile_name, config_path: Option<PathBuf> }`

- [ ] **Step 1: 写 workspace 与 crate manifest**

`packages/cli/Cargo.toml` 修改：

```toml
[workspace]
members = ["crates/core", "crates/swixter", "crates/proxy"]

[workspace.dependencies]
# ...（M1 已有条目保留，追加：）
tokio = { version = "1", features = ["rt-multi-thread", "macros", "time", "sync", "process", "signal"] }
axum = "0.8"
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
bytes = "1"
futures = "0.3"
dashmap = "6"
libc = "0.2"
```

`packages/cli/crates/proxy/Cargo.toml`：

```toml
[package]
name = "swixter-proxy"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
swixter-core = { path = "../core" }
tokio.workspace = true
axum.workspace = true
reqwest.workspace = true
bytes.workspace = true
futures.workspace = true
dashmap.workspace = true
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
time.workspace = true

[target.'cfg(unix)'.dependencies]
libc.workspace = true

[target.'cfg(windows)'.dependencies]
windows-sys = { version = "0.59", features = ["Win32_Foundation", "Win32_System_Threading", "Win32_System_Diagnostics_Debug"] }

[dev-dependencies]
tempfile.workspace = true
```

（`windows-sys` 版本以实施时 crates.io 最新 0.5x 为准；仅 Task 8/10 的 Windows 分支用到。）

- [ ] **Step 2: 写 types.rs 与 lib.rs 常量**

`types.rs`：

```rust
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceKind {
    Service,
    Run,
}

/// TS: proxy/types.ts ProxyStatus —— proxy-instances.json 序列化格式逐字段对齐
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyStatus {
    pub instance_id: String,
    #[serde(rename = "type")]
    pub kind: InstanceKind,
    pub running: bool,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    pub request_count: u64,
    pub error_count: u64,
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self {
            instance_id: String::new(),
            kind: InstanceKind::Service,
            running: false,
            host: crate::DEFAULT_PROXY_HOST.to_string(),
            port: crate::DEFAULT_PROXY_PORT,
            group_name: None,
            active_group: None,
            profile_name: None,
            pid: None,
            start_time: None,
            request_count: 0,
            error_count: 0,
        }
    }
}

impl InstanceKind {
    fn default() -> Self { Self::Service }
}

#[derive(Debug, Clone)]
pub struct ProxyServerConfig {
    pub instance_id: String,
    pub kind: InstanceKind,
    pub host: String,
    pub port: u16,
    pub timeout: Duration,
    pub group_name: Option<String>,
    pub profile_name: Option<String>,
    /// 测试注入；None → swixter_core::paths::config_path()
    pub config_path: Option<PathBuf>,
}
```

`lib.rs`：

```rust
pub mod breaker;
pub mod events;
pub mod forwarder;
pub mod handler;
pub mod logger;
pub mod model;
pub mod registry;
pub mod server;
pub mod sse;
pub mod transform;
pub mod types;

pub const DEFAULT_PROXY_HOST: &str = "127.0.0.1";
pub const DEFAULT_PROXY_PORT: u16 = 15721;
pub const SWIXTER_PROXY_AUTH_TOKEN: &str = "swixter-local-proxy";
pub const DEFAULT_TIMEOUT_MS: u64 = 3_000_000;
pub const FAILURE_THRESHOLD: u32 = 3;
pub const RECOVERY_TIMEOUT_MS: u64 = 60_000;
pub const MAX_PROXY_LOG_SIZE_BYTES: u64 = 100 * 1024 * 1024;

pub const SWIXTER_CLAUDE_MODEL: &str = "SWIXTER_CLAUDE_MODEL";
pub const SWIXTER_CLAUDE_HAIKU_MODEL: &str = "SWIXTER_CLAUDE_HAIKU_MODEL";
pub const SWIXTER_CLAUDE_SONNET_MODEL: &str = "SWIXTER_CLAUDE_SONNET_MODEL";
pub const SWIXTER_CLAUDE_OPUS_MODEL: &str = "SWIXTER_CLAUDE_OPUS_MODEL";

#[derive(thiserror::Error, Debug)]
pub enum ProxyError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("reqwest error: {0}")]
    Reqwest(#[from] reqwest::Error),
    #[error("core error: {0}")]
    Core(#[from] swixter_core::CoreError),
    #[error("address in use: {0}")]
    AddrInUse(String),
    #[error("transform error: {0}")]
    Transform(String),
}
```

先给其余模块建空文件（各含一行注释），保证编译通过。

- [ ] **Step 3: 构建 + serde round-trip 冒烟测试**

在 `types.rs` 内联 `#[cfg(test)]` 写 ProxyStatus 与 TS JSON 样本（手工抄一份 TS registry 文件内容）的 round-trip 测试：

```rust
#[test]
fn proxy_status_matches_ts_json() {
    let raw = r#"{"instanceId":"default","type":"service","running":true,"host":"127.0.0.1","port":15721,"groupName":"failover","activeGroup":"failover","pid":12345,"startTime":"2026-07-24T01:00:00.000Z","requestCount":3,"errorCount":1}"#;
    let s: ProxyStatus = serde_json::from_str(raw).unwrap();
    assert_eq!(s.kind, InstanceKind::Service);
    assert_eq!(s.request_count, 3);
    let back: serde_json::Value = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
    let orig: serde_json::Value = serde_json::from_str(raw).unwrap();
    assert_eq!(back, orig);
}
```

Run: `cd packages/cli && cargo test -p swixter-proxy`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/Cargo.toml packages/cli/crates/proxy
git commit -m "feat(rust): proxy crate scaffolding, constants, ProxyStatus types"
```

---

### Task 2: SSE 基础设施（解析/序列化/跨 chunk 缓冲）

**Files:**
- Create: `packages/cli/crates/proxy/src/sse.rs`
- Test: `packages/cli/crates/proxy/src/sse.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Produces:
  - `sse::SseData { Json(serde_json::Value), Done }`（`[DONE]` 哨兵保留；JSON 解析失败的事件在解析层直接丢弃，不进 `SseEvent`）
  - `sse::SseEvent { event: String, data: SseData }`
  - `sse::parse_sse_events(chunk: &str) -> Vec<SseEvent>`
  - `sse::serialize_sse_event(event_name: &str, data_json: &str) -> String`
  - `sse::SseChunker { feed(&mut self, chunk: &[u8]) -> Vec<SseEvent>, flush(&mut self) -> Vec<SseEvent> }`（流式 UTF-8，跨 chunk 缓冲到 `\n\n` 边界）

容错规则（事实表 §SSE 基础设施，逐条复刻 TS `transform/utils.ts` + `streaming/base.ts`）：
- 按行取 `event:` / `data:`；冒号后剥**一个**可选空格（`data:{...}` 与 `data: {...}` 均合法，kimi 等 provider 不带空格）。
- 多行 `data:` 以 `\n` 拼接；空行 flush 当前事件；无 data 行的 block 不产生事件。
- `data: [DONE]`（精确等于）保留为 `SseData::Done` 哨兵，不做 JSON 解析。
- 其余 data 必须 JSON.parse 成功，否则**丢弃该事件**（不抛错）。
- 跨 chunk：字节缓冲，只在 `\n\n` 边界切完整 block 后解码（边界 `\n` 是 ASCII，完整 block 的 UTF-8 序列必然完整，等价于 TS 的 streaming TextDecoder）；`flush` 时剩余非空 buffer 补 `\n\n` 再解析一次。
- 序列化：有 event 名 `event: <name>\ndata: <json>\n\n`，无 event 名仅 `data: <json>\n\n`。

- [ ] **Step 1: 写失败测试（sse.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_event_and_data_with_optional_space() {
        let ev = parse_sse_events("event: message_start\ndata: {\"type\":\"message_start\"}\n\n");
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].event, "message_start");
        // 无空格变体
        let ev2 = parse_sse_events("data:{\"a\":1}\n\n");
        assert!(matches!(&ev2[0].data, SseData::Json(v) if v["a"] == 1));
    }

    #[test]
    fn done_sentinel_preserved_and_bad_json_dropped() {
        let ev = parse_sse_events("data: {bad json\n\ndata: [DONE]\n\n");
        assert_eq!(ev.len(), 1);
        assert!(matches!(ev[0].data, SseData::Done));
    }

    #[test]
    fn multiline_data_joined_and_eventless_block_has_empty_event() {
        let ev = parse_sse_events("data: {\"a\":\ndata: 1}\n\n");
        assert!(matches!(&ev[0].data, SseData::Json(v) if v["a"] == 1));
        assert_eq!(ev[0].event, "");
    }

    #[test]
    fn chunker_buffers_across_chunks_and_utf8_boundary() {
        let mut c = SseChunker::new();
        // "你好" 的 UTF-8 被切到两个 chunk
        let full = "data: {\"t\":\"你\"}\n\n".as_bytes();
        let split = full.iter().position(|_| true).unwrap(); // 任意位置
        assert!(c.feed(&full[..split]).is_empty());
        let ev = c.feed(&full[split..]);
        assert_eq!(ev.len(), 1);
    }

    #[test]
    fn chunker_flush_parses_remainder() {
        let mut c = SseChunker::new();
        assert!(c.feed(b"data: {\"a\":1}").is_empty()); // 无 \n\n 边界
        let ev = c.flush();
        assert_eq!(ev.len(), 1);
    }

    #[test]
    fn serialize_roundtrip() {
        assert_eq!(serialize_sse_event("msg", "{\"a\":1}"), "event: msg\ndata: {\"a\":1}\n\n");
        assert_eq!(serialize_sse_event("", "{\"a\":1}"), "data: {\"a\":1}\n\n");
    }
}
```

Run: `cargo test -p swixter-proxy`
Expected: FAIL（sse 模块为空）。

- [ ] **Step 2: 实现 sse.rs**

```rust
use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum SseData {
    Json(Value),
    Done,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SseEvent {
    pub event: String,
    pub data: SseData,
}

/// TS: transform/utils.ts parseSSEEvents
pub fn parse_sse_events(chunk: &str) -> Vec<SseEvent> {
    let mut events = Vec::new();
    let mut current_event = String::new();
    let mut data_lines: Vec<&str> = Vec::new();

    let mut flush = |current_event: &mut String, data_lines: &mut Vec<&str>, events: &mut Vec<SseEvent>| {
        if !data_lines.is_empty() {
            let data_str = data_lines.join("\n");
            if data_str == "[DONE]" {
                events.push(SseEvent { event: current_event.clone(), data: SseData::Done });
            } else if let Ok(v) = serde_json::from_str::<Value>(&data_str) {
                events.push(SseEvent { event: current_event.clone(), data: SseData::Json(v) });
            }
            // JSON 解析失败：丢弃该事件
        }
        current_event.clear();
        data_lines.clear();
    };

    for line in chunk.split('\n') {
        if let Some(rest) = line.strip_prefix("event:") {
            current_event = rest.strip_prefix(' ').unwrap_or(rest).to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
        } else if line.is_empty() {
            flush(&mut current_event, &mut data_lines, &mut events);
        }
    }
    events
}

/// TS: transform/utils.ts serializeSSEEvent（data 由调用方预先序列化为 JSON 字符串）
pub fn serialize_sse_event(event_name: &str, data_json: &str) -> String {
    if event_name.is_empty() {
        format!("data: {data_json}\n\n")
    } else {
        format!("event: {event_name}\ndata: {data_json}\n\n")
    }
}

/// TS: streaming/base.ts —— 字节缓冲，只在 \n\n 边界切完整 block 再解码。
/// 边界字节是 ASCII，完整 block 内的 UTF-8 序列必然完整，等价于 streaming TextDecoder。
#[derive(Default)]
pub struct SseChunker {
    buf: Vec<u8>,
}

impl SseChunker {
    pub fn new() -> Self { Self::default() }

    pub fn feed(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(chunk);
        let Some(idx) = rfind_double_newline(&self.buf) else { return Vec::new() };
        let complete: Vec<u8> = self.buf.drain(..idx + 2).collect();
        parse_sse_events(&String::from_utf8_lossy(&complete))
    }

    pub fn flush(&mut self) -> Vec<SseEvent> {
        if self.buf.iter().all(|b| b.is_ascii_whitespace()) {
            self.buf.clear();
            return Vec::new();
        }
        let mut rest = std::mem::take(&mut self.buf);
        rest.extend_from_slice(b"\n\n");
        parse_sse_events(&String::from_utf8_lossy(&rest))
    }
}

fn rfind_double_newline(buf: &[u8]) -> Option<usize> {
    buf.windows(2).rposition(|w| w == b"\n\n")
}
```

- [ ] **Step 3: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-proxy sse`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/proxy/src/sse.rs packages/cli/crates/proxy/src/lib.rs
git commit -m "feat(rust): proxy SSE parse/serialize/chunker with TS fault-tolerance"
```

---

### Task 3: 熔断器（惰性时间戳）

**Files:**
- Create: `packages/cli/crates/proxy/src/breaker.rs`
- Test: `packages/cli/crates/proxy/src/breaker.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Produces:
  - `breaker::BreakerStatus { Closed, Open, HalfOpen }`
  - `breaker::CircuitBreaker::new() -> Self`（`FAILURE_THRESHOLD` / `RECOVERY_TIMEOUT_MS`）
  - `breaker::CircuitBreaker::with_config(threshold: u32, recovery: Duration) -> Self`（测试用）
  - `is_available(&self, profile_id: &str) -> bool`
  - `status(&self, profile_id: &str) -> BreakerStatus`
  - `record_success(&self, profile_id: &str)`、`record_failure(&self, profile_id: &str)`

语义（事实表 §熔断器，惰性化 TS 定时器行为）：
- closed：连续失败 ≥3 → open（记 `opened_at = Instant::now()`）。
- open：`is_available` 为 false；`opened_at.elapsed() >= recovery` → 视为 half_open（**不改写存储状态**，惰性判定），放行下一次请求。
- half_open：失败 → 回 open 并重计时（`opened_at = now`）；成功 → 完全复位。
- 任意成功 → 完全复位（直接移除条目）。
- 熔断按 profileId 独立；是否计入熔断由调用方（handler）判断（5xx/429/网络异常），breaker 本身不管。

- [ ] **Step 1: 写失败测试（breaker.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    fn breaker() -> CircuitBreaker {
        CircuitBreaker::with_config(3, Duration::from_millis(50))
    }

    #[test]
    fn opens_after_threshold_failures() {
        let b = breaker();
        assert!(b.is_available("p1"));
        b.record_failure("p1");
        b.record_failure("p1");
        assert!(b.is_available("p1")); // 2 < 3
        b.record_failure("p1");
        assert!(!b.is_available("p1"));
        assert_eq!(b.status("p1"), BreakerStatus::Open);
        // 独立 profileId 不受影响
        assert!(b.is_available("p2"));
    }

    #[test]
    fn lazy_half_open_after_recovery() {
        let b = breaker();
        for _ in 0..3 { b.record_failure("p1"); }
        assert!(!b.is_available("p1"));
        sleep(Duration::from_millis(60));
        assert!(b.is_available("p1")); // 惰性 half_open 放行
        assert_eq!(b.status("p1"), BreakerStatus::HalfOpen);
    }

    #[test]
    fn half_open_failure_reopens_and_retarts_timer() {
        let b = breaker();
        for _ in 0..3 { b.record_failure("p1"); }
        sleep(Duration::from_millis(60));
        assert!(b.is_available("p1"));
        b.record_failure("p1"); // half_open 失败 → 回 open
        assert!(!b.is_available("p1"));
    }

    #[test]
    fn success_fully_resets() {
        let b = breaker();
        for _ in 0..3 { b.record_failure("p1"); }
        sleep(Duration::from_millis(60));
        b.record_success("p1");
        assert_eq!(b.status("p1"), BreakerStatus::Closed);
        b.record_failure("p1");
        assert!(b.is_available("p1")); // 重新从 0 计数
    }
}
```

Run: `cargo test -p swixter-proxy breaker`
Expected: FAIL。

- [ ] **Step 2: 实现 breaker.rs**

```rust
use dashmap::DashMap;
use std::time::{Duration, Instant};

use crate::{FAILURE_THRESHOLD, RECOVERY_TIMEOUT_MS};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BreakerStatus {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Debug, Clone, Copy)]
struct BreakerState {
    consecutive_failures: u32,
    opened_at: Option<Instant>,
}

impl BreakerState {
    fn status(&self, recovery: Duration) -> BreakerStatus {
        match self.opened_at {
            None => BreakerStatus::Closed,
            Some(t) if t.elapsed() >= recovery => BreakerStatus::HalfOpen,
            Some(_) => BreakerStatus::Open,
        }
    }
}

/// 惰性时间戳熔断器：无定时任务，状态迁移在调用时判定（决策点 1）。
pub struct CircuitBreaker {
    threshold: u32,
    recovery: Duration,
    states: DashMap<String, BreakerState>,
}

impl CircuitBreaker {
    pub fn new() -> Self {
        Self::with_config(FAILURE_THRESHOLD, Duration::from_millis(RECOVERY_TIMEOUT_MS))
    }

    pub fn with_config(threshold: u32, recovery: Duration) -> Self {
        Self { threshold, recovery, states: DashMap::new() }
    }

    pub fn status(&self, profile_id: &str) -> BreakerStatus {
        self.states
            .get(profile_id)
            .map(|s| s.status(self.recovery))
            .unwrap_or(BreakerStatus::Closed)
    }

    pub fn is_available(&self, profile_id: &str) -> bool {
        !matches!(self.status(profile_id), BreakerStatus::Open)
    }

    pub fn record_success(&self, profile_id: &str) {
        self.states.remove(profile_id); // 完全复位
    }

    pub fn record_failure(&self, profile_id: &str) {
        let mut entry = self.states.entry(profile_id.to_string()).or_insert(BreakerState {
            consecutive_failures: 0,
            opened_at: None,
        });
        match entry.status(self.recovery) {
            BreakerStatus::HalfOpen => {
                // half_open 失败 → 回 open 重计时
                entry.opened_at = Some(Instant::now());
            }
            BreakerStatus::Open => {
                // open 期间不应有请求到达（is_available 已拦截）；防御性重计时
                entry.opened_at = Some(Instant::now());
            }
            BreakerStatus::Closed => {
                entry.consecutive_failures += 1;
                if entry.consecutive_failures >= self.threshold {
                    entry.opened_at = Some(Instant::now());
                }
            }
        }
    }
}
```

注意 half_open 期间并发请求会同时放行（TS 也是如此：`isAvailable` 只看 `isOpen`），不做单飞限制，与 TS 对齐。

- [ ] **Step 3: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-proxy breaker`
Expected: 全部 PASS。

- [ ] **Step 4: Commit**

```bash
git add packages/cli/crates/proxy/src/breaker.rs
git commit -m "feat(rust): circuit breaker with lazy timestamp recovery"
```

---

### Task 4: Forwarder（reqwest 转发）

**Files:**
- Create: `packages/cli/crates/proxy/src/forwarder.rs`
- Create: `packages/cli/crates/proxy/tests/common/mod.rs`（mock upstream，后续任务复用）
- Test: `packages/cli/crates/proxy/tests/forwarder.rs`

**Interfaces:**
- Consumes: `swixter_core::types::{Profile, ProviderPreset, ApiFormat}`（M1）、`transform::infer_target_api_format`（Task 5；本任务先以函数参数传入，避免循环依赖）
- Produces:
  - `forwarder::ForwardRequest { method: String, path: String /* path+query */, headers: reqwest::header::HeaderMap, body: bytes::Bytes }`
  - `forwarder::ForwardBody { Full(Bytes), Stream(Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>) }`
  - `forwarder::ForwardResponse { status: u16, headers: HeaderMap, is_stream: bool, body: ForwardBody }`
  - `forwarder::build_upstream_url(profile: &Profile, preset: Option<&ProviderPreset>, path: &str) -> String`
  - `forwarder::filtered_headers(src: &HeaderMap, target_format: ApiFormat, credential: &str) -> HeaderMap`
  - `forwarder::Forwarder::new() -> Self`、`forward(&self, req: ForwardRequest, profile: &Profile, preset: Option<&ProviderPreset>, timeout: Duration, target_format: ApiFormat) -> Result<ForwardResponse, ProxyError>`

规则（事实表 §Forwarder + TS `forwarder.ts` 逐行对齐）：
- URL：`base = (profile.base_url || preset.base_url).trim_end_matches('/')`；`base` 以 `/v1` 结尾且 path 以 `/v1/` 开头则 path 去掉前 3 字符（`/v1`）；`url = base + path`（path 含 query）。
- Header 剔除（大小写不敏感，HeaderMap 的 name 已规范化为小写）：`authorization`、`x-api-key`、`content-length`、`host`。
- 凭据：`credential = profile.auth_token(非空) || profile.api_key(非空) || ""`；**仅当非空**：目标格式 `anthropic_*` → `x-api-key: <credential>`，其他（含 `gemini_native`）→ `Authorization: Bearer <credential>`。
- 超时：`timeout` 参数逐请求 `.timeout()`（reqwest 默认无总超时，决策点 5）。
- 流式检测：响应 content-type 含 `text/event-stream` 或 `application/x-ndjson` → `is_stream = true`，body 用 `bytes_stream()` 不缓冲；否则读取完整 body。

- [ ] **Step 1: 写 mock upstream helper**

`packages/cli/crates/proxy/tests/common/mod.rs`：

```rust
use axum::{body::Body, extract::State, http::{HeaderMap, StatusCode}, response::Response, routing::any, Router};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct RecordedRequest {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Clone)]
pub struct MockState {
    pub status: StatusCode,
    pub content_type: String,
    pub body: Body, // 用 Body 支持一次性 SSE 流
    pub recorded: Arc<Mutex<Vec<RecordedRequest>>>,
}

pub struct MockUpstream {
    pub addr: SocketAddr,
    pub base_url: String, // http://127.0.0.1:<port>
    pub recorded: Arc<Mutex<Vec<RecordedRequest>>>,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

impl MockUpstream {
    /// respond: 每次请求调用，返回 (status, content_type, body)
    pub async fn start<F>(respond: F) -> Self
    where
        F: Fn() -> (StatusCode, String, Body) + Send + Sync + 'static,
    {
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let rec = recorded.clone();
        let app = Router::new().route("/{*path}", any(move |method: axum::http::Method, headers: HeaderMap, uri: axum::http::Uri, body: axum::body::Bytes| {
            let rec = rec.clone();
            let (status, ct, resp_body) = respond();
            async move {
                rec.lock().unwrap().push(RecordedRequest {
                    method: method.to_string(),
                    path: uri.path().to_string() + uri.query().map(|q| format!("?{q}")).as_deref().unwrap_or(""),
                    headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string())).collect(),
                    body: body.to_vec(),
                });
                Response::builder().status(status).header("content-type", ct).body(resp_body).unwrap()
            }
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async { rx.await.ok(); })
                .await
                .unwrap();
        });
        Self { addr, base_url: format!("http://{addr}"), recorded, shutdown: tx }
    }
}

impl Drop for MockUpstream {
    fn drop(&mut self) { let _ = self.shutdown.send(()); }
}
```

（`Body` 不可 Clone，实际实现时 `respond` 闭包每次返回新 Body；上面 `MockState` 仅示意，落地时以编译通过的形态为准。）

- [ ] **Step 2: 写失败测试（tests/forwarder.rs）**

```rust
mod common;
use common::MockUpstream;
use swixter_proxy::forwarder::*;
use swixter_core::types::{ApiFormat, Profile};
use std::time::Duration;

fn profile(base_url: &str) -> Profile {
    Profile { name: "p1".into(), provider_id: "custom".into(), api_key: "sk-real".into(),
              base_url: Some(base_url.into()), ..Default::default() }
}

#[test]
fn url_join_trims_slashes_and_dedups_v1() {
    let p = profile("https://api.example.com/v1/");
    assert_eq!(build_upstream_url(&p, None, "/v1/chat/completions?a=1"),
               "https://api.example.com/v1/chat/completions?a=1");
    let p2 = profile("https://api.example.com/anthropic");
    assert_eq!(build_upstream_url(&p2, None, "/v1/messages"),
               "https://api.example.com/anthropic/v1/messages");
}

#[test]
fn headers_stripped_and_credential_injected() {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert("authorization", "Bearer swixter-local-proxy".parse().unwrap());
    h.insert("x-api-key", "old".parse().unwrap());
    h.insert("host", "localhost".parse().unwrap());
    h.insert("content-length", "10".parse().unwrap());
    h.insert("x-custom", "keep".parse().unwrap());
    let out = filtered_headers(&h, ApiFormat::AnthropicMessages, "sk-real");
    assert!(out.get("authorization").is_none() || out.get("authorization").unwrap() != "Bearer swixter-local-proxy");
    assert_eq!(out.get("x-api-key").unwrap(), "sk-real");
    assert!(out.get("host").is_none());
    assert!(out.get("content-length").is_none());
    assert_eq!(out.get("x-custom").unwrap(), "keep");
    // openai 目标 → Bearer
    let out2 = filtered_headers(&h, ApiFormat::OpenaiChat, "sk-real");
    assert_eq!(out2.get("authorization").unwrap(), "Bearer sk-real");
}

#[tokio::test]
async fn forward_posts_and_captures_upstream_request() {
    let mock = MockUpstream::start(|| (axum::http::StatusCode::OK, "application/json".into(), axum::body::Body::from("{}"))).await;
    let p = profile(&mock.base_url);
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    let resp = Forwarder::new().forward(
        ForwardRequest { method: "POST".into(), path: "/v1/chat/completions".into(),
                         headers, body: bytes::Bytes::from("{}") },
        &p, None, Duration::from_secs(5), ApiFormat::OpenaiChat,
    ).await.unwrap();
    assert_eq!(resp.status, 200);
    assert!(!resp.is_stream);
    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec[0].method, "POST");
    assert_eq!(rec[0].path, "/v1/chat/completions");
    assert!(rec[0].headers.iter().any(|(k, v)| k == "authorization" && v == "Bearer sk-real"));
}

#[tokio::test]
async fn forward_detects_sse_stream() {
    let mock = MockUpstream::start(|| (axum::http::StatusCode::OK, "text/event-stream".into(),
        axum::body::Body::from("data: {}\n\n"))).await;
    let p = profile(&mock.base_url);
    let resp = Forwarder::new().forward(
        ForwardRequest { method: "POST".into(), path: "/v1/chat/completions".into(),
                         headers: Default::default(), body: bytes::Bytes::from("{}") },
        &p, None, Duration::from_secs(5), ApiFormat::OpenaiChat,
    ).await.unwrap();
    assert!(resp.is_stream);
}
```

Run: `cargo test -p swixter-proxy --test forwarder`
Expected: FAIL（forwarder 模块为空）。

- [ ] **Step 3: 实现 forwarder.rs**

```rust
use bytes::Bytes;
use futures::Stream;
use reqwest::header::{HeaderMap, HeaderValue};
use std::pin::Pin;
use std::time::Duration;
use swixter_core::types::{ApiFormat, Profile, ProviderPreset};

use crate::ProxyError;

pub struct ForwardRequest {
    pub method: String,
    pub path: String, // path + query
    pub headers: HeaderMap,
    pub body: Bytes,
}

pub enum ForwardBody {
    Full(Bytes),
    Stream(Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>),
}

pub struct ForwardResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub is_stream: bool,
    pub body: ForwardBody,
}

const STRIP_HEADERS: [&str; 4] = ["authorization", "x-api-key", "content-length", "host"];

/// TS: baseURL = (profile.baseURL || preset.baseURL).replace(/\/+$/,"")；
/// base 以 /v1 结尾且 path 以 /v1/ 开头 → path 去掉前 3 字符
pub fn build_upstream_url(profile: &Profile, preset: Option<&ProviderPreset>, path: &str) -> String {
    let base = profile
        .base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(preset.map(|p| p.base_url.as_str()))
        .unwrap_or("");
    let base = base.trim_end_matches('/');
    let path = if base.ends_with("/v1") && path.starts_with("/v1/") { &path[3..] } else { path };
    format!("{base}{path}")
}

/// TS: 剔除 authorization/x-api-key/content-length/host（大小写不敏感，HeaderMap name 已小写）；
/// credential 非空时按目标格式注入
pub fn filtered_headers(src: &HeaderMap, target_format: ApiFormat, credential: &str) -> HeaderMap {
    let mut out = HeaderMap::new();
    for (name, value) in src.iter() {
        if STRIP_HEADERS.contains(&name.as_str()) { continue; }
        out.insert(name.clone(), value.clone());
    }
    if !credential.is_empty() {
        let is_anthropic = matches!(target_format, ApiFormat::AnthropicMessages | ApiFormat::AnthropicResponses);
        if is_anthropic {
            out.insert("x-api-key", HeaderValue::from_str(credential).expect("header value"));
        } else {
            out.insert("authorization", HeaderValue::from_str(&format!("Bearer {credential}")).expect("header value"));
        }
    }
    out
}

/// TS: credential = profile.authToken || profile.apiKey || ""（JS || 跳过空字符串）
pub fn credential_of(profile: &Profile) -> &str {
    profile.auth_token.as_deref().filter(|s| !s.is_empty())
        .or(profile.api_key.as_str().strip_prefix("").filter(|s| !s.is_empty()))
        .unwrap_or("")
}

pub struct Forwarder {
    client: reqwest::Client,
}

impl Forwarder {
    pub fn new() -> Self {
        Self { client: reqwest::Client::builder().build().expect("reqwest client") }
    }

    pub async fn forward(
        &self,
        req: ForwardRequest,
        profile: &Profile,
        preset: Option<&ProviderPreset>,
        timeout: Duration,
        target_format: ApiFormat,
    ) -> Result<ForwardResponse, ProxyError> {
        let url = build_upstream_url(profile, preset, &req.path);
        let headers = filtered_headers(&req.headers, target_format, credential_of(profile));
        let method = reqwest::Method::from_bytes(req.method.as_bytes())
            .map_err(|e| ProxyError::Transform(format!("bad method: {e}")))?;

        let resp = self.client
            .request(method, &url)
            .headers(headers)
            .body(req.body)
            .timeout(timeout)
            .send()
            .await?;

        let status = resp.status().as_u16();
        let headers = resp.headers().clone();
        let content_type = headers.get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let is_stream = content_type.contains("text/event-stream")
            || content_type.contains("application/x-ndjson");

        let body = if is_stream {
            ForwardBody::Stream(Box::pin(resp.bytes_stream()))
        } else {
            ForwardBody::Full(resp.bytes().await?)
        };
        Ok(ForwardResponse { status, headers, is_stream, body })
    }
}
```

（`credential_of` 里 `strip_prefix` 写法别扭，实施时写 `Some(profile.api_key.as_str()).filter(|s| !s.is_empty())`，语义相同。）

- [ ] **Step 4: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-proxy --test forwarder`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/proxy/src/forwarder.rs packages/cli/crates/proxy/tests
git commit -m "feat(rust): proxy forwarder with URL join, header filter, credential injection"
```

---

### Task 5: Transform registry + 格式推断 + 请求方向转换器

**Files:**
- Create: `packages/cli/crates/proxy/src/transform/mod.rs`
- Create: `packages/cli/crates/proxy/src/transform/request.rs`
- Create: `packages/cli/crates/proxy/tests/transform_request.rs`
- Create: `packages/cli/crates/proxy/tests/fixtures/req_*.json`（3 对 fixture）

**Interfaces:**
- Consumes: `swixter_core::types::{ApiFormat, Profile, ProviderPreset, WireApi}`（M1）
- Produces:
  - `transform::TransformCtx { endpoint: String, client_format: ApiFormat, target_format: ApiFormat, stream: bool }`
  - `transform::TransformedRequest { body: serde_json::Value, target_endpoint: String }`
  - `transform::infer_client_format(endpoint: &str) -> ApiFormat`
  - `transform::infer_api_format_from_base_url(base_url: &str) -> Option<ApiFormat>`
  - `transform::infer_target_api_format(profile: &Profile, preset: Option<&ProviderPreset>) -> ApiFormat`
  - `transform::has_transformer(client: ApiFormat, target: ApiFormat) -> bool`
  - `transform::transform_request(body: &serde_json::Value, ctx: &TransformCtx) -> Result<TransformedRequest, ProxyError>`
  - `request::anthropic_to_openai_chat(body: &Value, ctx: &TransformCtx) -> Result<TransformedRequest, ProxyError>`
  - `request::openai_responses_to_openai_chat(body: &Value, ctx: &TransformCtx) -> Result<TransformedRequest, ProxyError>`

规则引用（不要整段抄，实施时逐条对照）：
- 格式推断：事实表 §Transform「格式推断」四条 + TS `transform/index.ts`（`/v1/responses` → `openai_responses`；target 推断链 `profile.api_format` → baseURL 路径（`/anthropic`/`/responses`/`/openai`）→ `preset.default_api_format` → `preset.wire_api`（chat→openai_chat、responses→anthropic_messages、默认 openai_chat））。
- 已注册转换器仅 2 对：`anthropic_messages ↔ openai_chat`、`openai_responses ↔ openai_chat`。`client == target` 时不需要转换器（直通）。
- 请求映射规则：事实表「请求 Anthropic Messages → OpenAI Chat」与「请求 OpenAI Responses → OpenAI Chat」两节逐条对齐。
- **正则注意**：工具名过滤 `/^(?!.*__)[a-zA-Z][a-zA-Z0-9_-]{0,63}$/` 含负向前瞻，`regex` crate 不支持——手写等价校验：`!name.contains("__") && 首字符 ASCII 字母 && 其余字符 ∈ [a-zA-Z0-9_-] && len ≤ 64`。

- [ ] **Step 1: 写 fixtures**

手写 3 对（内容要点，实施时按事实表字段展开完整 JSON）：
- `req_anthropic_basic.json`：system 为 block 数组（两个 text block）+ 单条 user text + max_tokens/temperature/stop_sequences → `.expected.json`：前置 system 消息（`\n` 合并）、`stop` 字段。
- `req_anthropic_tools.json`：assistant `tool_use` + user `tool_result`（content 为数组）+ `tools` + `tool_choice:{type:"tool",name}` + `thinking:{budget_tokens:32000}` → expected：`tool_calls`（arguments 为 JSON 字符串）、拆分的多条 `role:"tool"` 消息、`tool_choice:{type:"function",function:{name}}`、`reasoning_effort:"high"`。
- `req_responses_basic.json`：`instructions` + `input` 数组（developer message + function_call + function_call_output）+ `max_output_tokens` + `reasoning:{effort:"medium"}` + tools（一个名字含 `__` 被过滤、一个缺 `parameters` 补空 schema）→ expected：system 消息、`max_tokens`、`reasoning_effort` 直通、过滤后的 tools。

- [ ] **Step 2: 写失败测试（tests/transform_request.rs）**

```rust
use serde_json::{json, Value};
use swixter_core::types::{ApiFormat, Profile, ProviderPreset, WireApi};
use swixter_proxy::transform::*;

fn fixture(name: &str) -> Value {
    let p = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn ctx(client: ApiFormat, target: ApiFormat) -> TransformCtx {
    TransformCtx { endpoint: "/v1/messages".into(), client_format: client, target_format: target, stream: false }
}

#[test]
fn anthropic_basic_matches_fixture() {
    let out = transform_request(&fixture("req_anthropic_basic.json"),
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat)).unwrap();
    assert_eq!(out.target_endpoint, "/v1/chat/completions");
    assert_eq!(out.body, fixture("req_anthropic_basic.expected.json"));
}

#[test]
fn anthropic_tools_matches_fixture() { /* 同上模式 */ }

#[test]
fn responses_basic_matches_fixture() { /* 同上模式，endpoint "/v1/responses" */ }

#[test]
fn infer_client_format_rules() {
    assert_eq!(infer_client_format("/v1/chat/completions"), ApiFormat::OpenaiChat);
    assert_eq!(infer_client_format("/v1/responses"), ApiFormat::OpenaiResponses);
    assert_eq!(infer_client_format("/anthropic/v1/messages"), ApiFormat::AnthropicMessages);
    assert_eq!(infer_client_format("/v1/messages"), ApiFormat::AnthropicMessages);
    assert_eq!(infer_client_format("/anything/else"), ApiFormat::AnthropicMessages);
}

#[test]
fn infer_target_format_priority_chain() {
    let mut p = Profile { provider_id: "custom".into(), ..Default::default() };
    let preset = ProviderPreset { wire_api: Some(WireApi::Responses), ..Default::default() };
    // 1. apiFormat 显式
    p.api_format = Some(ApiFormat::OpenaiChat);
    assert_eq!(infer_target_api_format(&p, Some(&preset)), ApiFormat::OpenaiChat);
    // 2. baseURL 路径
    p.api_format = None;
    p.base_url = Some("https://x.com/anthropic".into());
    assert_eq!(infer_target_api_format(&p, Some(&preset)), ApiFormat::AnthropicMessages);
    // 4. wire_api 兜底（default_api_format 为 None 时）
    p.base_url = Some("https://x.com".into());
    assert_eq!(infer_target_api_format(&p, Some(&preset)), ApiFormat::AnthropicMessages);
    // 无 preset → 默认 openai_chat
    assert_eq!(infer_target_api_format(&p, None), ApiFormat::OpenaiChat);
}

#[test]
fn has_transformer_only_two_pairs() {
    use ApiFormat::*;
    assert!(has_transformer(AnthropicMessages, OpenaiChat));
    assert!(has_transformer(OpenaiChat, AnthropicMessages));
    assert!(has_transformer(OpenaiResponses, OpenaiChat));
    assert!(has_transformer(OpenaiChat, OpenaiResponses));
    assert!(!has_transformer(AnthropicMessages, OpenaiResponses));
    assert!(!has_transformer(GeminiNative, OpenaiChat));
}

#[test]
fn tool_name_filter_rejects_double_underscore() {
    assert!(request::valid_tool_name("get_weather"));
    assert!(request::valid_tool_name("a".repeat(64).as_str()));
    assert!(!request::valid_tool_name("mcp__tool"));
    assert!(!request::valid_tool_name("1abc"));
    assert!(!request::valid_tool_name("has space"));
    assert!(!request::valid_tool_name("a".repeat(65).as_str()));
}
```

Run: `cargo test -p swixter-proxy --test transform_request`
Expected: FAIL。

- [ ] **Step 3: 实现 transform/mod.rs**

```rust
pub mod request;
pub mod response;
pub mod streaming;

use serde_json::Value;
use swixter_core::types::{ApiFormat, Profile, ProviderPreset, WireApi};

use crate::ProxyError;

#[derive(Debug, Clone)]
pub struct TransformCtx {
    pub endpoint: String, // path + query
    pub client_format: ApiFormat,
    pub target_format: ApiFormat,
    pub stream: bool,
}

pub struct TransformedRequest {
    pub body: Value,
    pub target_endpoint: String,
}

/// TS: transform/index.ts inferClientFormat
pub fn infer_client_format(endpoint: &str) -> ApiFormat {
    if endpoint.contains("/v1/chat/completions") { return ApiFormat::OpenaiChat; }
    // /v1/responses 无歧义地是 OpenAI Responses（真实 anthropic_responses 客户端不存在）
    if endpoint.contains("/v1/responses") { return ApiFormat::OpenaiResponses; }
    ApiFormat::AnthropicMessages // 含 /anthropic/ 与 /v1/messages 及默认
}

/// TS: inferApiFormatFromBaseURL
pub fn infer_api_format_from_base_url(base_url: &str) -> Option<ApiFormat> {
    let url = url::Url::parse(base_url).ok()?;
    let path = url.path().to_lowercase();
    if path.contains("/anthropic") { return Some(ApiFormat::AnthropicMessages); }
    if path.contains("/responses") { return Some(ApiFormat::AnthropicResponses); }
    if path.contains("/openai") { return Some(ApiFormat::OpenaiChat); }
    None
}

/// TS: inferTargetApiFormat —— apiFormat > baseURL 路径 > preset.defaultApiFormat > wire_api 兜底
pub fn infer_target_api_format(profile: &Profile, preset: Option<&ProviderPreset>) -> ApiFormat {
    if let Some(f) = profile.api_format { return f; }
    let base = profile.base_url.as_deref().filter(|s| !s.is_empty())
        .or(preset.map(|p| p.base_url.as_str()))
        .unwrap_or("");
    if let Some(f) = infer_api_format_from_base_url(base) { return f; }
    if let Some(f) = preset.and_then(|p| p.default_api_format) { return f; }
    match preset.and_then(|p| p.wire_api) {
        Some(WireApi::Chat) => ApiFormat::OpenaiChat,
        Some(WireApi::Responses) => ApiFormat::AnthropicMessages,
        None => ApiFormat::OpenaiChat,
    }
}

/// TS: TRANSFORMER_REGISTRY —— 仅 2 对；Rust 用 match 静态分派代替运行时注册
pub fn has_transformer(client: ApiFormat, target: ApiFormat) -> bool {
    use ApiFormat::*;
    matches!(
        (client, target),
        (AnthropicMessages, OpenaiChat) | (OpenaiChat, AnthropicMessages)
            | (OpenaiResponses, OpenaiChat) | (OpenaiChat, OpenaiResponses)
    )
}

pub fn transform_request(body: &Value, ctx: &TransformCtx) -> Result<TransformedRequest, ProxyError> {
    use ApiFormat::*;
    match (ctx.client_format, ctx.target_format) {
        (AnthropicMessages, OpenaiChat) => request::anthropic_to_openai_chat(body, ctx),
        (OpenaiResponses, OpenaiChat) => request::openai_responses_to_openai_chat(body, ctx),
        // 反向（openai_chat 客户端 → anthropic 上游）TS 未注册请求转换器；
        // client==target 由调用方直通，不会走到这里
        _ => Ok(TransformedRequest { body: body.clone(), target_endpoint: ctx.endpoint.clone() }),
    }
}
```

注意：`url::Url` 需要给 proxy crate 的 Cargo.toml 追加 `url.workspace = true`（TS 用 `new URL()` 解析失败返回 null；Rust 同样 parse 失败 → None）。

- [ ] **Step 4: 实现 transform/request.rs**

签名与关键代码（完整字段映射逐条对照事实表两节，不在计划里整段复制）：

```rust
use serde_json::{json, Map, Value};
use super::{TransformCtx, TransformedRequest};
use crate::ProxyError;

/// 工具名过滤：等价于 /^(?!.*__)[a-zA-Z][a-zA-Z0-9_-]{0,63}$/（regex crate 不支持前瞻，手写）
pub fn valid_tool_name(name: &str) -> bool {
    !name.contains("__")
        && name.len() <= 64
        && name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// TS: mergeSystemBlocks —— 字符串直通；数组取 type=="text" 的 text 以 \n 合并
pub fn merge_system_blocks(system: &Value) -> String { /* 事实表 §请求 A→O */ }

/// 事实表「请求 Anthropic Messages → OpenAI Chat」逐条：
/// targetEndpoint=/v1/chat/completions；system→前置 system 消息；透传 model/max_tokens/
/// temperature/top_p/stream；stop_sequences→stop；text/image(仅 base64)/tool_use/tool_result 映射；
/// tools→function；tool_choice 四分支；thinking.budget_tokens→reasoning_effort 三档
pub fn anthropic_to_openai_chat(body: &Value, ctx: &TransformCtx) -> Result<TransformedRequest, ProxyError> {
    let mut out = Map::new();
    let mut messages: Vec<Value> = Vec::new();

    // system → 前置 system 消息
    if let Some(system) = body.get("system") {
        let text = merge_system_blocks(system);
        if !text.is_empty() {
            messages.push(json!({"role": "system", "content": text}));
        }
    }

    // 消息映射（关键分支）：
    for msg in body.get("messages").and_then(Value::as_array).into_iter().flatten() {
        let role = msg.get("role").and_then(Value::as_str).unwrap_or("user");
        match msg.get("content") {
            Some(Value::String(s)) => messages.push(json!({"role": role, "content": s})),
            Some(Value::Array(blocks)) => {
                // assistant: text parts + tool_calls（无文本时 content=null）
                // user: text parts + image_url parts；tool_result → 拆多条 role:"tool"
                // （逐条按事实表实现，tool_use → {id,type:"function",function:{name,arguments:JSON.stringify(input)}}，
                //   tool_result content 非字符串 → JSON 序列化）
                // ... 完整实现按事实表展开
            }
            _ => messages.push(json!({"role": role, "content": ""})),
        }
    }

    // thinking.budget_tokens → reasoning_effort
    if let Some(budget) = body.pointer("/thinking/budget_tokens").and_then(Value::as_u64) {
        let effort = if budget >= 32000 { "high" } else if budget >= 16000 { "medium" } else { "low" };
        out.insert("reasoning_effort".into(), json!(effort));
    }

    // 透传字段 + stop_sequences→stop + tools + tool_choice（按事实表）
    // ...
    out.insert("messages".into(), json!(messages));
    Ok(TransformedRequest { body: Value::Object(out), target_endpoint: "/v1/chat/completions".into() })
}

/// 事实表「请求 OpenAI Responses → OpenAI Chat」逐条：
/// instructions→system；input 字符串→单条 user；数组逐项 message(developer→system, content flattenText)/
/// function_call→assistant+tool_calls(id=call_id)/function_call_output→role:"tool"；其他丢弃；
/// flattenText 不支持的 part 类型 → Err(ProxyError::Transform)（TS 抛错，外层回退透传）；
/// max_output_tokens→max_tokens；reasoning.effort→reasoning_effort；工具名过滤 + 缺 parameters 补空 schema；
/// tool_choice 字符串直通 / {type:"function",name}→{type:"function",function:{name}}
pub fn openai_responses_to_openai_chat(body: &Value, ctx: &TransformCtx) -> Result<TransformedRequest, ProxyError> {
    // ... 按事实表展开；target_endpoint 同为 /v1/chat/completions
}
```

- [ ] **Step 5: 跑测试 + clippy**

Run: `cd packages/cli && cargo test -p swixter-proxy --test transform_request && cargo clippy -p swixter-proxy -- -D warnings`
Expected: 全部 PASS。

- [ ] **Step 6: Commit**

```bash
git add packages/cli/crates/proxy/src/transform packages/cli/crates/proxy/tests/transform_request.rs packages/cli/crates/proxy/tests/fixtures
git commit -m "feat(rust): transform registry, format inference, request transformers"
```

---

### Task 6: 非流式响应转换器

**Files:**
- Create: `packages/cli/crates/proxy/src/transform/response.rs`
- Create: `packages/cli/crates/proxy/tests/transform_response.rs`
- Create: `packages/cli/crates/proxy/tests/fixtures/resp_*.json`（2 对 fixture）

**Interfaces:**
- Consumes: `transform::TransformCtx`（Task 5）
- Produces:
  - `transform::transform_response(body: &Value, ctx: &TransformCtx) -> Result<Value, ProxyError>`（mod.rs 追加）
  - `response::openai_chat_to_anthropic(body: &Value) -> Result<Value, ProxyError>`
  - `response::openai_chat_to_openai_responses(body: &Value) -> Result<Value, ProxyError>`
  - `response::map_finish_reason(reason: Option<&str>) -> Value`（stop→end_turn、length→max_tokens、tool_calls/function_call→tool_use、content_filter→end_turn、其他直通、null→null；流式转换器复用）

规则引用：事实表「非流式响应 OpenAI Chat → Anthropic」与「非流式响应 OpenAI Chat → OpenAI Responses」两节逐条对齐。要点：
- choices[0] 不存在 → 原样返回整个 body。
- content 顺序固定：reasoning_content→thinking block → tool_calls→tool_use block → 文本→text block。
- usage 映射 `prompt_tokens→input_tokens`、`completion_tokens→output_tokens`、`cached_tokens→cache_read_input_tokens`。
- `id` 缺省 `msg_<unix_ms>`（Rust：`SystemTime::now().duration_since(UNIX_EPOCH).as_millis()`）。
- Responses 侧：文本→message item（`id:"msg_0"`）；tool_calls→function_call item（`id:"fc_<i>"`）；`id: resp_<chat.id>`；finish_reason=="length"→`status:"incomplete"`；usage total 缺省=input+output。

- [ ] **Step 1: 写 fixtures**

- `resp_openai_basic.json`：choices[0] 带 `reasoning_content` + `finish_reason:"stop"` + usage（含 `prompt_tokens_details.cached_tokens`）→ `.expected.json`：thinking+text 两个 block、`stop_reason:"end_turn"`、`cache_read_input_tokens`。
- `resp_openai_tools.json`：choices[0] 带 tool_calls（arguments 为 JSON 字符串）+ `finish_reason:"tool_calls"` → expected：tool_use block（input 为 parse 后对象）、`stop_reason:"tool_use"`。

- [ ] **Step 2: 写失败测试（tests/transform_response.rs）**

```rust
#[test]
fn openai_basic_to_anthropic_matches_fixture() {
    let out = transform_response(&fixture("resp_openai_basic.json"),
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat)).unwrap();
    let expected = fixture("resp_openai_basic.expected.json");
    // id 含时间戳时单独断言前缀，其余整体相等（fixture 中 id 固定则直接相等）
    assert_eq!(out, expected);
}

#[test]
fn openai_tools_to_anthropic_matches_fixture() { /* 同上模式 */ }

#[test]
fn no_choices_returns_body_unchanged() {
    let body = serde_json::json!({"id": "x"});
    let out = transform_response(&body, &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat)).unwrap();
    assert_eq!(out, body);
}

#[test]
fn finish_reason_mapping() {
    assert_eq!(map_finish_reason(Some("stop")), serde_json::json!("end_turn"));
    assert_eq!(map_finish_reason(Some("length")), serde_json::json!("max_tokens"));
    assert_eq!(map_finish_reason(Some("tool_calls")), serde_json::json!("tool_use"));
    assert_eq!(map_finish_reason(Some("function_call")), serde_json::json!("tool_use"));
    assert_eq!(map_finish_reason(Some("content_filter")), serde_json::json!("end_turn"));
    assert_eq!(map_finish_reason(Some("weird_new_reason")), serde_json::json!("weird_new_reason"));
    assert_eq!(map_finish_reason(None), serde_json::Value::Null);
}

#[test]
fn openai_to_responses_shape() {
    let body = serde_json::json!({"id":"chatcmpl-1","choices":[{"message":{"content":"hi","tool_calls":[{"id":"c1","function":{"name":"f","arguments":"{}"}}]},"finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":5}});
    let out = transform_response(&body, &ctx(ApiFormat::OpenaiResponses, ApiFormat::OpenaiChat)).unwrap();
    assert_eq!(out["id"], "resp_chatcmpl-1");
    assert_eq!(out["status"], "incomplete");
    assert_eq!(out["output"][0]["type"], "message");
    assert_eq!(out["output"][1]["type"], "function_call");
    assert_eq!(out["usage"]["total_tokens"], 8);
}
```

Run: `cargo test -p swixter-proxy --test transform_response`
Expected: FAIL。

- [ ] **Step 3: 实现 response.rs + mod.rs 的 transform_response 分派**

```rust
use serde_json::{json, Map, Value};

/// stop→end_turn、length→max_tokens、tool_calls/function_call→tool_use、
/// content_filter→end_turn、其他直通、null→Null（事实表 §非流式响应）
pub fn map_finish_reason(reason: Option<&str>) -> Value {
    match reason {
        None => Value::Null,
        Some("stop") | Some("content_filter") => json!("end_turn"),
        Some("length") => json!("max_tokens"),
        Some("tool_calls") | Some("function_call") => json!("tool_use"),
        Some(other) => json!(other),
    }
}

pub fn openai_chat_to_anthropic(body: &Value) -> Result<Value, crate::ProxyError> {
    let Some(choice) = body.get("choices").and_then(Value::as_array).and_then(|c| c.first()) else {
        return Ok(body.clone()); // 无 choices → 原样返回
    };
    let message = choice.get("message").cloned().unwrap_or(Value::Null);
    let mut content: Vec<Value> = Vec::new();
    // 1. reasoning_content → thinking block
    // 2. tool_calls → tool_use block（input = JSON.parse(arguments)，parse 失败 → {}）
    // 3. 文本 → text block
    // ...（按事实表展开）
    let id = body.get("id").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| {
        format!("msg_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis())
    });
    // usage: prompt_tokens→input_tokens、completion_tokens→output_tokens、
    // choices[0]...usage.prompt_tokens_details.cached_tokens→cache_read_input_tokens
    Ok(json!({
        "id": id, "type": "message", "role": "assistant",
        "model": body.get("model").cloned().unwrap_or(Value::Null),
        "content": content,
        "stop_reason": map_finish_reason(choice.get("finish_reason").and_then(Value::as_str)),
        "stop_sequence": Value::Null,
        "usage": { "input_tokens": 0, "output_tokens": 0 }, // 实际值按映射填入
    }))
}

pub fn openai_chat_to_openai_responses(body: &Value) -> Result<Value, crate::ProxyError> {
    // 按事实表展开：output 数组（message item + function_call items）、
    // status 由 finish_reason 决定、usage total 缺省 input+output
}
```

注意 TS `cached_tokens` 取自 `usage.prompt_tokens_details.cached_tokens`（OpenAI 实际响应结构），事实表只写 `cached_tokens→cache_read_input_tokens`——实施时以 TS 源码 `response/openai-chat-to-anthropic.ts` 的实际取值路径为准。

mod.rs 追加：

```rust
pub fn transform_response(body: &Value, ctx: &TransformCtx) -> Result<Value, ProxyError> {
    use ApiFormat::*;
    match (ctx.client_format, ctx.target_format) {
        (AnthropicMessages, OpenaiChat) => response::openai_chat_to_anthropic(body),
        (OpenaiResponses, OpenaiChat) => response::openai_chat_to_openai_responses(body),
        _ => Ok(body.clone()),
    }
}
```

- [ ] **Step 4: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-proxy --test transform_response`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/proxy/src/transform/response.rs packages/cli/crates/proxy/src/transform/mod.rs packages/cli/crates/proxy/tests/transform_response.rs packages/cli/crates/proxy/tests/fixtures
git commit -m "feat(rust): non-streaming response transformers with fixtures"
```

---

### Task 7: SSE 流式转换器（两个状态机）

**Files:**
- Create: `packages/cli/crates/proxy/src/transform/streaming.rs`
- Create: `packages/cli/crates/proxy/tests/transform_streaming.rs`
- Create: `packages/cli/crates/proxy/tests/fixtures/sse_*.sse`（2 对 fixture）

**Interfaces:**
- Consumes: `sse::{SseEvent, SseData, SseChunker, serialize_sse_event}`（Task 2）、`response::map_finish_reason`（Task 6）、`TransformCtx`（Task 5）
- Produces:
  - `streaming::SseOut { event: String, data_json: String }`（待序列化的输出事件）
  - `streaming::ChatToAnthropicStream::new() -> Self`、`convert_event(&mut self, ev: &SseEvent) -> Vec<SseOut>`
  - `streaming::ChatToResponsesStream::new() -> Self`、`convert_event(&mut self, ev: &SseEvent) -> Vec<SseOut>`
  - `transform::transform_stream(stream: S, ctx: &TransformCtx) -> Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>`（mod.rs 追加；`S: Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static`）

规则引用：事实表「流式 OpenAI Chat SSE → Anthropic SSE」6 步与「流式 OpenAI Chat SSE → OpenAI Responses SSE」两节逐条对齐。关键状态：
- Chat→Anthropic：`message_started: bool`、`next_block_index: u32`、`open_blocks: Vec<BlockKind>`（Text/Thinking）、`tools: HashMap<u32 /*openai index*/, ToolState>`（`ToolState { block_index, started: bool, last_emitted_args_len: usize }`）、`finished: bool`（finish_reason 只处理一次）。
- Chat→Responses：`created_sent: bool`、`text_item_open: bool`、`tools: HashMap<u32, RespToolState { item_id, call_id, announced: bool, args: String }>`、`usage: Option<Value>`（从尾部 `choices:[]` 的 usage-only chunk 捕获）。
- **`[DONE]`（SseData::Done）两个转换器都丢弃**（返回空 vec）。
- tool_calls 凑齐 id+name 才发 `content_block_start`；arguments 增量用 `last_emitted_args_len` 只发新增片段。
- Responses 方向**刻意忽略** `reasoning_content`。

- [ ] **Step 1: 写 SSE fixtures**

`sse_openai_text.upstream.sse`（手写，每事件一个 block）：

```
data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},"index":0}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hello"},"index":0}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{"content":" world"},"index":0}]}

data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop","index":0}]}

data: [DONE]

```

`sse_openai_text.expected_anthropic.sse`（对应 5 个输出事件）：

```
event: message_start
data: {"type":"message_start","message":{"id":"chatcmpl-1","type":"message","role":"assistant","content":[],"model":"","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}

event: message_stop
data: {"type":"message_stop"}

```

`sse_openai_tools.upstream.sse`：tool_calls 分 3 个 chunk（id+name → arguments 片段 ×2）+ finish_reason:"tool_calls" + 一个坏 JSON 事件（应被解析层丢弃）。expected：tool_use block_start（input `{}`）→ 两次 input_json_delta → block_stop → message_delta(stop_reason tool_use) → message_stop。

（期望 JSON 的字段顺序以实施时的序列化产物为准更新 fixture；测试用「逐事件 data JSON 值相等」而非文本相等，避免 key 顺序脆弱性——见 Step 2。）

- [ ] **Step 2: 写失败测试（tests/transform_streaming.rs）**

```rust
use swixter_proxy::sse::{parse_sse_events, SseData};
use swixter_proxy::transform::streaming::*;

fn upstream_events(name: &str) -> Vec<swixter_proxy::sse::SseEvent> {
    let text = std::fs::read_to_string(format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))).unwrap();
    parse_sse_events(&text)
}

fn run_converter(mut conv: impl FnMut(&swixter_proxy::sse::SseEvent) -> Vec<SseOut>, events: &[swixter_proxy::sse::SseEvent]) -> Vec<(String, serde_json::Value)> {
    events.iter().flat_map(|e| conv(e)).map(|o| (o.event, serde_json::from_str(&o.data_json).unwrap())).collect()
}

#[test]
fn openai_text_to_anthropic_event_sequence() {
    let mut c = ChatToAnthropicStream::new();
    let out = run_converter(|e| c.convert_event(e), &upstream_events("sse_openai_text.upstream.sse"));
    let expected_text = std::fs::read_to_string(format!("{}/tests/fixtures/sse_openai_text.expected_anthropic.sse", env!("CARGO_MANIFEST_DIR"))).unwrap();
    let expected = parse_sse_events(&expected_text);
    assert_eq!(out.len(), expected.len());
    for ((ev, data), exp) in out.iter().zip(expected.iter()) {
        assert_eq!(ev, &exp.event);
        let SseData::Json(exp_data) = &exp.data else { panic!() };
        assert_eq!(data, exp_data);
    }
}

#[test]
fn openai_tools_to_anthropic_incremental_arguments() {
    let mut c = ChatToAnthropicStream::new();
    let out = run_converter(|e| c.convert_event(e), &upstream_events("sse_openai_tools.upstream.sse"));
    // block_start 在 id+name 凑齐的 chunk 才发出；两次 input_json_delta 的 partial_json 拼接 == 完整 arguments
    let deltas: Vec<&serde_json::Value> = out.iter().filter(|(e, _)| e == "content_block_delta")
        .map(|(_, d)| d).collect();
    let joined: String = deltas.iter().filter_map(|d| d.pointer("/delta/partial_json").and_then(|v| v.as_str())).collect();
    assert_eq!(serde_json::from_str::<serde_json::Value>(&joined).unwrap()["city"], "Paris");
    // 只发出一次 message_start / message_stop
    assert_eq!(out.iter().filter(|(e, _)| e == "message_start").count(), 1);
    assert_eq!(out.iter().filter(|(e, _)| e == "message_stop").count(), 1);
}

#[test]
fn done_sentinel_dropped() {
    let mut c = ChatToAnthropicStream::new();
    let ev = swixter_proxy::sse::SseEvent { event: String::new(), data: SseData::Done };
    assert!(c.convert_event(&ev).is_empty());
}

#[test]
fn openai_to_responses_ignores_reasoning_and_captures_usage() {
    let mut c = ChatToResponsesStream::new();
    let events = parse_sse_events(concat!(
        "data: {\"id\":\"c1\",\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"},\"index\":0}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"delta\":{\"content\":\"hi\"},\"index\":0}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\",\"index\":0}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1}}\n\n",
    ));
    let out = run_converter(|e| c.convert_event(e), &events);
    assert!(out.iter().all(|(_, d)| d.get("type").and_then(|t| t.as_str()) != Some("response.reasoning.delta")));
    let completed = out.iter().find(|(_, d)| d["type"] == "response.completed").unwrap();
    assert_eq!(completed.1["response"]["usage"]["input_tokens"], 3);
}
```

Run: `cargo test -p swixter-proxy --test transform_streaming`
Expected: FAIL。

- [ ] **Step 3: 实现 streaming.rs**

骨架 + Chat→Anthropic 关键路径（Responses 版结构相同，事件名按事实表替换；实施时两个都写完整）：

```rust
use std::collections::HashMap;
use serde_json::{json, Value};
use crate::sse::{SseData, SseEvent};
use super::response::map_finish_reason;

pub struct SseOut {
    pub event: String,
    pub data_json: String,
}

fn out(event: &str, data: Value) -> SseOut {
    SseOut { event: event.to_string(), data_json: serde_json::to_string(&data).unwrap() }
}

enum OpenBlock { Text(u32), Thinking(u32) }

struct ToolState {
    block_index: u32,
    id: Option<String>,
    name: Option<String>,
    started: bool,
    last_emitted_args_len: usize,
}

#[derive(Default)]
pub struct ChatToAnthropicStream {
    message_started: bool,
    next_block_index: u32,
    open_blocks: Vec<OpenBlock>,
    tools: HashMap<u32, ToolState>,
    finished: bool,
}

impl ChatToAnthropicStream {
    pub fn new() -> Self { Self::default() }

    /// 返回空 vec = 丢弃事件（含 [DONE]）；事实表 6 步状态机
    pub fn convert_event(&mut self, ev: &SseEvent) -> Vec<SseOut> {
        let SseData::Json(chunk) = &ev.data else { return Vec::new() }; // [DONE] 丢弃
        let Some(choices) = chunk.get("choices").and_then(Value::as_array) else { return Vec::new() };
        let Some(choice) = choices.first() else { return Vec::new() };
        let mut outs = Vec::new();

        // 1. 首个有 choices 的 chunk → message_start
        if !self.message_started {
            self.message_started = true;
            let id = chunk.get("id").and_then(Value::as_str).map(str::to_string)
                .unwrap_or_else(|| format!("msg_{}", now_millis()));
            outs.push(out("message_start", json!({
                "type": "message_start",
                "message": {"id": id, "type": "message", "role": "assistant", "content": [],
                            "model": chunk.get("model").cloned().unwrap_or(json!("")),
                            "stop_reason": null, "stop_sequence": null,
                            "usage": {"input_tokens": 0, "output_tokens": 0}},
            })));
        }

        let delta = choice.get("delta").cloned().unwrap_or(json!({}));

        // 2/3. delta.content / delta.reasoning_content → text / thinking block
        //    首次出现时先 content_block_start（index 递增），每次 content_block_delta
        // 4. delta.tool_calls：按 openai index 映射独立 block index；id+name 凑齐才
        //    content_block_start（tool_use, input:{}）；arguments 用 last_emitted_args_len 只发增量
        //    （input_json_delta.partial_json = 新增片段）
        // ...（按事实表展开）

        // 5. finish_reason（仅一次）：先关所有未关 tool block（content_block_stop），
        //    再关 text/thinking → message_delta(stop_reason 映射同非流式, usage.output_tokens:0) → message_stop
        if !self.finished {
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                self.finished = true;
                // ... close blocks ...
                outs.push(out("message_delta", json!({
                    "type": "message_delta",
                    "delta": {"stop_reason": map_finish_reason(Some(reason)), "stop_sequence": null},
                    "usage": {"output_tokens": 0},
                })));
                outs.push(out("message_stop", json!({"type": "message_stop"})));
            }
        }
        outs
    }
}

/// 事实表「流式 OpenAI Chat SSE → OpenAI Responses SSE」：
/// 首 chunk → response.created；文本 output_item/content_part added + output_text.delta；
/// **reasoning_content 刻意忽略**；工具按 index 建 ToolState（fc_<idx>，callId 取 tc.id）；
/// finish_reason → output_text.done/content_part.done/output_item.done +
/// function_call_arguments.done + response.completed（usage 从尾部 choices:[] chunk 捕获）
#[derive(Default)]
pub struct ChatToResponsesStream { /* created_sent, text_item_open, tools, usage */ }

impl ChatToResponsesStream {
    pub fn new() -> Self { Self::default() }
    pub fn convert_event(&mut self, ev: &SseEvent) -> Vec<SseOut> { /* 按事实表展开 */ }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis()
}
```

mod.rs 追加 `transform_stream`：

```rust
pub fn transform_stream<S>(stream: S, ctx: &TransformCtx) -> std::pin::Pin<Box<dyn futures::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send>>
where
    S: futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + 'static,
{
    use futures::StreamExt;
    let mut chunker = crate::sse::SseChunker::new();
    let mut converter: Box<dyn FnMut(&crate::sse::SseEvent) -> Vec<streaming::SseOut> + Send> = match (ctx.client_format, ctx.target_format) {
        (ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat) => {
            let mut c = streaming::ChatToAnthropicStream::new();
            Box::new(move |ev| c.convert_event(ev))
        }
        (ApiFormat::OpenaiResponses, ApiFormat::OpenaiChat) => {
            let mut c = streaming::ChatToResponsesStream::new();
            Box::new(move |ev| c.convert_event(ev))
        }
        _ => unreachable!("transform_stream 只在 has_transformer 为真时调用"),
    };
    let out = stream.filter_map(move |item| {
        let text = match item {
            Ok(bytes) => {
                let events = chunker.feed(&bytes);
                events.iter().flat_map(|e| converter(e))
                    .map(|o| crate::sse::serialize_sse_event(&o.event, &o.data_json))
                    .collect::<String>()
            }
            Err(e) => return futures::future::ready(Some(Err(std::io::Error::new(std::io::ErrorKind::Other, e)))),
        };
        futures::future::ready(if text.is_empty() { None } else { Some(Ok(bytes::Bytes::from(text))) })
    });
    Box::pin(out)
}
```

（上游流结束时 `chunker.flush()` 的残余事件：用 `stream.chain(futures::stream::once(...))` 追加一个 flush 产出；实施时处理。）

- [ ] **Step 4: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-proxy --test transform_streaming`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/cli/crates/proxy/src/transform/streaming.rs packages/cli/crates/proxy/src/transform/mod.rs packages/cli/crates/proxy/tests/transform_streaming.rs packages/cli/crates/proxy/tests/fixtures
git commit -m "feat(rust): SSE streaming transformers (chat→anthropic, chat→responses)"
```

---

### Task 8: 实例注册表 + JSONL 日志 + 事件总线占位

**Files:**
- Create: `packages/cli/crates/proxy/src/registry.rs`
- Create: `packages/cli/crates/proxy/src/logger.rs`
- Create: `packages/cli/crates/proxy/src/events.rs`
- Test: `packages/cli/crates/proxy/src/registry.rs`、`logger.rs`（内联 `#[cfg(test)]`）

**Interfaces:**
- Consumes: `types::ProxyStatus`（Task 1）、`swixter_core::paths::config_path`（M1）、`swixter_core::types::now_iso`（M1 已有，ISO8601 时间戳）
- Produces:
  - `registry::registry_path() -> PathBuf`（config 同目录 `proxy-instances.json`）
  - `registry::InstanceRegistry { instances: HashMap<String, ProxyStatus> }`
  - `registry::load_registry() -> InstanceRegistry`（文件不存在/损坏 → 空）
  - `registry::save_registry(&InstanceRegistry)`（2 空格缩进，先建目录）
  - `registry::update_instance(status: &ProxyStatus)`、`registry::remove_instance(id: &str)`
  - `registry::clean_stale_instances()`（`running && !is_process_alive(pid)` 的条目删除）
  - `registry::migrate_legacy_runtime()`（`proxy-runtime.json` 一次性迁移，registry 已存在则跳过）
  - `registry::get_proxy_status(id: &str) -> ProxyStatus`（迁移+清理后查 registry；未找到返回 `running:false` 占位）
  - `registry::list_proxy_instances() -> Vec<ProxyStatus>`
  - `registry::is_process_alive(pid: u32) -> bool`
  - `registry::terminate_process(pid: u32)`（Unix SIGTERM→≤5s 轮询→SIGKILL；Windows TerminateProcess）
  - `logger::proxy_log_path(instance_id: &str) -> PathBuf`（config 同目录 `proxy-<instanceId>.log`）
  - `logger::ProxyLogger::new(instance_id: &str) -> Self`、`info/warn/error/request(...)`（写失败静默）
  - `events::ProxyEvent { InstanceStart(ProxyStatus), InstanceStop(String), StatusUpdate(ProxyStatus), Log { instance_id: String, entry: serde_json::Value } }`
  - `events::event_bus() -> &'static broadcast::Sender<ProxyEvent>`（容量 256；无订阅者时 send 失败忽略）

- [ ] **Step 1: 写失败测试（registry.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{InstanceKind, ProxyStatus};

    fn status(id: &str, pid: Option<u32>) -> ProxyStatus {
        ProxyStatus { instance_id: id.into(), kind: InstanceKind::Service, running: true,
                      host: "127.0.0.1".into(), port: 15721, pid,
                      start_time: Some("2026-07-24T01:00:00.000Z".into()), ..Default::default() }
    }

    #[test]
    fn registry_roundtrip_and_remove() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
        update_instance(&status("default", Some(std::process::id())));
        let list = list_proxy_instances();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].instance_id, "default");
        // JSON 格式与 TS 一致：camelCase + 2 空格缩进
        let raw = std::fs::read_to_string(registry_path()).unwrap();
        assert!(raw.contains("\n  \"instances\": {"));
        assert!(raw.contains("\"instanceId\": \"default\""));
        remove_instance("default");
        assert!(list_proxy_instances().is_empty());
    }

    #[test]
    fn stale_entries_cleaned_by_pid_liveness() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
        update_instance(&status("alive", Some(std::process::id())));
        update_instance(&status("dead", Some(4_000_000))); // 几乎不可能存活的 pid
        clean_stale_instances();
        let list = list_proxy_instances();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].instance_id, "alive");
    }

    #[test]
    fn legacy_runtime_migrated_once() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("proxy-runtime.json");
        std::fs::write(&legacy, r#"{"running":true,"host":"127.0.0.1","port":15721,"pid":4000000}"#).unwrap();
        let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
        migrate_legacy_runtime();
        let s = get_proxy_status("default");
        assert_eq!(s.port, 15721);
        // registry 已存在后不再重复迁移
        remove_instance("default");
        migrate_legacy_runtime();
        assert!(list_proxy_instances().is_empty());
    }

    #[test]
    fn corrupt_registry_falls_back_to_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy-instances.json");
        std::fs::write(&path, "{not json").unwrap();
        let _guard = RegistryPathOverride::set(path);
        assert!(list_proxy_instances().is_empty());
    }

    #[test]
    fn current_process_is_alive() {
        assert!(is_process_alive(std::process::id()));
        assert!(!is_process_alive(4_000_000));
    }
}
```

（`RegistryPathOverride`：测试用的路径注入 guard——`registry_path()` 读一个 `thread_local`/`OnceLock<RwLock<Option<PathBuf>>>` 覆盖值，避免并行测试污染真实配置目录；实施时可用 `serial` 测试或互斥锁保护。）

Run: `cargo test -p swixter-proxy registry`
Expected: FAIL。

- [ ] **Step 2: 实现 registry.rs**

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

use crate::types::{InstanceKind, ProxyStatus};
use crate::{DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InstanceRegistry {
    pub instances: HashMap<String, ProxyStatus>,
}

pub fn registry_path() -> PathBuf {
    // 测试覆盖值优先（见 Step 1 注释），否则 config 同目录
    if let Some(p) = path_override() { return p; }
    swixter_core::paths::config_path().parent().unwrap().join("proxy-instances.json")
}

fn legacy_runtime_path() -> PathBuf {
    registry_path().parent().unwrap().join("proxy-runtime.json")
}

pub fn load_registry() -> InstanceRegistry {
    std::fs::read_to_string(registry_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_registry(registry: &InstanceRegistry) -> std::io::Result<()> {
    let path = registry_path();
    if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
    std::fs::write(path, serde_json::to_string_pretty(registry)?)
}

pub fn update_instance(status: &ProxyStatus) {
    let mut r = load_registry();
    r.instances.insert(status.instance_id.clone(), status.clone());
    let _ = save_registry(&r);
}

pub fn remove_instance(instance_id: &str) {
    let mut r = load_registry();
    if r.instances.remove(instance_id).is_some() { let _ = save_registry(&r); }
}

pub fn clean_stale_instances() {
    let mut r = load_registry();
    let before = r.instances.len();
    r.instances.retain(|_, s| !(s.running && !is_process_alive(s.pid.unwrap_or(0))));
    if r.instances.len() != before { let _ = save_registry(&r); }
}

/// TS: migrateLegacyRuntime —— 旧格式 proxy-runtime.json 一次性迁移；registry 已存在则跳过
pub fn migrate_legacy_runtime() {
    let legacy = legacy_runtime_path();
    if !legacy.exists() || registry_path().exists() { return; }
    if let Ok(mut status) = std::fs::read_to_string(&legacy)
        .map(|raw| serde_json::from_str::<ProxyStatus>(&raw))
    {
        if let Ok(mut s) = status {
            if s.running {
                s.instance_id = "default".into();
                s.kind = InstanceKind::Service;
                let mut r = InstanceRegistry::default();
                r.instances.insert("default".into(), s);
                let _ = save_registry(&r);
            }
        }
    }
}

pub fn get_proxy_status(instance_id: &str) -> ProxyStatus {
    migrate_legacy_runtime();
    clean_stale_instances();
    load_registry().instances.get(instance_id).cloned().unwrap_or_else(|| ProxyStatus {
        instance_id: instance_id.to_string(),
        host: DEFAULT_PROXY_HOST.into(),
        port: DEFAULT_PROXY_PORT,
        ..Default::default()
    })
}

pub fn list_proxy_instances() -> Vec<ProxyStatus> {
    migrate_legacy_runtime();
    clean_stale_instances();
    load_registry().instances.into_values().collect()
}

#[cfg(unix)]
pub fn is_process_alive(pid: u32) -> bool {
    if pid == 0 { return false; }
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
pub fn is_process_alive(pid: u32) -> bool {
    use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if h.is_null() { return false; }
    unsafe { windows_sys::Win32::Foundation::CloseHandle(h); }
    true
}

/// 决策点 3：Unix SIGTERM → ≤5s 轮询 → SIGKILL；Windows 无 SIGTERM，直接 TerminateProcess
#[cfg(unix)]
pub fn terminate_process(pid: u32) {
    unsafe { libc::kill(pid as i32, libc::SIGTERM); }
    for _ in 0..50 {
        if !is_process_alive(pid) { return; }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if is_process_alive(pid) {
        unsafe { libc::kill(pid as i32, libc::SIGKILL); }
    }
}

#[cfg(windows)]
pub fn terminate_process(pid: u32) {
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    let h = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if !h.is_null() {
        unsafe { TerminateProcess(h, 1); windows_sys::Win32::Foundation::CloseHandle(h); }
    }
}
```

注意旧格式迁移的 serde 细节：`proxy-runtime.json` 缺 `instanceId`/`type` 字段，`ProxyStatus` 的 `#[serde(default)]` 会补默认（InstanceKind::Service），之后强制覆盖 `instance_id = "default"`，与 TS 一致。

- [ ] **Step 3: 写 logger 失败测试（logger.rs 内联）**

```rust
#[test]
fn jsonl_fields_and_silent_failure() {
    let dir = tempfile::tempdir().unwrap();
    let _guard = LogPathOverride::set(dir.path());
    let log = ProxyLogger::new("default");
    log.info("hello", Some(serde_json::json!({"k": 1})));
    log.request("POST", "/v1/messages", 200, 42);
    let lines: Vec<serde_json::Value> = std::fs::read_to_string(proxy_log_path("default")).unwrap()
        .lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!(lines[0]["level"], "info");
    assert_eq!(lines[0]["msg"], "hello");
    assert_eq!(lines[0]["instanceId"], "default");
    assert_eq!(lines[0]["k"], 1);
    assert!(lines[0]["ts"].is_string());
    assert_eq!(lines[1]["level"], "access");
    assert_eq!(lines[1]["method"], "POST");
    assert_eq!(lines[1]["status"], 200);
    assert_eq!(lines[1]["durationMs"], 42);
    // 写失败静默：目录删除后调用不 panic
    std::fs::remove_dir_all(dir.path()).unwrap();
    log.info("gone", None);
}

#[test]
fn rotates_at_size_limit_single_generation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("proxy-default.log");
    std::fs::write(&path, "x".repeat(1024)).unwrap();
    std::fs::write(dir.path().join("proxy-default.log.1"), "old".as_bytes()).unwrap();
    rotate_if_needed(&path, 1024); // 内部函数以可测的小阈值调用
    assert!(!path.exists());
    assert_eq!(std::fs::read(dir.path().join("proxy-default.log.1")).unwrap().len(), 1024);
}
```

- [ ] **Step 4: 实现 logger.rs**

```rust
use serde_json::{json, Value};
use std::path::PathBuf;

use crate::MAX_PROXY_LOG_SIZE_BYTES;

pub fn proxy_log_path(instance_id: &str) -> PathBuf {
    // 测试覆盖值优先，否则 config 同目录
    if let Some(dir) = log_dir_override() { return dir.join(format!("proxy-{instance_id}.log")); }
    swixter_core::paths::config_path().parent().unwrap().join(format!("proxy-{instance_id}.log"))
}

/// 单代滚动：超过阈值 → 删 .1 → rename 为 .1（TS rotateProxyLogIfNeeded）
fn rotate_if_needed(path: &std::path::Path, max_size: u64) {
    let Ok(meta) = std::fs::metadata(path) else { return };
    if meta.len() < max_size { return; }
    let rotated = path.with_file_name(format!("{}.1", path.file_name().unwrap().to_string_lossy()));
    let _ = std::fs::remove_file(&rotated);
    let _ = std::fs::rename(path, rotated);
}

#[derive(Clone)]
pub struct ProxyLogger {
    instance_id: String,
}

impl ProxyLogger {
    pub fn new(instance_id: &str) -> Self {
        Self { instance_id: instance_id.to_string() }
    }

    pub fn info(&self, msg: &str, meta: Option<Value>) { self.write("info", json!({"msg": msg}), meta); }
    pub fn warn(&self, msg: &str, meta: Option<Value>) { self.write("warn", json!({"msg": msg}), meta); }
    pub fn error(&self, msg: &str, err: Option<&dyn std::error::Error>, meta: Option<Value>) {
        let mut rec = json!({"msg": msg});
        if let Some(e) = err { rec["error"] = json!(e.to_string()); }
        self.write("error", rec, meta);
    }
    pub fn request(&self, method: &str, path: &str, status: u16, duration_ms: u64) {
        self.write("access", json!({"method": method, "path": path, "status": status, "durationMs": duration_ms}), None);
    }

    fn write(&self, level: &str, mut record: Value, meta: Option<Value>) {
        // 日志绝不能中断代理流程：所有失败静默（TS writeProxyLog catch{}）
        let obj = record.as_object_mut().unwrap();
        obj.insert("ts".into(), json!(swixter_core::types::now_iso()));
        obj.insert("level".into(), json!(level));
        obj.insert("instanceId".into(), json!(self.instance_id));
        if let Some(Value::Object(m)) = meta { obj.extend(m); }
        let path = proxy_log_path(&self.instance_id);
        let _ = (|| -> std::io::Result<()> {
            if let Some(dir) = path.parent() { std::fs::create_dir_all(dir)?; }
            rotate_if_needed(&path, MAX_PROXY_LOG_SIZE_BYTES);
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path)?;
            writeln!(f, "{}", serde_json::to_string(&record).unwrap())?;
            Ok(())
        })();
        let _ = crate::events::event_bus().send(crate::events::ProxyEvent::Log {
            instance_id: self.instance_id.clone(),
            entry: record,
        }); // 无订阅者 → Err，忽略（决策点 2）
    }
}
```

- [ ] **Step 5: 实现 events.rs**

```rust
use serde_json::Value;
use std::sync::OnceLock;
use tokio::sync::broadcast;

use crate::types::ProxyStatus;

/// M3 WebSocket 广播将 subscribe() 此总线（决策点 2）
#[derive(Clone, Debug)]
pub enum ProxyEvent {
    InstanceStart(ProxyStatus),
    InstanceStop(String),
    StatusUpdate(ProxyStatus),
    Log { instance_id: String, entry: Value },
}

static BUS: OnceLock<broadcast::Sender<ProxyEvent>> = OnceLock::new();

pub fn event_bus() -> &'static broadcast::Sender<ProxyEvent> {
    BUS.get_or_init(|| broadcast::channel(256).0)
}
```

- [ ] **Step 6: 跑测试**

Run: `cd packages/cli && cargo test -p swixter-proxy registry logger`
Expected: 全部 PASS。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/crates/proxy/src/registry.rs packages/cli/crates/proxy/src/logger.rs packages/cli/crates/proxy/src/events.rs
git commit -m "feat(rust): proxy instance registry, JSONL logger, event bus placeholder"
```

---

### Task 9: Handler + axum server（鉴权/单 profile/model 改写/group 故障转移）

**Files:**
- Create: `packages/cli/crates/proxy/src/model.rs`
- Create: `packages/cli/crates/proxy/src/handler.rs`
- Create: `packages/cli/crates/proxy/src/server.rs`
- Test: `packages/cli/crates/proxy/src/model.rs`（内联）、`packages/cli/crates/proxy/tests/server_integration.rs`

**Interfaces:**
- Consumes: 全部前序任务 + `swixter_core::{config::ConfigManager, groups::find_by_name, presets::find_provider}`（M1）
- Produces:
  - `model::is_swixter_claude_proxy_marker(model: &str) -> bool`
  - `model::resolve_swixter_claude_proxy_marker(model: &str, profile: &Profile) -> Option<String>`
  - `model::general_proxy_model(profile: &Profile) -> Option<String>`
  - `model::rewrite_request_body_for_profile(body: &Bytes, profile: &Profile) -> Bytes`
  - `handler::HandlerBody { Full(Bytes), Stream(Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>) }`
  - `handler::HandlerResponse { status: u16, headers: HeaderMap, body: HandlerBody }`
  - `handler::ProxyHandler::new(config: &ProxyServerConfig) -> Self`
  - `handler::ProxyHandler::handle(&self, method: &str, path_and_query: &str, headers: &HeaderMap, body: &Bytes) -> HandlerResponse`
  - `handler::ProxyHandler::status(&self) -> Arc<std::sync::RwLock<ProxyStatus>>`（request/error 计数共享）
  - `server::start_proxy_server(config: ProxyServerConfig) -> Result<ProxyStatus, ProxyError>`
  - `server::stop_in_process_instance(instance_id: &str) -> bool`
  - `server::health_check(host: &str, port: u16) -> bool`（CLI daemon 轮询用）

行为规则（事实表 §端点/§model 改写/§Group 故障转移，与 TS `handler.ts` 逐段对齐）：
- 路由匹配顺序：`POST /v1/chat/completions`、`POST /v1/messages`、`POST /v1/responses`、任意方法 `/anthropic/*`、`GET /health`；未匹配 404 纯文本。
- 鉴权：除 `/health` 外必须 `Authorization: Bearer swixter-local-proxy`，失败 `401 {"error":"Invalid or missing proxy authentication"}`。
- health：`{status:"ok",instanceId,groupName,timestamp,uptime}`（uptime 秒，进程启动起算）。
- 错误形状（逐字）：无 group/profile `503 {"error":"No active group or profiles"}`；profile 找不到 `503 {"error":"Profile not found: <name>"}`；body 读取失败 `400`；单 profile 上游异常 `502 {"error":<msg>}`；group 全失败回传**最后一个上游失败响应**（status+headers+body 原样），若无则 `503 {"error":"All providers failed","details":[...]}`；未捕获异常 `500` 纯文本 `Internal Server Error`。
- model 改写（transform 后、转发前）：body.model 是 marker → 按 models 配置解析（HAIKU→`defaultHaikuModel||anthropicModel||model`，SONNET→`defaultSonnetModel||anthropicModel||model`，OPUS→`defaultOpusModel||anthropicModel||model`，主 marker→`anthropicModel||model`），解析不出 → 原样透传；非 marker 且 profile 有 general model（`anthropicModel||model`）→ **强制覆盖**；其余原样；JSON 解析失败或非对象 → 原样。
- group 故障转移（顺序遍历 `group.profiles`）：① 熔断 open 跳过；② profile 不存在跳过；③ 格式不同且无转换器跳过；④ transform 请求（失败回退透传原 body+原 endpoint）；⑤ model 改写；⑥ 转发。非 2xx →（5xx/429 则 `record_failure`）记录 `lastFailureResponse` 并 continue；异常 → `record_failure` + continue；2xx → `record_success`，响应 transform（失败回退原始 body）后返回。单 profile 模式非 2xx 原样返回，无转移。
- 每请求重新 load 配置（Global Constraints）；group 解析：`config.groups[id_or_name]` 或按 name 查找（对齐 TS `getGroup`）；active group = `config.active_group` 对应条目（对齐 TS `getActiveGroup`）。

- [ ] **Step 1: 写 model.rs 失败测试（内联）**

```rust
#[test]
fn marker_resolution_priority() {
    let p = Profile { models: Some(ModelsConfig {
        anthropic_model: Some("main".into()), default_haiku_model: Some("h".into()),
        default_sonnet_model: None, default_opus_model: None }), model: Some("fallback".into()), ..Default::default() };
    assert_eq!(resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_MODEL, &p).as_deref(), Some("main"));
    assert_eq!(resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_HAIKU_MODEL, &p).as_deref(), Some("h"));
    assert_eq!(resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_SONNET_MODEL, &p).as_deref(), Some("main")); // sonnet 缺 → anthropicModel
    let p2 = Profile { model: Some("m".into()), ..Default::default() };
    assert_eq!(resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_HAIKU_MODEL, &p2).as_deref(), Some("m")); // 全缺 → model
}

#[test]
fn rewrite_marker_and_forced_override() {
    let p = Profile { models: Some(ModelsConfig { anthropic_model: Some("real-model".into()), ..Default::default() }), ..Default::default() };
    let body = Bytes::from(r#"{"model":"SWIXTER_CLAUDE_MODEL","messages":[]}"#);
    let out = rewrite_request_body_for_profile(&body, &p);
    assert_eq!(serde_json::from_slice::<Value>(&out).unwrap()["model"], "real-model");
    // 非 marker → 强制覆盖
    let body2 = Bytes::from(r#"{"model":"claude-3-5-sonnet","messages":[]}"#);
    let out2 = rewrite_request_body_for_profile(&body2, &p);
    assert_eq!(serde_json::from_slice::<Value>(&out2).unwrap()["model"], "real-model");
    // 无 general model → 原样；坏 JSON → 原样
    let p3 = Profile::default();
    assert_eq!(rewrite_request_body_for_profile(&body2, &p3), body2);
    let bad = Bytes::from("{bad");
    assert_eq!(rewrite_request_body_for_profile(&bad, &p), bad);
}
```

Run: `cargo test -p swixter-proxy model`
Expected: FAIL。

- [ ] **Step 2: 实现 model.rs**

```rust
use bytes::Bytes;
use serde_json::Value;
use swixter_core::types::Profile;

use crate::{SWIXTER_CLAUDE_HAIKU_MODEL, SWIXTER_CLAUDE_MODEL, SWIXTER_CLAUDE_OPUS_MODEL, SWIXTER_CLAUDE_SONNET_MODEL};

pub fn is_swixter_claude_proxy_marker(model: &str) -> bool {
    matches!(model, SWIXTER_CLAUDE_MODEL | SWIXTER_CLAUDE_HAIKU_MODEL | SWIXTER_CLAUDE_SONNET_MODEL | SWIXTER_CLAUDE_OPUS_MODEL)
}

/// TS: resolveSwixterClaudeProxyMarker（事实表 §model 改写）
pub fn resolve_swixter_claude_proxy_marker(model: &str, profile: &Profile) -> Option<String> {
    let models = profile.models.as_ref();
    let anthropic = models.and_then(|m| m.anthropic_model.as_deref());
    let resolved = match model {
        SWIXTER_CLAUDE_MODEL => anthropic.or(profile.model.as_deref()),
        SWIXTER_CLAUDE_HAIKU_MODEL => models.and_then(|m| m.default_haiku_model.as_deref()).or(anthropic).or(profile.model.as_deref()),
        SWIXTER_CLAUDE_SONNET_MODEL => models.and_then(|m| m.default_sonnet_model.as_deref()).or(anthropic).or(profile.model.as_deref()),
        SWIXTER_CLAUDE_OPUS_MODEL => models.and_then(|m| m.default_opus_model.as_deref()).or(anthropic).or(profile.model.as_deref()),
        _ => return None,
    };
    resolved.filter(|s| !s.is_empty()).map(str::to_string)
}

/// TS: getGeneralProxyModel = models?.anthropicModel || model
pub fn general_proxy_model(profile: &Profile) -> Option<String> {
    profile.models.as_ref().and_then(|m| m.anthropic_model.as_deref())
        .or(profile.model.as_deref())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// TS: rewriteRequestBodyForProfile —— marker 解析失败/坏 JSON/非对象 → 原样透传（Global Constraints 已知偏差）
pub fn rewrite_request_body_for_profile(body: &Bytes, profile: &Profile) -> Bytes {
    let Ok(mut parsed) = serde_json::from_slice::<Value>(body) else { return body.clone() };
    let Some(obj) = parsed.as_object_mut() else { return body.clone() };
    let current = obj.get("model").and_then(Value::as_str).unwrap_or("");
    let replacement = if is_swixter_claude_proxy_marker(current) {
        resolve_swixter_claude_proxy_marker(current, profile)
    } else {
        general_proxy_model(profile)
    };
    let Some(new_model) = replacement else { return body.clone() };
    obj.insert("model".into(), Value::String(new_model));
    Bytes::from(serde_json::to_vec(&parsed).unwrap())
}
```

- [ ] **Step 3: 写 handler/server 集成失败测试（tests/server_integration.rs）**

helper：在临时目录写 config.json（profile base_url 指向 mock upstream），构造 `ProxyServerConfig { config_path: Some(...), ... }`。

```rust
mod common;
use common::MockUpstream;
use bytes::Bytes;
use reqwest::header::{HeaderMap, HeaderValue};
use swixter_proxy::handler::ProxyHandler;
use swixter_proxy::types::{InstanceKind, ProxyServerConfig};

fn write_config(dir: &std::path::Path, config: serde_json::Value) -> std::path::PathBuf {
    let path = dir.join("config.json");
    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
    path
}

fn handler_config(config_path: std::path::Path, group: Option<&str>, profile: Option<&str>) -> ProxyServerConfig {
    ProxyServerConfig { instance_id: "test".into(), kind: InstanceKind::Service,
        host: "127.0.0.1".into(), port: 0, timeout: std::time::Duration::from_secs(5),
        group_name: group.map(Into::into), profile_name: profile.map(Into::into),
        config_path: Some(config_path) }
}

fn bearer() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert("authorization", HeaderValue::from_static("Bearer swixter-local-proxy"));
    h
}

#[tokio::test]
async fn auth_required_except_health() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = write_config(dir.path(), serde_json::json!({"version":"2.0.0","profiles":{},"coders":{},"groups":{}}));
    let h = ProxyHandler::new(&handler_config(cfg, None, Some("p1")));
    let resp = h.handle("POST", "/v1/messages", &HeaderMap::new(), &Bytes::from("{}")).await;
    assert_eq!(resp.status, 401);
    let health = h.handle("GET", "/health", &HeaderMap::new(), &Bytes::new()).await;
    assert_eq!(health.status, 200); // 免鉴权
    let not_found = h.handle("POST", "/nope", &bearer(), &Bytes::from("{}")).await;
    assert_eq!(not_found.status, 404);
}

#[tokio::test]
async fn single_profile_passthrough_and_upstream_error() {
    let mock = MockUpstream::start(|| (axum::http::StatusCode::OK, "application/json".into(), axum::body::Body::from(r#"{"ok":true}"#))).await;
    let dir = tempfile::tempdir().unwrap();
    let cfg = write_config(dir.path(), serde_json::json!({
        "version":"2.0.0","coders":{},"groups":{},
        "profiles":{"p1":{"name":"p1","providerId":"custom","apiKey":"sk","baseURL":mock.base_url,"createdAt":"t","updatedAt":"t"}}
    }));
    let h = ProxyHandler::new(&handler_config(cfg, None, Some("p1")));
    let resp = h.handle("POST", "/v1/chat/completions", &bearer(), &Bytes::from(r#"{"model":"m"}"#)).await;
    assert_eq!(resp.status, 200);
    // 非 2xx 原样返回（单 profile 无转移）：换 mock 为 400 再断言
}

#[tokio::test]
async fn group_failover_skips_open_circuit_and_returns_second() {
    let bad = MockUpstream::start(|| (axum::http::StatusCode::INTERNAL_SERVER_ERROR, "application/json".into(), axum::body::Body::from(r#"{"err":"a"}"#))).await;
    let good = MockUpstream::start(|| (axum::http::StatusCode::OK, "application/json".into(), axum::body::Body::from(r#"{"from":"b"}"#))).await;
    let dir = tempfile::tempdir().unwrap();
    let cfg = write_config(dir.path(), serde_json::json!({
        "version":"2.0.0","coders":{},
        "profiles":{
            "a":{"name":"a","providerId":"custom","apiKey":"k","baseURL":bad.base_url,"createdAt":"t","updatedAt":"t"},
            "b":{"name":"b","providerId":"custom","apiKey":"k","baseURL":good.base_url,"createdAt":"t","updatedAt":"t"}
        },
        "groups":{"g1":{"id":"g1","name":"g","profiles":["a","b"],"isDefault":true,"createdAt":"t","updatedAt":"t"}},
        "activeGroup":"g1"
    }));
    let h = ProxyHandler::new(&handler_config(cfg, Some("g"), None));
    // 连续 4 次请求：前 3 次都失败转移到 b 成功（a 累计 3 次熔断），第 4 次 a 被熔断跳过（bad mock 请求数保持 3）
    for _ in 0..4 {
        let resp = h.handle("POST", "/v1/chat/completions", &bearer(), &Bytes::from(r#"{"model":"m"}"#)).await;
        assert_eq!(resp.status, 200);
    }
    assert_eq!(bad.recorded.lock().unwrap().len(), 3);
    assert_eq!(good.recorded.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn group_all_failed_returns_last_upstream_response() {
    let bad = MockUpstream::start(|| (axum::http::StatusCode::TOO_MANY_REQUESTS, "application/json".into(), axum::body::Body::from(r#"{"err":"rate"}"#))).await;
    let bad2 = MockUpstream::start(|| (axum::http::StatusCode::BAD_GATEWAY, "application/json".into(), axum::body::Body::from(r#"{"err":"b2"}"#))).await;
    // group profiles ["a","b"] 全失败 → 返回最后一个（502 + {"err":"b2"}）
    // ...
}

#[tokio::test]
async fn streaming_transform_end_to_end() {
    // mock upstream 返回 OpenAI SSE（fixture sse_openai_text.upstream.sse 内容），
    // client 走 /v1/messages（anthropic）→ 断言响应 content-type 原样透传、
    // 事件序列含 message_start/content_block_delta/message_stop
}

#[tokio::test]
async fn model_rewrite_forced_override_reaches_upstream() {
    // profile 配 models.anthropicModel="real" → mock 录制到 body.model=="real"
}

#[tokio::test]
async fn server_binds_and_health_works() {
    // start_proxy_server(port: 0 → 由调用方传可用端口；测试先占用探测一个空闲端口)
    // → GET /health 200；registry 写入实例；stop_in_process_instance → registry 移除
}
```

Run: `cargo test -p swixter-proxy --test server_integration`
Expected: FAIL。

- [ ] **Step 4: 实现 handler.rs**

```rust
use bytes::Bytes;
use reqwest::header::HeaderMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use futures::Stream;
use serde_json::{json, Value};
use std::pin::Pin;
use swixter_core::config::ConfigManager;
use swixter_core::types::{Group, Profile};

use crate::breaker::CircuitBreaker;
use crate::forwarder::{ForwardBody, ForwardRequest, Forwarder};
use crate::logger::ProxyLogger;
use crate::transform;
use crate::types::{ProxyServerConfig, ProxyStatus};
use crate::{DEFAULT_TIMEOUT_MS, SWIXTER_PROXY_AUTH_TOKEN};

pub enum HandlerBody {
    Full(Bytes),
    Stream(Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>),
}

pub struct HandlerResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: HandlerBody,
}

impl HandlerResponse {
    fn json(status: u16, body: Value) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", "application/json".parse().unwrap());
        Self { status, headers, body: HandlerBody::Full(Bytes::from(serde_json::to_vec(&body).unwrap())) }
    }
    fn text(status: u16, body: &'static str) -> Self {
        Self { status, headers: HeaderMap::new(), body: HandlerBody::Full(Bytes::from(body)) }
    }
}

pub struct ProxyHandler {
    timeout: Duration,
    instance_id: String,
    group_name: Option<String>,
    profile_name: Option<String>,
    config_path: Option<std::path::PathBuf>,
    breaker: CircuitBreaker,
    forwarder: Forwarder,
    logger: ProxyLogger,
    started: Instant,
    status: Arc<RwLock<ProxyStatus>>,
}

impl ProxyHandler {
    pub fn new(config: &ProxyServerConfig) -> Self {
        Self {
            timeout: config.timeout,
            instance_id: config.instance_id.clone(),
            group_name: config.group_name.clone(),
            profile_name: config.profile_name.clone(),
            config_path: config.config_path.clone(),
            breaker: CircuitBreaker::new(),
            forwarder: Forwarder::new(),
            logger: ProxyLogger::new(&config.instance_id),
            started: Instant::now(),
            status: Arc::new(RwLock::new(ProxyStatus {
                instance_id: config.instance_id.clone(),
                kind: config.kind,
                running: true,
                host: config.host.clone(),
                port: config.port,
                group_name: config.group_name.clone(),
                active_group: config.group_name.clone(),
                profile_name: config.profile_name.clone(),
                pid: Some(std::process::id()),
                start_time: Some(swixter_core::types::now_iso()),
                ..Default::default()
            })),
        }
    }

    pub fn status(&self) -> Arc<RwLock<ProxyStatus>> { self.status.clone() }

    fn load_config(&self) -> ConfigManager {
        match &self.config_path {
            Some(p) => ConfigManager::load_from(p.clone()),
            None => ConfigManager::load(),
        }
    }

    /// TS: ProxyHandler.handleRequest（鉴权 + 路由 + 日志 + 500 兜底）
    pub async fn handle(&self, method: &str, path_and_query: &str, headers: &HeaderMap, body: &Bytes) -> HandlerResponse {
        let start = Instant::now();
        let path = path_and_query.split('?').next().unwrap_or(path_and_query);

        let resp = self.handle_inner(method, path, path_and_query, headers, body).await;
        let ms = start.elapsed().as_millis() as u64;
        self.logger.request(method, path, resp.status, ms);
        {
            let mut s = self.status.write().unwrap();
            s.request_count += 1;
            if resp.status >= 500 { s.error_count += 1; }
        }
        let _ = crate::events::event_bus().send(crate::events::ProxyEvent::StatusUpdate(self.status.read().unwrap().clone()));
        resp
    }

    async fn handle_inner(&self, method: &str, path: &str, path_and_query: &str, headers: &HeaderMap, body: &Bytes) -> HandlerResponse {
        // 鉴权：除 /health 外必须 Bearer swixter-local-proxy
        if path != "/health" {
            let ok = headers.get("authorization").and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                == Some(SWIXTER_PROXY_AUTH_TOKEN);
            if !ok {
                return HandlerResponse::json(401, json!({"error": "Invalid or missing proxy authentication"}));
            }
        }

        // 路由（注册顺序匹配；/anthropic/* 任意方法）
        let is_api_route = matches!((method, path),
            ("POST", "/v1/chat/completions") | ("POST", "/v1/messages") | ("POST", "/v1/responses"))
            || path.starts_with("/anthropic/");
        if method == "GET" && path == "/health" {
            return HandlerResponse::json(200, json!({
                "status": "ok",
                "instanceId": self.instance_id,
                "groupName": self.group_name,
                "timestamp": swixter_core::types::now_iso(),
                "uptime": self.started.elapsed().as_secs_f64(),
            }));
        }
        if !is_api_route {
            return HandlerResponse::text(404, "Not Found");
        }

        // 单 profile / group 分发（TS forwardToProvider；死参数 format 不保留）
        if let Some(profile_name) = &self.profile_name {
            return self.forward_single_profile(method, path_and_query, headers, body, profile_name).await;
        }
        self.forward_group(method, path_and_query, headers, body).await
    }

    /// TS: getGroup(idOrName) —— 先按 id 再按 name
    fn find_group<'a>(&self, mgr: &'a ConfigManager, id_or_name: &str) -> Option<&'a Group> {
        mgr.config().groups.get(id_or_name)
            .or_else(|| mgr.config().groups.values().find(|g| g.name == id_or_name))
    }

    async fn forward_single_profile(&self, method: &str, endpoint: &str, headers: &HeaderMap, body: &Bytes, profile_name: &str) -> HandlerResponse {
        let mgr = self.load_config();
        let Some(profile) = mgr.get_profile(profile_name).cloned() else {
            self.logger.warn("Profile not found", Some(json!({"profileName": profile_name})));
            return HandlerResponse::json(503, json!({"error": format!("Profile not found: {profile_name}")}));
        };
        match self.try_profile(method, endpoint, headers, body, &profile).await {
            TryOutcome::Success(resp) => resp,
            TryOutcome::Upstream(resp) => resp, // 非 2xx 原样返回，无转移
            TryOutcome::Error(e) => {
                self.logger.error("Provider request failed", Some(&e), Some(json!({"profileName": profile_name})));
                HandlerResponse::json(502, json!({"error": e.to_string()}))
            }
        }
    }

    async fn forward_group(&self, method: &str, endpoint: &str, headers: &HeaderMap, body: &Bytes) -> HandlerResponse {
        let mgr = self.load_config();
        let group = match &self.group_name {
            Some(name) => self.find_group(&mgr, name),
            None => mgr.config().active_group.as_ref().and_then(|id| mgr.config().groups.get(id)),
        };
        let Some(group) = group.filter(|g| !g.profiles.is_empty()).cloned() else {
            self.logger.warn("No active group or profiles", None);
            return HandlerResponse::json(503, json!({"error": "No active group or profiles"}));
        };

        let mut errors: Vec<String> = Vec::new();
        let mut last_failure: Option<HandlerResponse> = None;

        for profile_id in &group.profiles {
            // ① 熔断 open 跳过
            if !self.breaker.is_available(profile_id) {
                self.logger.info("Skipping unavailable provider", Some(json!({"profileId": profile_id})));
                continue;
            }
            // ② profile 不存在跳过
            let Some(profile) = mgr.get_profile(profile_id).cloned() else {
                self.logger.warn("Profile not found", Some(json!({"profileId": profile_id})));
                continue;
            };
            // ③ 格式不支持跳过（client≠target 且无注册转换器）
            let client_format = transform::infer_client_format(endpoint);
            let preset = swixter_core::presets::find_provider(&profile.provider_id);
            let target_format = transform::infer_target_api_format(&profile, preset.as_ref());
            if client_format != target_format && !transform::has_transformer(client_format, target_format) {
                self.logger.info("Skipping provider: no transformer for format pair", Some(json!({"profileId": profile_id})));
                continue;
            }
            // ④-⑥ transform + model 改写 + 转发
            match self.try_profile(method, endpoint, headers, body, &profile).await {
                TryOutcome::Success(resp) => {
                    self.breaker.record_success(profile_id);
                    return resp;
                }
                TryOutcome::Upstream(resp) => {
                    // 5xx/429 计入熔断；其余非 2xx 只转移
                    if resp.status >= 500 || resp.status == 429 { self.breaker.record_failure(profile_id); }
                    errors.push(format!("{profile_id}: upstream returned {}", resp.status));
                    self.logger.warn("Provider returned upstream status", Some(json!({"profileId": profile_id, "status": resp.status, "fallback": true})));
                    last_failure = Some(resp);
                }
                TryOutcome::Error(e) => {
                    self.breaker.record_failure(profile_id);
                    errors.push(format!("{profile_id}: {e}"));
                    self.logger.error("Provider request failed", Some(&e), Some(json!({"profileId": profile_id})));
                }
            }
        }

        self.logger.error("All providers failed", None, Some(json!({"errors": errors})));
        match last_failure {
            Some(resp) => resp, // 回传最后一个上游失败响应
            None => HandlerResponse::json(503, json!({"error": "All providers failed", "details": errors})),
        }
    }

    /// 单次 profile 尝试：transform 请求（失败回退透传）→ model 改写 → 转发 → 成功时响应 transform
    async fn try_profile(&self, method: &str, endpoint: &str, headers: &HeaderMap, body: &Bytes, profile: &Profile) -> TryOutcome {
        let preset = swixter_core::presets::find_provider(&profile.provider_id);
        let client_format = transform::infer_client_format(endpoint);
        let target_format = transform::infer_target_api_format(profile, preset.as_ref());

        let mut target_endpoint = endpoint.to_string();
        let mut eff_body = body.clone();
        let mut ctx: Option<transform::TransformCtx> = None;

        if client_format != target_format {
            let parsed: Value = if body.is_empty() { json!({}) } else {
                match serde_json::from_slice(body) { Ok(v) => v, Err(_) => json!({}) }
            };
            let c = transform::TransformCtx {
                endpoint: endpoint.to_string(),
                client_format,
                target_format,
                stream: parsed.get("stream").and_then(Value::as_bool) == Some(true),
            };
            match transform::transform_request(&parsed, &c) {
                Ok(t) => {
                    eff_body = Bytes::from(serde_json::to_vec(&t.body).unwrap());
                    target_endpoint = t.target_endpoint;
                    ctx = Some(c);
                }
                Err(e) => {
                    // transform 失败回退透传原 body + 原 endpoint（事实表 §Group 故障转移 ④）
                    self.logger.error("Request transform failed, falling back to passthrough", Some(&e), None);
                }
            }
        }

        // ⑤ model 改写
        let eff_body = crate::model::rewrite_request_body_for_profile(&eff_body, profile);

        let fwd = ForwardRequest {
            method: method.to_string(),
            path: target_endpoint.clone(),
            headers: headers.clone(),
            body: eff_body,
        };
        let resp = match self.forwarder.forward(fwd, profile, preset.as_ref(), self.timeout, target_format).await {
            Ok(r) => r,
            Err(e) => return TryOutcome::Error(e),
        };
        if !(200..300).contains(&resp.status) {
            return TryOutcome::Upstream(into_handler_response(resp));
        }

        // 2xx：需要时响应 transform（失败回退原始 body）
        match (ctx, resp.is_stream) {
            (Some(c), true) => {
                let ForwardBody::Stream(stream) = resp.body else { unreachable!() };
                let transformed = transform::transform_stream(stream, &c);
                TryOutcome::Success(HandlerResponse { status: resp.status, headers: resp.headers, body: HandlerBody::Stream(Box::pin(transformed)) })
            }
            (Some(c), false) => {
                let ForwardBody::Full(bytes) = resp.body else { unreachable!() };
                let parsed: Value = if bytes.is_empty() { json!({}) } else {
                    match serde_json::from_slice(&bytes) { Ok(v) => v, Err(_) => json!({}) }
                };
                match transform::transform_response(&parsed, &c) {
                    Ok(v) => TryOutcome::Success(HandlerResponse { status: resp.status, headers: resp.headers, body: HandlerBody::Full(Bytes::from(serde_json::to_vec(&v).unwrap())) }),
                    Err(e) => {
                        self.logger.error("Response transform failed, returning raw response", Some(&e), None);
                        TryOutcome::Success(HandlerResponse { status: resp.status, headers: resp.headers, body: HandlerBody::Full(bytes) })
                    }
                }
            }
            (None, true) => {
                let ForwardBody::Stream(stream) = resp.body else { unreachable!() };
                let mapped = futures::StreamExt::map(stream, |r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
                TryOutcome::Success(HandlerResponse { status: resp.status, headers: resp.headers, body: HandlerBody::Stream(Box::pin(mapped)) })
            }
            (None, false) => TryOutcome::Success(into_handler_response(resp)),
        }
    }
}

enum TryOutcome {
    Success(HandlerResponse),
    Upstream(HandlerResponse), // 非 2xx 上游响应
    Error(crate::ProxyError),  // 网络异常
}

fn into_handler_response(resp: crate::forwarder::ForwardResponse) -> HandlerResponse {
    match resp.body {
        ForwardBody::Full(b) => HandlerResponse { status: resp.status, headers: resp.headers, body: HandlerBody::Full(b) },
        ForwardBody::Stream(s) => {
            let mapped = futures::StreamExt::map(s, |r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e)));
            HandlerResponse { status: resp.status, headers: resp.headers, body: HandlerBody::Stream(Box::pin(mapped)) }
        }
    }
}
```

注意：`DEFAULT_TIMEOUT_MS` 的默认值解析放在 CLI 层（`ProxyServerConfig.timeout` 总是具体值），handler 不做 Option 处理。

- [ ] **Step 5: 实现 server.rs**

```rust
use std::sync::{Arc, OnceLock, RwLock};
use axum::{body::Body, extract::{Request, State}, http::StatusCode, response::Response, Router};
use dashmap::DashMap;
use futures::StreamExt;
use tokio::sync::oneshot;

use crate::events::{event_bus, ProxyEvent};
use crate::handler::{HandlerBody, ProxyHandler};
use crate::registry;
use crate::types::{ProxyServerConfig, ProxyStatus};
use crate::ProxyError;

struct RunningInstance {
    status: Arc<RwLock<ProxyStatus>>,
    shutdown: oneshot::Sender<()>,
}

/// 进程内实例表（对齐 TS servers/statuses map；status/list 时优先于 registry）
static INSTANCES: OnceLock<DashMap<String, RunningInstance>> = OnceLock::new();

fn instances() -> &'static DashMap<String, RunningInstance> {
    INSTANCES.get_or_init(DashMap::new)
}

pub async fn start_proxy_server(mut config: ProxyServerConfig) -> Result<ProxyStatus, ProxyError> {
    // 端口被其他运行中实例占用 → 报错（TS startProxyServer 检查）
    let occupied = registry::list_proxy_instances().into_iter()
        .any(|s| s.running && s.port == config.port && s.instance_id != config.instance_id);
    if occupied {
        return Err(ProxyError::AddrInUse(format!("Port {} already in use", config.port)));
    }

    let handler = Arc::new(ProxyHandler::new(&config));
    let status = handler.status();
    let app = Router::new()
        .fallback(move |State(h): State<Arc<ProxyHandler>>, req: Request| async move {
            let method = req.method().to_string();
            let path = req.uri().path().to_string()
                + req.uri().query().map(|q| format!("?{q}")).as_deref().unwrap_or("");
            let headers = req.headers().clone();
            let body = axum::body::to_bytes(req.into_body(), usize::MAX).await.unwrap_or_default();
            let resp = h.handle(&method, &path, &headers, &body).await;
            let mut builder = Response::builder().status(resp.status);
            for (k, v) in resp.headers.iter() { builder = builder.header(k, v); }
            let body = match resp.body {
                HandlerBody::Full(b) => Body::from(b),
                HandlerBody::Stream(s) => Body::from_stream(s),
            };
            builder.body(body).unwrap()
        })
        .with_state(handler);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    config.port = listener.local_addr()?.port(); // port 0 → 实际端口

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async { rx.await.ok(); })
            .await
            .ok();
    });

    {
        let mut s = status.write().unwrap();
        s.port = config.port;
        registry::update_instance(&s);
        let _ = event_bus().send(ProxyEvent::InstanceStart(s.clone()));
    }
    instances().insert(config.instance_id.clone(), RunningInstance { status: status.clone(), shutdown: tx });
    Ok(status.read().unwrap().clone())
}

/// 停止本进程内实例；返回是否真的停了（CLI stop 的跨进程 kill 在 Task 10）
pub async fn stop_in_process_instance(instance_id: &str) -> bool {
    let Some((_, inst)) = instances().remove(instance_id) else { return false };
    let _ = inst.shutdown.send(());
    registry::remove_instance(instance_id);
    let _ = event_bus().send(ProxyEvent::InstanceStop(instance_id.to_string()));
    true
}

/// CLI daemon 启动后轮询用
pub async fn health_check(host: &str, port: u16) -> bool {
    let url = format!("http://{host}:{port}/health");
    matches!(reqwest::Client::new().get(&url).timeout(std::time::Duration::from_millis(500)).send().await,
        Ok(r) if r.status().is_success())
}
```

- [ ] **Step 6: 跑测试 + clippy + fmt**

Run: `cd packages/cli && cargo test -p swixter-proxy && cargo clippy -p swixter-proxy -- -D warnings && cargo fmt`
Expected: 全部 PASS（含 fixtures、forwarder、integration）。

- [ ] **Step 7: Commit**

```bash
git add packages/cli/crates/proxy/src/model.rs packages/cli/crates/proxy/src/handler.rs packages/cli/crates/proxy/src/server.rs packages/cli/crates/proxy/tests/server_integration.rs
git commit -m "feat(rust): proxy handler with group failover + axum server"
```

---

### Task 10: CLI proxy 命令（start/stop/status/run）替换存根

**Files:**
- Modify: `packages/cli/crates/swixter/src/cli.rs`（`Proxy(StubArgs)` → 完整子命令树）
- Modify: `packages/cli/crates/swixter/src/main.rs`（proxy 分支接入）
- Modify: `packages/cli/crates/swixter/src/commands/mod.rs`
- Create: `packages/cli/crates/swixter/src/commands/proxy.rs`
- Modify: `packages/cli/crates/swixter/Cargo.toml`（追加 swixter-proxy、tokio）
- Modify: `packages/cli/crates/core/src/model.rs`（追加 `build_claude_proxy_marker_models`）
- Test: `packages/cli/crates/swixter/src/commands/proxy.rs`（内联单测）+ assert_cmd 集成

**Interfaces:**
- Consumes: `swixter_proxy::{server, registry, types}`（Task 8/9）、`swixter_core::{groups, config::ConfigManager, adapters}`（M1）
- Produces:
  - CLI：`swixter proxy start [--group|--profile|--port 15721|--host 127.0.0.1|--timeout 3000000|--daemon]`、`stop [instanceId=default]`、`status`、`run [--group|--profile|--port] -- <coder> [args...]`
  - `commands::proxy::resolve_proxy_runtime_binding(group, profile, requested_port, instances) -> RuntimeBinding { host, port, reuse_existing, reuse_instance_id }`
  - `commands::proxy::build_coder_proxy_env(coder: &str, base: &[(String, String)], port: u16) -> Vec<(String, String)>`
  - `core::model::build_claude_proxy_marker_models(p: &Profile) -> Option<ModelsConfig>`

行为（TS `cli/proxy.ts` 逐段对齐）：
- start：`--group` 与 `--profile` 互斥（exit 2）；指定则校验存在（exit 3）；都未指定则用 active group（打印 `Using default group: <name>`）；default 实例已运行则提示并 exit 0；同端口已有运行实例 → 报错（exit 1）。`--daemon`：spawn 自身 detached（`proxy start` 同参，去掉 `--daemon`），轮询 `/health`（10×100ms）+ registry runtime（10×100ms），失败 exit 1。
- stop：`instanceId` 默认 `default`；未运行则提示 exit 0；先 `stop_in_process_instance`（同进程场景），否则按 registry pid `terminate_process`（决策点 3）后删条目。
- status：迁移+清理 stale 后列出所有 running 实例（instanceId、type、地址、group/profile、requests/errors、startTime）；无实例提示 `swixter proxy start`。
- run：instanceId `run-<port>`，kind=run；端口分配复刻 `resolveProxyRuntimeBinding`（显式 port 直接用；已有实例服务同 group/profile → 复用；否则从 15721 起找未被运行实例占用的端口）。**复用实例时 coder 退出不停该实例**（Global Constraints 已知偏差）。给 coder 的 env：claude → `ANTHROPIC_API_BASE=http://127.0.0.1:<port>` + `ANTHROPIC_AUTH_TOKEN=swixter-local-proxy`（删 `ANTHROPIC_API_KEY`）；qwen → `ANTHROPIC_API_BASE` + `ANTHROPIC_API_KEY=dummy`（删 `ANTHROPIC_AUTH_TOKEN`）；codex → `OPENAI_API_BASE` + `OPENAI_API_KEY=dummy`。claude 额外：构造 proxy profile（providerId `anthropic`、authToken=proxy token、baseURL=proxy 地址、models=marker models）经 core claude adapter apply 写入 `~/.claude/settings.json`（对齐 TS `applyClaudeProfile`）。coder 退出 → 停实例并以 coder 退出码退出；Ctrl+C → 转发给 coder + 停实例 + exit 1。

- [ ] **Step 1: core model.rs 追加 marker models 构造 + 失败测试**

```rust
/// TS: buildClaudeProxyMarkerModels —— 有对应真实模型才写 marker；全无可配 → None
pub fn build_claude_proxy_marker_models(p: &Profile) -> Option<ModelsConfig> {
    const MAIN: &str = "SWIXTER_CLAUDE_MODEL";
    const HAIKU: &str = "SWIXTER_CLAUDE_HAIKU_MODEL";
    const SONNET: &str = "SWIXTER_CLAUDE_SONNET_MODEL";
    const OPUS: &str = "SWIXTER_CLAUDE_OPUS_MODEL";
    let m = ModelsConfig {
        anthropic_model: if p.models.as_ref().and_then(|x| x.anthropic_model.as_deref()).or(p.model.as_deref()).is_some() { Some(MAIN.into()) } else { None },
        default_haiku_model: p.models.as_ref().and_then(|x| x.default_haiku_model.as_deref()).map(|_| HAIKU.into()),
        default_sonnet_model: p.models.as_ref().and_then(|x| x.default_sonnet_model.as_deref()).map(|_| SONNET.into()),
        default_opus_model: p.models.as_ref().and_then(|x| x.default_opus_model.as_deref()).map(|_| OPUS.into()),
    };
    if m.anthropic_model.is_none() && m.default_haiku_model.is_none() && m.default_sonnet_model.is_none() && m.default_opus_model.is_none() {
        None
    } else {
        Some(m)
    }
}
```

（marker 字符串常量在 swixter-proxy 定义；core 不加 proxy 依赖，这里内联字面量并注释与 proxy 常量保持一致，或把 4 个 marker 常量上移到 core。实施时选择后者更干净：常量移到 `swixter_core::model`，proxy re-export。）

- [ ] **Step 2: 写 CLI 层失败测试（commands/proxy.rs 内联）**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coder_env_injection() {
        let base = vec![("ANTHROPIC_API_KEY".to_string(), "old".to_string()),
                        ("PATH".to_string(), "/bin".to_string())];
        let env = build_coder_proxy_env("claude", &base, 15721);
        assert!(env.iter().any(|(k, v)| k == "ANTHROPIC_API_BASE" && v == "http://127.0.0.1:15721"));
        assert!(env.iter().any(|(k, v)| k == "ANTHROPIC_AUTH_TOKEN" && v == "swixter-local-proxy"));
        assert!(!env.iter().any(|(k, _)| k == "ANTHROPIC_API_KEY")); // 删除
        let env = build_coder_proxy_env("qwen", &base, 15721);
        assert!(env.iter().any(|(k, v)| k == "ANTHROPIC_API_KEY" && v == "dummy"));
        let env = build_coder_proxy_env("codex", &base, 15721);
        assert!(env.iter().any(|(k, v)| k == "OPENAI_API_BASE" && v == "http://127.0.0.1:15721"));
        assert!(env.iter().any(|(k, v)| k == "OPENAI_API_KEY" && v == "dummy"));
    }

    #[test]
    fn runtime_binding_reuse_and_port_scan() {
        let running = |id: &str, port: u16, group: Option<&str>| ProxyStatus {
            instance_id: id.into(), running: true, port, group_name: group.map(Into::into), ..Default::default() };
        let instances = vec![running("default", 15721, Some("g1")), running("run-15722", 15722, None)];
        // 显式 port 直接生效
        let b = resolve_proxy_runtime_binding(None, None, Some(16000), &instances);
        assert_eq!(b.port, 16000);
        assert!(!b.reuse_existing);
        // 同 group 复用
        let b = resolve_proxy_runtime_binding(Some("g1"), None, None, &instances);
        assert!(b.reuse_existing);
        assert_eq!(b.port, 15721);
        // 否则从 15721 起找空位
        let b = resolve_proxy_runtime_binding(Some("g2"), None, None, &instances);
        assert_eq!(b.port, 15723);
        assert!(!b.reuse_existing);
    }
}
```

assert_cmd 集成（无需 server）：

```rust
#[test]
fn proxy_status_no_instances() {
    let dir = tempfile::tempdir().unwrap();
    assert_cmd::Command::cargo_bin("swixter").unwrap()
        .env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .args(["proxy", "status"])
        .assert()
        .success()
        .stdout(predicates::str::contains("No proxy instances running"));
}

#[test]
fn proxy_stop_not_running() {
    let dir = tempfile::tempdir().unwrap();
    assert_cmd::Command::cargo_bin("swixter").unwrap()
        .env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .args(["proxy", "stop"])
        .assert()
        .success()
        .stdout(predicates::str::contains("is not running"));
}
```

Run: `cargo test -p swixter`
Expected: FAIL。

- [ ] **Step 3: 修改 cli.rs / main.rs / mod.rs**

`cli.rs`：删除 `Proxy(StubArgs)`，替换为：

```rust
/// Local proxy with failover
Proxy(ProxyArgs),

#[derive(Args)]
pub struct ProxyArgs {
    #[command(subcommand)]
    pub command: ProxyCommand,
}

#[derive(Subcommand)]
pub enum ProxyCommand {
    /// Start proxy server (default instance)
    Start(ProxyStartArgs),
    /// Stop proxy instance (default: "default")
    Stop { instance_id: Option<String> },
    /// Show all proxy instances
    Status,
    /// Start proxy and run coder with env vars
    Run(ProxyRunArgs),
}

#[derive(Args)]
pub struct ProxyStartArgs {
    #[arg(long)]
    pub group: Option<String>,
    #[arg(long)]
    pub profile: Option<String>,
    #[arg(long, default_value_t = 15721)]
    pub port: u16,
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,
    #[arg(long, default_value_t = 3000000)]
    pub timeout: u64,
    #[arg(long)]
    pub daemon: bool,
}

#[derive(Args)]
pub struct ProxyRunArgs {
    #[arg(long)]
    pub group: Option<String>,
    #[arg(long)]
    pub profile: Option<String>,
    #[arg(long)]
    pub port: Option<u16>,
    /// Coder command and args after --
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub args: Vec<String>,
}
```

`main.rs`：`Commands::Proxy(a) => commands::proxy::dispatch(a)`（从存根分支移除）。`mod.rs` 加 `pub mod proxy;`。`swixter/Cargo.toml` 追加 `swixter-proxy = { path = "../proxy" }`、`tokio.workspace = true`。

- [ ] **Step 4: 实现 commands/proxy.rs**

骨架（关键路径完整，打印格式对齐 TS）：

```rust
use std::process::Stdio;
use std::time::Duration;

use swixter_core::config::ConfigManager;
use swixter_core::groups;
use swixter_proxy::registry;
use swixter_proxy::server;
use swixter_proxy::types::{InstanceKind, ProxyServerConfig, ProxyStatus};
use swixter_proxy::{DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT, SWIXTER_PROXY_AUTH_TOKEN};

use crate::cli::{ProxyArgs, ProxyCommand, ProxyRunArgs, ProxyStartArgs};
use crate::{EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};

pub fn dispatch(args: ProxyArgs) -> i32 {
    match args.command {
        ProxyCommand::Start(a) => cmd_start(a),
        ProxyCommand::Stop { instance_id } => cmd_stop(instance_id.as_deref().unwrap_or("default")),
        ProxyCommand::Status => cmd_status(),
        ProxyCommand::Run(a) => cmd_run(a),
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread().enable_all().build().expect("tokio runtime")
}

fn cmd_start(a: ProxyStartArgs) -> i32 {
    if a.group.is_some() && a.profile.is_some() {
        eprintln!("Cannot specify both --group and --profile");
        return EXIT_INVALID_ARG;
    }
    let mgr = ConfigManager::load();
    if let Some(g) = &a.group {
        if mgr.config().groups.values().all(|x| x.name != *g && x.id != *g) {
            eprintln!("Group \"{g}\" not found");
            return EXIT_NOT_FOUND;
        }
    }
    if let Some(p) = &a.profile {
        if mgr.get_profile(p).is_none() {
            eprintln!("Profile \"{p}\" not found");
            return EXIT_NOT_FOUND;
        }
    }
    let default_status = registry::get_proxy_status("default");
    if default_status.running {
        println!("Default proxy already running on {}:{}", default_status.host, default_status.port);
        return EXIT_SUCCESS;
    }
    // 未指定 group/profile 时用 active group
    let mut group = a.group.clone();
    if group.is_none() && a.profile.is_none() {
        if let Some(g) = mgr.config().active_group.as_ref().and_then(|id| mgr.config().groups.get(id)) {
            println!("Using default group: {}", g.name);
            group = Some(g.name.clone());
        }
    }
    if a.daemon {
        cmd_start_daemon(&a, group.as_deref())
    } else {
        let config = ProxyServerConfig {
            instance_id: "default".into(), kind: InstanceKind::Service,
            host: a.host.clone(), port: a.port, timeout: Duration::from_millis(a.timeout),
            group_name: group, profile_name: a.profile.clone(), config_path: None,
        };
        runtime().block_on(async move {
            match server::start_proxy_server(config).await {
                Ok(s) => {
                    println!("✓ Proxy server started");
                    println!("  Instance: default (service)");
                    println!("  Address: {}:{}", s.host, s.port);
                    println!("  Press Ctrl+C to stop");
                    let _ = tokio::signal::ctrl_c().await;
                    server::stop_in_process_instance("default").await;
                    EXIT_SUCCESS
                }
                Err(e) => { eprintln!("✗ {e}"); EXIT_GENERAL }
            }
        })
    }
}

fn cmd_start_daemon(a: &ProxyStartArgs, group: Option<&str>) -> i32 {
    // spawn 自身 detached：proxy start 同参（去掉 --daemon），stdio 全 null
    let exe = std::env::current_exe().expect("current exe");
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["proxy", "start", "--host", &a.host, "--port", &a.port.to_string(), "--timeout", &a.timeout.to_string()]);
    if let Some(g) = group { cmd.args(["--group", g]); }
    if let Some(p) = &a.profile { cmd.args(["--profile", p]); }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| { libc::setsid(); Ok(()) });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    if let Err(e) = cmd.spawn() {
        eprintln!("✗ Failed to spawn daemon: {e}");
        return EXIT_GENERAL;
    }
    // 轮询 /health（10×100ms）+ registry runtime（10×100ms）
    let ok = runtime().block_on(async {
        for _ in 0..10 {
            if server::health_check(&a.host, a.port).await {
                for _ in 0..10 {
                    let found = registry::list_proxy_instances().iter()
                        .any(|s| s.running && s.host == a.host && s.port == a.port);
                    if found { return true; }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                return true; // health 通过即视为启动（runtime 轮询失败不致命）
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        false
    });
    if ok {
        println!("✓ Proxy server started in background");
        println!("  Address: {}:{}", a.host, a.port);
        EXIT_SUCCESS
    } else {
        eprintln!("✗ Failed to start proxy server in background");
        EXIT_GENERAL
    }
}

fn cmd_stop(instance_id: &str) -> i32 {
    let status = registry::get_proxy_status(instance_id);
    if !status.running {
        println!("Proxy instance \"{instance_id}\" is not running");
        return EXIT_SUCCESS;
    }
    runtime().block_on(async {
        if server::stop_in_process_instance(instance_id).await {
            println!("✓ Proxy instance \"{instance_id}\" stopped");
            return EXIT_SUCCESS;
        }
        // 跨进程：按 registry pid 发信号 kill（决策点 3，改进 TS 只删条目的现状）
        if let Some(pid) = status.pid {
            registry::terminate_process(pid);
        }
        registry::remove_instance(instance_id);
        println!("✓ Proxy instance \"{instance_id}\" stopped");
        EXIT_SUCCESS
    })
}

fn cmd_status() -> i32 {
    let instances = registry::list_proxy_instances();
    let running: Vec<_> = instances.iter().filter(|s| s.running).collect();
    println!();
    println!("Proxy Status:");
    println!();
    if running.is_empty() {
        println!("  ● No proxy instances running");
        println!();
        println!("  Start with: swixter proxy start");
        return EXIT_SUCCESS;
    }
    for s in running {
        let kind = if s.kind == InstanceKind::Service { "service" } else { "run" };
        println!("  ● {} ({kind})", s.instance_id);
        println!("    Address: {}:{}", s.host, s.port);
        println!("    Group: {}", s.group_name.as_deref().unwrap_or("none"));
        println!("    Profile: {}", s.profile_name.as_deref().unwrap_or("none"));
        println!("    Requests: {} | Errors: {}", s.request_count, s.error_count);
        if let Some(t) = &s.start_time { println!("    Started: {t}"); }
        println!();
    }
    EXIT_SUCCESS
}

pub struct RuntimeBinding {
    pub host: String,
    pub port: u16,
    pub reuse_existing: bool,
    pub reuse_instance_id: Option<String>,
}

/// TS: resolveProxyRuntimeBinding
pub fn resolve_proxy_runtime_binding(
    group_name: Option<&str>,
    profile_name: Option<&str>,
    requested_port: Option<u16>,
    all_instances: &[ProxyStatus],
) -> RuntimeBinding {
    if let Some(port) = requested_port {
        return RuntimeBinding { host: DEFAULT_PROXY_HOST.into(), port, reuse_existing: false, reuse_instance_id: None };
    }
    if let Some(existing) = all_instances.iter().find(|s| {
        s.running && ((group_name.is_some() && s.group_name.as_deref() == group_name)
            || (profile_name.is_some() && s.profile_name.as_deref() == profile_name))
    }) {
        return RuntimeBinding { host: existing.host.clone(), port: existing.port, reuse_existing: true, reuse_instance_id: Some(existing.instance_id.clone()) };
    }
    let occupied: std::collections::HashSet<u16> = all_instances.iter().filter(|s| s.running).map(|s| s.port).collect();
    let mut port = DEFAULT_PROXY_PORT;
    while occupied.contains(&port) { port += 1; }
    RuntimeBinding { host: DEFAULT_PROXY_HOST.into(), port, reuse_existing: false, reuse_instance_id: None }
}

/// TS: buildCoderProxyEnv
pub fn build_coder_proxy_env(coder: &str, base: &[(String, String)], port: u16) -> Vec<(String, String)> {
    let base_url = format!("http://{DEFAULT_PROXY_HOST}:{port}");
    let mut env: Vec<(String, String)> = base.to_vec();
    let mut set = |env: &mut Vec<(String, String)>, k: &str, v: &str| {
        env.retain(|(key, _)| key != k);
        env.push((k.to_string(), v.to_string()));
    };
    let mut unset = |env: &mut Vec<(String, String)>, k: &str| { env.retain(|(key, _)| key != k); };
    match coder {
        "claude" => {
            set(&mut env, "ANTHROPIC_API_BASE", &base_url);
            set(&mut env, "ANTHROPIC_AUTH_TOKEN", SWIXTER_PROXY_AUTH_TOKEN);
            unset(&mut env, "ANTHROPIC_API_KEY");
        }
        "qwen" => {
            set(&mut env, "ANTHROPIC_API_BASE", &base_url);
            set(&mut env, "ANTHROPIC_API_KEY", "dummy");
            unset(&mut env, "ANTHROPIC_AUTH_TOKEN");
        }
        "codex" => {
            set(&mut env, "OPENAI_API_BASE", &base_url);
            set(&mut env, "OPENAI_API_KEY", "dummy");
        }
        _ => {}
    }
    env
}

fn cmd_run(a: ProxyRunArgs) -> i32 {
    if a.group.is_some() && a.profile.is_some() {
        eprintln!("Cannot specify both --group and --profile");
        return EXIT_INVALID_ARG;
    }
    let mgr = ConfigManager::load();
    // group/profile 校验（同 cmd_start，略）
    // 都未指定 → active group；仍无 → 报错提示
    let mut group = a.group.clone();
    if group.is_none() && a.profile.is_none() {
        group = mgr.config().active_group.as_ref()
            .and_then(|id| mgr.config().groups.get(id))
            .map(|g| g.name.clone());
    }
    if group.is_none() && a.profile.is_none() {
        eprintln!("No group or profile specified, and no default group set");
        eprintln!("Use --group, --profile, or create a default group first");
        return EXIT_GENERAL;
    }

    let instances = registry::list_proxy_instances();
    let binding = resolve_proxy_runtime_binding(group.as_deref(), a.profile.as_deref(), a.port, &instances);
    let instance_id = format!("run-{}", binding.port);
    let started_by_us = !binding.reuse_existing;

    let coder_args = a.args.clone();
    let Some(coder) = coder_args.first().cloned() else {
        eprintln!("Coder command required after --");
        eprintln!("Example: swixter proxy run -- claude");
        return EXIT_GENERAL;
    };

    // claude：proxy profile + marker models 写入 ~/.claude/settings.json（TS applyClaudeProfile 路径）
    if coder == "claude" {
        let target = a.profile.as_ref().and_then(|n| mgr.get_profile(n))
            .or_else(|| group.as_ref()
                .and_then(|g| mgr.config().groups.values().find(|x| x.name == *g || x.id == *g))
                .and_then(|g| g.profiles.first())
                .and_then(|n| mgr.get_profile(n)));
        let proxy_profile = swixter_core::types::Profile {
            name: format!("proxy-{}", a.profile.as_deref().or(group.as_deref()).unwrap_or("default")),
            provider_id: "anthropic".into(),
            api_key: String::new(),
            auth_token: Some(SWIXTER_PROXY_AUTH_TOKEN.into()),
            base_url: Some(format!("http://{}:{}", binding.host, binding.port)),
            models: target.and_then(swixter_core::model::build_claude_proxy_marker_models),
            created_at: swixter_core::types::now_iso(),
            updated_at: swixter_core::types::now_iso(),
            ..Default::default()
        };
        let adapter = swixter_core::adapters::get_adapter(swixter_core::adapters::AdapterKind::Claude);
        if let Err(e) = adapter.apply(&proxy_profile) {
            eprintln!("✗ Failed to apply claude proxy profile: {e}");
            return EXIT_GENERAL;
        }
    }

    let base_env: Vec<(String, String)> = std::env::vars().collect();
    let env = build_coder_proxy_env(&coder, &base_env, binding.port);

    runtime().block_on(async move {
        if started_by_us {
            let config = ProxyServerConfig {
                instance_id: instance_id.clone(), kind: InstanceKind::Run,
                host: binding.host.clone(), port: binding.port,
                timeout: Duration::from_millis(swixter_proxy::DEFAULT_TIMEOUT_MS), // TS run 不传 timeout → 默认
                group_name: group, profile_name: a.profile, config_path: None,
            };
            if let Err(e) = server::start_proxy_server(config).await {
                eprintln!("✗ {e}");
                return EXIT_GENERAL;
            }
        }
        println!("✓ Running: {} {}", coder, coder_args[1..].join(" "));
        println!("  Proxy: {}:{}", binding.host, binding.port);

        let mut child = tokio::process::Command::new(&coder)
            .args(&coder_args[1..])
            .envs(env)
            .stdin(Stdio::inherit()).stdout(Stdio::inherit()).stderr(Stdio::inherit())
            .spawn()
            .expect("spawn coder");

        // coder 退出 → 停实例、透传退出码；Ctrl+C → 转发 + 停 + exit 1
        let code = tokio::select! {
            status = child.wait() => status.map(|s| s.code().unwrap_or(0)).unwrap_or(0),
            _ = tokio::signal::ctrl_c() => {
                let _ = child.kill().await;
                if started_by_us { server::stop_in_process_instance(&instance_id).await; }
                return 1;
            }
        };
        if started_by_us { server::stop_in_process_instance(&instance_id).await; }
        code
    })
}
```

（`AdapterKind::Claude` 与 `adapter.apply(&Profile)` 的具体签名以 M1 实际代码为准；`groups::find_by_name` 已存在可复用。）

- [ ] **Step 5: 全量验证**

Run: `cd packages/cli && cargo fmt && cargo clippy --workspace -- -D warnings && cargo test --workspace`
Expected: 全部 PASS。

人工冒烟（与 TS 版对照）：

```bash
# 同一份配置，Rust proxy 与 TS proxy 行为对照
export SWIXTER_CONFIG_PATH=/tmp/swixter-proxy-smoke/config.json
cargo run -p swixter -- proxy start --daemon
curl -s http://127.0.0.1:15721/health   # {"status":"ok",...}
curl -s -X POST http://127.0.0.1:15721/v1/messages -H 'content-type: application/json' -d '{}'  # 401
cargo run -p swixter -- proxy status
cargo run -p swixter -- proxy stop      # daemon 进程应真正退出（ps 验证）
```

- [ ] **Step 6: Commit**

```bash
git add packages/cli/crates/swixter packages/cli/crates/core/src/model.rs packages/cli/Cargo.toml
git commit -m "feat(rust): proxy CLI commands (start/stop/status/run) — M2 complete"
```

---

## M2 完成标准

- `cargo test --workspace` 全绿：SSE/熔断器/forwarder 单测、transform 三方向 fixture 回放、handler+failover+server 集成测试（mock upstream）、registry/logger 单测、CLI 单测与 assert_cmd 集成。
- `cargo clippy --workspace -- -D warnings` 无警告；`cargo fmt --check` 通过。
- 人工冒烟：`proxy start --daemon` → `/health` 200、未授权 401、`proxy status` 显示实例、`proxy stop` 后 daemon 进程真正退出（registry pid kill）；`proxy run --group <g> -- claude` 能起实例并注入 env。
- 与 TS 版交替使用同一份 `proxy-instances.json` / `proxy-*.log` 无格式冲突（camelCase、2 空格缩进、JSONL 字段一致）。
- `swixter proxy` 四个命令面与 TS 版对齐（参数、默认值、互斥校验、退出码）；TS 存根提示（"coming in milestone M2/M3"）不再出现于 proxy 分支。
- 范围外未做：WebSocket 事件广播（仅 broadcast 占位）、Web UI、`ui/auth/sync` 仍为存根（M3）。
