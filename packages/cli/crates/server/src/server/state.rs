use std::path::PathBuf;

use swixter_core::config::ConfigManager;

/// axum State：config_path 注入（None → core::paths::config_path()）。
/// 每请求重新加载配置（对齐 TS：改配置即时生效）。
#[derive(Clone)]
pub struct AppState {
    pub config_path: Option<PathBuf>,
    /// 进程内 WS 广播队列（group.change 等非 proxy 事件；Task 6）
    pub ws_broadcast: tokio::sync::broadcast::Sender<serde_json::Value>,
}

impl AppState {
    pub fn new(config_path: Option<PathBuf>) -> Self {
        let (ws_broadcast, _) = tokio::sync::broadcast::channel(256);
        Self {
            config_path,
            ws_broadcast,
        }
    }

    pub fn config_path(&self) -> PathBuf {
        self.config_path
            .clone()
            .unwrap_or_else(swixter_core::paths::config_path)
    }

    pub fn providers_path(&self) -> PathBuf {
        self.config_path().parent().unwrap().join("providers.json")
    }

    /// 每请求重新加载（TS 同语义）
    pub fn config_manager(&self) -> ConfigManager {
        ConfigManager::load_from(self.config_path())
    }
}
