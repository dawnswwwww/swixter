//! TS: server/api/proxy-status.ts + proxy-logs.ts
use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use swixter_proxy::types::{InstanceKind, ProxyServerConfig};
use swixter_proxy::{registry, DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT, DEFAULT_TIMEOUT_MS};

use crate::server::error::ApiError;
use crate::server::extract::JsonBody;
use crate::server::state::AppState;

const DEFAULT_LINES: usize = 200;
const MAX_LINES: usize = 1000;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/proxy/status", get(get_proxy_status))
        .route("/proxy/instances", get(list_instances))
        .route("/proxy/start", axum::routing::post(start_proxy))
        .route("/proxy/stop", axum::routing::post(stop_proxy))
        .route("/proxy/logs", get(get_proxy_logs))
}

fn active_group_name(state: &AppState) -> Option<String> {
    let mgr = state.config_manager();
    mgr.config()
        .active_group
        .as_ref()
        .and_then(|id| mgr.config().groups.get(id))
        .map(|g| g.name.clone())
}

async fn get_proxy_status(State(state): State<AppState>) -> impl IntoResponse {
    let status = registry::get_proxy_status("default");
    let mut v = serde_json::to_value(&status).unwrap();
    v["activeGroupName"] = active_group_name(&state)
        .map(serde_json::Value::from)
        .unwrap_or(serde_json::Value::Null);
    Json(v)
}

async fn list_instances(State(state): State<AppState>) -> impl IntoResponse {
    let active = active_group_name(&state);
    let list: Vec<serde_json::Value> = registry::list_proxy_instances()
        .into_iter()
        .map(|s| {
            let mut v = serde_json::to_value(&s).unwrap();
            v["activeGroupName"] = s
                .group_name
                .clone()
                .or_else(|| active.clone())
                .map(serde_json::Value::from)
                .unwrap_or(serde_json::Value::Null);
            v
        })
        .collect();
    Json(list)
}

/// POST /api/proxy/start —— instanceId 固定 "default"、type service、
/// host 默认 127.0.0.1、端口 15721 起递增避开运行中实例占用
async fn start_proxy(
    State(state): State<AppState>,
    JsonBody(body): JsonBody,
) -> Result<impl IntoResponse, ApiError> {
    let host = body
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_PROXY_HOST)
        .to_string();
    let requested_port = body
        .get("port")
        .and_then(|v| v.as_u64())
        .map(|p| {
            if (1..=65535).contains(&p) {
                Ok(p as u16)
            } else {
                Err(ApiError::bad_request(
                    "INVALID_PORT",
                    "port must be between 1 and 65535",
                ))
            }
        })
        .transpose()?;

    let port = match requested_port {
        Some(p) => p,
        None => {
            let mut port = DEFAULT_PROXY_PORT;
            let occupied: std::collections::HashSet<u16> = registry::list_proxy_instances()
                .into_iter()
                .filter(|s| s.running)
                .map(|s| s.port)
                .collect();
            // 与 find_available_port 一致：递增到 65535 仍被占用则报错，
            // 避免 debug 下 `port += 1` 溢出 panic
            while occupied.contains(&port) {
                if port == u16::MAX {
                    return Err(ApiError::bad_request(
                        "START_PROXY_FAILED",
                        "no available port for proxy instance",
                    ));
                }
                port += 1;
            }
            port
        }
    };

    let config = ProxyServerConfig {
        instance_id: "default".into(),
        kind: InstanceKind::Service,
        host,
        port,
        timeout: std::time::Duration::from_millis(DEFAULT_TIMEOUT_MS),
        group_name: None,
        profile_name: None,
        config_path: state.config_path.clone(),
    };
    let status = swixter_proxy::server::start_proxy_server(config)
        .await
        .map_err(|e| ApiError::bad_request("START_PROXY_FAILED", e.to_string()))?;
    Ok(Json(status))
}

/// POST /api/proxy/stop —— body {instanceId?}（默认 "default"）
async fn stop_proxy(JsonBody(body): JsonBody) -> Result<impl IntoResponse, ApiError> {
    let instance_id = body
        .get("instanceId")
        .and_then(|x| x.as_str())
        .map(String::from)
        .unwrap_or_else(|| "default".into());
    // TS stopProxyServer：停进程内实例；无论是否进程内都清 registry + 广播 InstanceStop
    if !swixter_proxy::server::stop_in_process_instance(&instance_id).await {
        registry::remove_instance(&instance_id);
        let _ = swixter_proxy::events::event_bus().send(
            swixter_proxy::events::ProxyEvent::InstanceStop(instance_id.clone()),
        );
    }
    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Proxy instance \"{instance_id}\" stopped"),
    })))
}

/// GET /api/proxy/logs?instanceId&lines=N —— JSONL 逐行解析（坏行跳过），最新在前
async fn get_proxy_logs(
    Query(q): Query<HashMap<String, String>>,
) -> Result<impl IntoResponse, ApiError> {
    let instance_id = q
        .get("instanceId")
        .cloned()
        .unwrap_or_else(|| "default".into());
    let requested: usize = q
        .get("lines")
        .and_then(|v| v.parse().ok())
        .unwrap_or(DEFAULT_LINES);
    let lines = requested.clamp(1, MAX_LINES);

    let path = swixter_proxy::logger::proxy_log_path(&instance_id);
    let Ok(content) = std::fs::read_to_string(&path) else {
        return Ok(Json(serde_json::json!({
            "lines": [],
            "total": 0,
            "instanceId": instance_id,
        })));
    };
    let all: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    let total = all.len();
    let mut parsed: Vec<serde_json::Value> = all[all.len().saturating_sub(lines)..]
        .iter()
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect();
    parsed.reverse();
    Ok(Json(serde_json::json!({
        "lines": parsed,
        "total": total,
        "instanceId": instance_id,
    })))
}
