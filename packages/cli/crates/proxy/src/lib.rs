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

// marker 常量定义在 swixter_core::model（Task 10 上移，供 CLI proxy profile 构造复用）
pub use swixter_core::model::{
    SWIXTER_CLAUDE_HAIKU_MODEL, SWIXTER_CLAUDE_MODEL, SWIXTER_CLAUDE_OPUS_MODEL,
    SWIXTER_CLAUDE_SONNET_MODEL,
};

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
