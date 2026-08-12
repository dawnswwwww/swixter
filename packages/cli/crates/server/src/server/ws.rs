//! /ws WebSocket（计划 Task 6，事实表 §WebSocket）：
//! 纯服务端→客户端；连接即单发 snapshot，随后合流广播 proxy 事件总线与
//! 进程内 ws_broadcast（group.change）。
use axum::extract::ws::WebSocketUpgrade;
use axum::extract::ws::{Message, WebSocket};
use axum::extract::State;
use axum::response::Response;

use crate::server::state::AppState;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(mut socket: WebSocket, state: AppState) {
    // 先订阅再发 snapshot：保证 snapshot 发出后测试/客户端注入的事件必有接收者
    let mut proxy_rx = swixter_proxy::events::event_bus().subscribe();
    let mut app_rx = state.ws_broadcast.subscribe();

    // 1) 连接即单发 snapshot（registry 当前实例 + activeGroup）
    let snapshot = build_snapshot(&state);
    if socket
        .send(Message::Text(snapshot.to_string().into()))
        .await
        .is_err()
    {
        return;
    }

    // 2) 合流：proxy event_bus + 进程内 ws_broadcast（group.change），逐条转发
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
            // 必须读 socket：客户端 Close/断线时退出循环回收连接
            // （ping/pong 由 axum/tungstenite 层自动处理，无需关心）
            msg = socket.recv() => match msg {
                None | Some(Ok(Message::Close(_))) | Some(Err(_)) => break,
                Some(Ok(_)) => continue, // 客户端不应发业务消息，忽略
            },
        };
        let Some(text) = text else { break };
        if socket.send(Message::Text(text.into())).await.is_err() {
            break;
        }
    }
}

fn build_snapshot(state: &AppState) -> serde_json::Value {
    let instances = swixter_proxy::registry::list_proxy_instances();
    let mut snap = serde_json::json!({
        "type": "snapshot",
        "instances": instances,
    });
    let mgr = state.config_manager();
    if let Some(g) = mgr
        .config()
        .active_group
        .as_ref()
        .and_then(|id| mgr.config().groups.get(id))
    {
        snap["activeGroupId"] = g.id.clone().into();
        snap["activeGroupName"] = g.name.clone().into();
    }
    snap
}

fn proxy_event_to_json(ev: swixter_proxy::events::ProxyEvent) -> serde_json::Value {
    use swixter_proxy::events::ProxyEvent as E;
    match ev {
        E::InstanceStart(status) => serde_json::json!({"type":"instance.start","status":status}),
        E::InstanceStop(id) => serde_json::json!({"type":"instance.stop","instanceId":id}),
        E::StatusUpdate(status) => serde_json::json!({"type":"status","status":status}),
        E::Log { instance_id, entry } => {
            serde_json::json!({"type":"log","instanceId":instance_id,"entry":entry})
        }
    }
}
