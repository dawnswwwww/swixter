use serde_json::Value;
use std::sync::OnceLock;
use tokio::sync::broadcast;

use crate::types::ProxyStatus;

/// M3 Web UI 的 WebSocket 广播将 subscribe() 此总线（决策点 2）。
/// M2 没有订阅者，send 返回 Err（无 receiver）时忽略。
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
