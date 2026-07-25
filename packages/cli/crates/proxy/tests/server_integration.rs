mod common;
use bytes::Bytes;
use common::MockUpstream;
use reqwest::header::{HeaderMap, HeaderValue};
use swixter_proxy::handler::{HandlerBody, ProxyHandler};
use swixter_proxy::logger::LogPathOverride;
use swixter_proxy::registry::{self, RegistryPathOverride};
use swixter_proxy::types::{InstanceKind, ProxyServerConfig};

fn write_config(dir: &std::path::Path, config: serde_json::Value) -> std::path::PathBuf {
    let path = dir.join("config.json");
    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
    path
}

fn handler_config(
    config_path: std::path::PathBuf,
    group: Option<&str>,
    profile: Option<&str>,
) -> ProxyServerConfig {
    ProxyServerConfig {
        instance_id: "test".into(),
        kind: InstanceKind::Service,
        host: "127.0.0.1".into(),
        port: 0,
        timeout: std::time::Duration::from_secs(5),
        group_name: group.map(Into::into),
        profile_name: profile.map(Into::into),
        config_path: Some(config_path),
    }
}

fn bearer() -> HeaderMap {
    let mut h = HeaderMap::new();
    h.insert(
        "authorization",
        HeaderValue::from_static("Bearer swixter-local-proxy"),
    );
    h
}

fn profile_json(name: &str, base_url: &str) -> serde_json::Value {
    serde_json::json!({"name":name,"providerId":"custom","apiKey":"sk","baseURL":base_url,"createdAt":"t","updatedAt":"t"})
}

async fn body_bytes(body: HandlerBody) -> Bytes {
    match body {
        HandlerBody::Full(b) => b,
        HandlerBody::Stream(s) => {
            use futures::StreamExt;
            let mut out = Vec::new();
            tokio::pin!(s);
            while let Some(item) = s.next().await {
                out.extend_from_slice(&item.unwrap());
            }
            Bytes::from(out)
        }
    }
}

#[tokio::test]
async fn auth_required_except_health() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let cfg = write_config(
        dir.path(),
        serde_json::json!({"version":"2.0.0","profiles":{},"coders":{},"groups":{}}),
    );
    let h = ProxyHandler::new(&handler_config(cfg, None, Some("p1")));
    let resp = h
        .handle(
            "POST",
            "/v1/messages",
            &HeaderMap::new(),
            &Bytes::from("{}"),
        )
        .await;
    assert_eq!(resp.status, 401);
    let body = body_bytes(resp.body).await;
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap()["error"],
        "Invalid or missing proxy authentication"
    );
    let health = h
        .handle("GET", "/health", &HeaderMap::new(), &Bytes::new())
        .await;
    assert_eq!(health.status, 200); // 免鉴权
    let not_found = h
        .handle("POST", "/nope", &bearer(), &Bytes::from("{}"))
        .await;
    assert_eq!(not_found.status, 404);
}

#[tokio::test]
async fn single_profile_passthrough_and_upstream_error() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let mock_ok = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "application/json".into(),
            axum::body::Body::from(r#"{"ok":true}"#),
        )
    })
    .await;
    let mock_bad = MockUpstream::start(|| {
        (
            axum::http::StatusCode::BAD_REQUEST,
            "application/json".into(),
            axum::body::Body::from(r#"{"err":"x"}"#),
        )
    })
    .await;
    let cfg_path = dir.path().join("config.json");
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},"groups":{},
            "profiles":{"p1":profile_json("p1", &mock_ok.base_url)}
        }),
    );
    assert_eq!(cfg, cfg_path);
    let h = ProxyHandler::new(&handler_config(cfg, None, Some("p1")));
    let resp = h
        .handle(
            "POST",
            "/v1/chat/completions",
            &bearer(),
            &Bytes::from(r#"{"model":"m"}"#),
        )
        .await;
    assert_eq!(resp.status, 200);
    assert_eq!(body_bytes(resp.body).await.as_ref(), br#"{"ok":true}"#);

    // 每请求重读配置：改写 baseURL 指向 400 mock，非 2xx 原样返回（单 profile 无转移）
    write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},"groups":{},
            "profiles":{"p1":profile_json("p1", &mock_bad.base_url)}
        }),
    );
    let resp = h
        .handle(
            "POST",
            "/v1/chat/completions",
            &bearer(),
            &Bytes::from(r#"{"model":"m"}"#),
        )
        .await;
    assert_eq!(resp.status, 400);
    assert_eq!(body_bytes(resp.body).await.as_ref(), br#"{"err":"x"}"#);
}

#[tokio::test]
async fn group_failover_skips_open_circuit_and_returns_second() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let bad = MockUpstream::start(|| {
        (
            axum::http::StatusCode::INTERNAL_SERVER_ERROR,
            "application/json".into(),
            axum::body::Body::from(r#"{"err":"a"}"#),
        )
    })
    .await;
    let good = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "application/json".into(),
            axum::body::Body::from(r#"{"from":"b"}"#),
        )
    })
    .await;
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},
            "profiles":{
                "a":profile_json("a", &bad.base_url),
                "b":profile_json("b", &good.base_url)
            },
            "groups":{"g1":{"id":"g1","name":"g","profiles":["a","b"],"isDefault":true,"createdAt":"t","updatedAt":"t"}},
            "activeGroup":"g1"
        }),
    );
    let h = ProxyHandler::new(&handler_config(cfg, Some("g"), None));
    // 前 3 次 a 失败转移到 b 成功（a 累计 3 次熔断 open）；第 4 次 a 被熔断跳过
    for _ in 0..4 {
        let resp = h
            .handle(
                "POST",
                "/v1/chat/completions",
                &bearer(),
                &Bytes::from(r#"{"model":"m"}"#),
            )
            .await;
        assert_eq!(resp.status, 200);
    }
    assert_eq!(bad.recorded.lock().unwrap().len(), 3);
    assert_eq!(good.recorded.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn group_all_failed_returns_last_upstream_response() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let bad = MockUpstream::start(|| {
        (
            axum::http::StatusCode::TOO_MANY_REQUESTS,
            "application/json".into(),
            axum::body::Body::from(r#"{"err":"rate"}"#),
        )
    })
    .await;
    let bad2 = MockUpstream::start(|| {
        (
            axum::http::StatusCode::BAD_GATEWAY,
            "application/json".into(),
            axum::body::Body::from(r#"{"err":"b2"}"#),
        )
    })
    .await;
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},
            "profiles":{
                "a":profile_json("a", &bad.base_url),
                "b":profile_json("b", &bad2.base_url)
            },
            "groups":{"g1":{"id":"g1","name":"g","profiles":["a","b"],"isDefault":true,"createdAt":"t","updatedAt":"t"}},
            "activeGroup":"g1"
        }),
    );
    let h = ProxyHandler::new(&handler_config(cfg, Some("g"), None));
    let resp = h
        .handle(
            "POST",
            "/v1/chat/completions",
            &bearer(),
            &Bytes::from(r#"{"model":"m"}"#),
        )
        .await;
    // 全失败 → 回传最后一个上游失败响应（502 + {"err":"b2"}）
    assert_eq!(resp.status, 502);
    assert_eq!(body_bytes(resp.body).await.as_ref(), br#"{"err":"b2"}"#);
}

#[tokio::test]
async fn group_all_failed_no_response_returns_503() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    // 两个 profile 都指向不可能存活的端口（连接异常，无上游响应）
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},
            "profiles":{
                "a":profile_json("a", "http://127.0.0.1:1"),
                "b":profile_json("b", "http://127.0.0.1:1")
            },
            "groups":{"g1":{"id":"g1","name":"g","profiles":["a","b"],"isDefault":true,"createdAt":"t","updatedAt":"t"}},
            "activeGroup":"g1"
        }),
    );
    let h = ProxyHandler::new(&handler_config(cfg, Some("g"), None));
    let resp = h
        .handle(
            "POST",
            "/v1/chat/completions",
            &bearer(),
            &Bytes::from(r#"{"model":"m"}"#),
        )
        .await;
    assert_eq!(resp.status, 503);
    let body = body_bytes(resp.body).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["error"], "All providers failed");
    assert_eq!(v["details"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn streaming_transform_end_to_end() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let sse = include_str!("fixtures/sse_openai_text.upstream.sse").to_string();
    let mock = MockUpstream::start(move || {
        (
            axum::http::StatusCode::OK,
            "text/event-stream".into(),
            axum::body::Body::from(sse.clone()),
        )
    })
    .await;
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},"groups":{},
            "profiles":{"p1":profile_json("p1", &mock.base_url)}
        }),
    );
    // anthropic 客户端（/v1/messages）→ custom wire_api=chat（openai_chat 上游）→ SSE 转换
    let h = ProxyHandler::new(&handler_config(cfg, None, Some("p1")));
    let resp = h
        .handle(
            "POST",
            "/v1/messages",
            &bearer(),
            &Bytes::from(r#"{"model":"m","stream":true,"messages":[{"role":"user","content":"hi"}],"max_tokens":16}"#),
        )
        .await;
    assert_eq!(resp.status, 200);
    assert!(resp
        .headers
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("text/event-stream"));
    let text = String::from_utf8(body_bytes(resp.body).await.to_vec()).unwrap();
    assert!(
        text.contains("event: message_start"),
        "missing message_start: {text}"
    );
    assert!(
        text.contains("event: content_block_delta"),
        "missing content_block_delta: {text}"
    );
    assert!(
        text.contains("event: message_stop"),
        "missing message_stop: {text}"
    );
}

#[tokio::test]
async fn model_rewrite_forced_override_reaches_upstream() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let mock = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "application/json".into(),
            axum::body::Body::from("{}"),
        )
    })
    .await;
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},"groups":{},
            "profiles":{"p1":{
                "name":"p1","providerId":"custom","apiKey":"sk","baseURL":mock.base_url,
                "models":{"anthropicModel":"real"},
                "createdAt":"t","updatedAt":"t"
            }}
        }),
    );
    let h = ProxyHandler::new(&handler_config(cfg, None, Some("p1")));
    let resp = h
        .handle(
            "POST",
            "/v1/chat/completions",
            &bearer(),
            &Bytes::from(r#"{"model":"whatever","messages":[]}"#),
        )
        .await;
    assert_eq!(resp.status, 200);
    let rec = mock.recorded.lock().unwrap();
    let sent: serde_json::Value = serde_json::from_slice(&rec[0].body).unwrap();
    assert_eq!(sent["model"], "real");
}

#[tokio::test]
async fn server_binds_and_health_works() {
    let dir = tempfile::tempdir().unwrap();
    let _reg = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let cfg = write_config(
        dir.path(),
        serde_json::json!({"version":"2.0.0","profiles":{},"coders":{},"groups":{}}),
    );
    let mut config = handler_config(cfg, None, Some("p1"));
    config.instance_id = "srv-test".into();
    config.port = 0; // 由 bind 分配实际端口
    let status = swixter_proxy::server::start_proxy_server(config.clone())
        .await
        .unwrap();
    assert_ne!(status.port, 0);
    assert_eq!(status.pid, Some(std::process::id()));
    assert!(status.start_time.is_some());

    // registry 写入实例
    let listed = registry::list_proxy_instances();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].instance_id, "srv-test");
    assert_eq!(listed[0].port, status.port);

    // GET /health 免鉴权
    let client = reqwest::Client::new();
    let resp = client
        .get(format!("http://127.0.0.1:{}/health", status.port))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = serde_json::from_str(&resp.text().await.unwrap()).unwrap();
    assert_eq!(v["status"], "ok");
    assert_eq!(v["instanceId"], "srv-test");

    // 未匹配路径 404 纯文本（带鉴权；无鉴权一律先 401）
    let resp = client
        .get(format!("http://127.0.0.1:{}/nope", status.port))
        .header("authorization", "Bearer swixter-local-proxy")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);

    assert!(swixter_proxy::server::stop_in_process_instance("srv-test").await);
    assert!(registry::list_proxy_instances().is_empty());
    // 再 stop → false
    assert!(!swixter_proxy::server::stop_in_process_instance("srv-test").await);
}

#[tokio::test]
async fn server_streaming_end_to_end_via_http() {
    let dir = tempfile::tempdir().unwrap();
    let _reg = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let sse = include_str!("fixtures/sse_openai_text.upstream.sse").to_string();
    let mock = MockUpstream::start(move || {
        (
            axum::http::StatusCode::OK,
            "text/event-stream".into(),
            axum::body::Body::from(sse.clone()),
        )
    })
    .await;
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},"groups":{},
            "profiles":{"p1":profile_json("p1", &mock.base_url)}
        }),
    );
    let mut config = handler_config(cfg, None, Some("p1"));
    config.instance_id = "srv-sse".into();
    config.port = 0;
    let status = swixter_proxy::server::start_proxy_server(config)
        .await
        .unwrap();

    let client = reqwest::Client::new();
    let resp = client
        .post(format!("http://127.0.0.1:{}/v1/messages", status.port))
        .header("authorization", "Bearer swixter-local-proxy")
        .header("content-type", "application/json")
        .body(r#"{"model":"m","stream":true,"messages":[{"role":"user","content":"hi"}],"max_tokens":16}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .contains("text/event-stream"));
    let text = resp.text().await.unwrap();
    assert!(
        text.contains("event: message_start"),
        "missing message_start: {text}"
    );
    assert!(
        text.contains("event: message_stop"),
        "missing message_stop: {text}"
    );

    assert!(swixter_proxy::server::stop_in_process_instance("srv-sse").await);
}

/// C2：openai_chat 客户端 + anthropic 上游（反向对未注册）→ group 跳过该 profile，不转发
#[tokio::test]
async fn group_skips_profile_without_registered_transformer() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    // baseURL 路径含 /anthropic → target = anthropic_messages
    let anthropic_upstream = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "application/json".into(),
            axum::body::Body::from(r#"{"should":"not reach"}"#),
        )
    })
    .await;
    let good = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "application/json".into(),
            axum::body::Body::from(r#"{"from":"good"}"#),
        )
    })
    .await;
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},
            "profiles":{
                "a":profile_json("a", &format!("{}/anthropic", anthropic_upstream.base_url)),
                "b":profile_json("b", &good.base_url)
            },
            "groups":{"g1":{"id":"g1","name":"g","profiles":["a","b"],"isDefault":true,"createdAt":"t","updatedAt":"t"}},
            "activeGroup":"g1"
        }),
    );
    let h = ProxyHandler::new(&handler_config(cfg, Some("g"), None));
    // /v1/chat/completions → client = openai_chat；a 为 anthropic 上游，无转换器 → 跳过；落到 b
    let resp = h
        .handle(
            "POST",
            "/v1/chat/completions",
            &bearer(),
            &Bytes::from(r#"{"model":"m"}"#),
        )
        .await;
    assert_eq!(resp.status, 200);
    assert_eq!(body_bytes(resp.body).await.as_ref(), br#"{"from":"good"}"#);
    assert_eq!(anthropic_upstream.recorded.lock().unwrap().len(), 0);
    assert_eq!(good.recorded.lock().unwrap().len(), 1);
}

/// C2：group 里只有反向对 profile → 全部跳过 → 503
#[tokio::test]
async fn group_all_skipped_returns_503() {
    let dir = tempfile::tempdir().unwrap();
    let _log = LogPathOverride::set(dir.path().to_path_buf());
    let anthropic_upstream = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "application/json".into(),
            axum::body::Body::from(r#"{}"#),
        )
    })
    .await;
    let cfg = write_config(
        dir.path(),
        serde_json::json!({
            "version":"2.0.0","coders":{},
            "profiles":{
                "a":profile_json("a", &format!("{}/anthropic", anthropic_upstream.base_url))
            },
            "groups":{"g1":{"id":"g1","name":"g","profiles":["a"],"isDefault":true,"createdAt":"t","updatedAt":"t"}},
            "activeGroup":"g1"
        }),
    );
    let h = ProxyHandler::new(&handler_config(cfg, Some("g"), None));
    let resp = h
        .handle(
            "POST",
            "/v1/chat/completions",
            &bearer(),
            &Bytes::from(r#"{"model":"m"}"#),
        )
        .await;
    assert_eq!(resp.status, 503);
    let body = body_bytes(resp.body).await;
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["error"], "All providers failed");
    assert_eq!(anthropic_upstream.recorded.lock().unwrap().len(), 0);
}
