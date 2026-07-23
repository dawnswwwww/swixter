mod common;
use common::MockUpstream;
use std::time::Duration;
use swixter_core::types::{ApiFormat, Profile};
use swixter_proxy::forwarder::*;

fn profile(base_url: &str) -> Profile {
    Profile {
        name: "p1".into(),
        provider_id: "custom".into(),
        api_key: "sk-real".into(),
        base_url: Some(base_url.into()),
        ..Default::default()
    }
}

#[test]
fn url_join_trims_slashes_and_dedups_v1() {
    let p = profile("https://api.example.com/v1/");
    assert_eq!(
        build_upstream_url(&p, None, "/v1/chat/completions?a=1"),
        "https://api.example.com/v1/chat/completions?a=1"
    );
    let p2 = profile("https://api.example.com/anthropic");
    assert_eq!(
        build_upstream_url(&p2, None, "/v1/messages"),
        "https://api.example.com/anthropic/v1/messages"
    );
}

#[test]
fn headers_stripped_and_credential_injected() {
    let mut h = reqwest::header::HeaderMap::new();
    h.insert(
        "authorization",
        "Bearer swixter-local-proxy".parse().unwrap(),
    );
    h.insert("x-api-key", "old".parse().unwrap());
    h.insert("host", "localhost".parse().unwrap());
    h.insert("content-length", "10".parse().unwrap());
    h.insert("x-custom", "keep".parse().unwrap());
    let out = filtered_headers(&h, ApiFormat::AnthropicMessages, "sk-real");
    assert!(
        out.get("authorization").is_none()
            || out.get("authorization").unwrap() != "Bearer swixter-local-proxy"
    );
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
    let mock = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "application/json".into(),
            axum::body::Body::from("{}"),
        )
    })
    .await;
    let p = profile(&mock.base_url);
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert("content-type", "application/json".parse().unwrap());
    let resp = Forwarder::new()
        .forward(
            ForwardRequest {
                method: "POST".into(),
                path: "/v1/chat/completions".into(),
                headers,
                body: bytes::Bytes::from("{}"),
            },
            &p,
            None,
            Duration::from_secs(5),
            ApiFormat::OpenaiChat,
        )
        .await
        .unwrap();
    assert_eq!(resp.status, 200);
    assert!(!resp.is_stream);
    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec[0].method, "POST");
    assert_eq!(rec[0].path, "/v1/chat/completions");
    assert!(rec[0]
        .headers
        .iter()
        .any(|(k, v)| k == "authorization" && v == "Bearer sk-real"));
}

#[tokio::test]
async fn forward_detects_sse_stream() {
    let mock = MockUpstream::start(|| {
        (
            axum::http::StatusCode::OK,
            "text/event-stream".into(),
            axum::body::Body::from("data: {}\n\n"),
        )
    })
    .await;
    let p = profile(&mock.base_url);
    let resp = Forwarder::new()
        .forward(
            ForwardRequest {
                method: "POST".into(),
                path: "/v1/chat/completions".into(),
                headers: Default::default(),
                body: bytes::Bytes::from("{}"),
            },
            &p,
            None,
            Duration::from_secs(5),
            ApiFormat::OpenaiChat,
        )
        .await
        .unwrap();
    assert!(resp.is_stream);
}
