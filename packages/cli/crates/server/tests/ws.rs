//! WS 集成测试（计划 Task 6）：snapshot 单发 + proxy 事件总线/group.change 广播。
//! registry 路径用 RegistryPathOverride 隔离（避免读写真实配置目录）。
use std::path::Path;

use futures::StreamExt;
use swixter_proxy::registry::{update_instance, RegistryPathOverride};
use swixter_proxy::types::{InstanceKind, ProxyStatus};
use swixter_server::server::state::AppState;

fn write_config(
    dir: &Path,
    profiles: serde_json::Value,
    groups: serde_json::Value,
    active_group: Option<&str>,
) {
    let mut v = serde_json::json!({
        "version": "2.0.0",
        "profiles": profiles,
        "coders": {},
        "groups": groups,
    });
    if let Some(g) = active_group {
        v["activeGroup"] = g.into();
    }
    std::fs::write(dir.join("config.json"), v.to_string()).unwrap();
}

async fn spawn_server(dir: &Path) -> String {
    let state = AppState::new(Some(dir.join("config.json")));
    let app = swixter_server::server::routes::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}")
}

async fn next_json(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> serde_json::Value {
    let msg = tokio::time::timeout(std::time::Duration::from_secs(5), socket.next())
        .await
        .expect("ws timeout")
        .unwrap()
        .unwrap();
    serde_json::from_str(msg.into_text().unwrap().as_str()).unwrap()
}

#[tokio::test]
async fn ws_sends_snapshot_then_broadcasts_events() {
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({}),
        serde_json::json!({}),
        None,
    );
    let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
    update_instance(&ProxyStatus {
        instance_id: "default".into(),
        kind: InstanceKind::Service,
        running: true,
        host: "127.0.0.1".into(),
        port: 15721,
        pid: Some(std::process::id()),
        ..Default::default()
    });
    let base = spawn_server(dir.path()).await;

    let (mut socket, _) =
        tokio_tungstenite::connect_async(format!("{}/ws", base.replacen("http", "ws", 1)))
            .await
            .unwrap();

    // 首条：snapshot（内容匹配 registry 当前实例）
    let snap = next_json(&mut socket).await;
    assert_eq!(snap["type"], "snapshot");
    assert_eq!(snap["instances"].as_array().unwrap().len(), 1);
    assert_eq!(snap["instances"][0]["instanceId"], "default");
    assert!(snap.get("activeGroupId").is_none() || snap["activeGroupId"].is_null());

    // 注入 proxy 事件 → 客户端收到对应广播
    swixter_proxy::events::event_bus()
        .send(swixter_proxy::events::ProxyEvent::Log {
            instance_id: "default".into(),
            entry: serde_json::json!({"ts":"t","level":"info","msg":"hello"}),
        })
        .ok();
    let v = next_json(&mut socket).await;
    assert_eq!(v["type"], "log");
    assert_eq!(v["instanceId"], "default");
    assert_eq!(v["entry"]["msg"], "hello");
}

#[tokio::test]
async fn server_releases_connection_when_client_closes() {
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({}),
        serde_json::json!({}),
        None,
    );
    let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
    let base = spawn_server(dir.path()).await;

    let (mut socket, _) =
        tokio_tungstenite::connect_async(format!("{}/ws", base.replacen("http", "ws", 1)))
            .await
            .unwrap();
    let snap = next_json(&mut socket).await;
    assert_eq!(snap["type"], "snapshot");

    // 客户端立即 close：server 端 select 读到 Close/断线后必须退出任务并断开底层连接。
    // 修复前 server 不读 socket，连接永不回收，客户端流不会结束（此断言会超时失败）。
    socket.close(None).await.ok();
    match tokio::time::timeout(std::time::Duration::from_secs(5), socket.next()).await {
        Ok(None) => {} // 流正常结束（server 侧断开）
        Ok(Some(Ok(m))) => assert!(m.is_close(), "expected close frame, got {m:?}"),
        Ok(Some(Err(_))) => {} // 连接已被 server 侧断开
        Err(_) => panic!("server did not release the connection after client close"),
    }
}

#[tokio::test]
async fn group_active_broadcasts_change() {
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({
            "p1": {
                "name": "p1", "providerId": "ollama", "apiKey": "k-123456789",
                "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z",
            }
        }),
        serde_json::json!({
            "g1": {
                "id": "g1", "name": "main", "profiles": ["p1"], "isDefault": false,
                "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z",
            }
        }),
        None,
    );
    let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
    let base = spawn_server(dir.path()).await;

    let (mut socket, _) =
        tokio_tungstenite::connect_async(format!("{}/ws", base.replacen("http", "ws", 1)))
            .await
            .unwrap();
    let snap = next_json(&mut socket).await;
    assert_eq!(snap["type"], "snapshot");
    assert_eq!(snap["instances"].as_array().unwrap().len(), 0);

    // PUT /api/groups/:id/active → WS 客户端收到 group.change
    let resp = reqwest::Client::new()
        .put(format!("{base}/api/groups/g1/active"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v = next_json(&mut socket).await;
    assert_eq!(v["type"], "group.change");
    assert_eq!(v["groupId"], "g1");
    assert_eq!(v["groupName"], "main");
}
