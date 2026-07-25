pub mod auth;
pub mod crypto;
pub mod daemon;
pub mod server;
pub mod sync;

use std::time::Duration;

#[derive(thiserror::Error, Debug)]
pub enum ServerError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("crypto error: {0}")]
    Crypto(String),
    #[error("auth error: {0}")]
    Auth(String),
    #[error("sync error: {0}")]
    Sync(#[from] crate::sync::client::SyncError),
    #[error("sync conflict: {0} (use --force-local to overwrite remote, or --force-remote to overwrite local)")]
    SyncConflict(crate::sync::types::SyncConflict),
    #[error("core error: {0}")]
    Core(#[from] swixter_core::CoreError),
}

// 常量逐字对齐 TS 源码（见计划 Global Constraints）
pub const PBKDF2_ITERATIONS: u32 = 100_000;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
pub const API_BASE: &str = "https://api.swixter.com";
pub const DEFAULT_UI_PORT: u16 = 3141;
pub const MAGIC_LINK_POLL_INTERVAL: Duration = Duration::from_secs(2);
pub const MAGIC_LINK_MAX_ATTEMPTS: u32 = 300;
pub const TOKEN_REFRESH_BUFFER_MS: i64 = 300_000;
