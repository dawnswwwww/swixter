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
    h.insert("accept-encoding", "gzip, deflate, br".parse().unwrap());
    h.insert("x-custom", "keep".parse().unwrap());
    let out = filtered_headers(&h, ApiFormat::AnthropicMessages, "sk-real").unwrap();
    assert!(
        out.get("authorization").is_none()
            || out.get("authorization").unwrap() != "Bearer swixter-local-proxy"
    );
    assert_eq!(out.get("x-api-key").unwrap(), "sk-real");
    assert!(out.get("host").is_none());
    assert!(out.get("content-length").is_none());
    // 客户端的 accept-encoding 不转发：由 reqwest 按自身解压能力重新声明
    assert!(out.get("accept-encoding").is_none());
    assert_eq!(out.get("x-custom").unwrap(), "keep");
    // openai 目标 → Bearer
    let out2 = filtered_headers(&h, ApiFormat::OpenaiChat, "sk-real").unwrap();
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

/// I2：凭据含换行等非法 header 字符时返回错误而非 panic
#[test]
fn invalid_credential_chars_return_error_not_panic() {
    let h = reqwest::header::HeaderMap::new();
    let err = filtered_headers(&h, ApiFormat::OpenaiChat, "sk-bad\nkey").unwrap_err();
    assert!(matches!(err, swixter_proxy::ProxyError::Transform(_)));
    let err = filtered_headers(&h, ApiFormat::AnthropicMessages, "sk-bad\rkey").unwrap_err();
    assert!(matches!(err, swixter_proxy::ProxyError::Transform(_)));
}

/// I2：handler 层——含 \n 的 apiKey 走 forward 返回 Err（单 profile 502 / group 转移的上游异常路径）
#[tokio::test]
async fn forward_with_newline_credential_errors_not_panics() {
    let mut p = profile("http://127.0.0.1:1"); // 不需要可达上游：header 构造先失败
    p.api_key = "sk-bad\nkey".into();
    let err = Forwarder::new()
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
        .await;
    let Err(err) = err else {
        panic!("expected Transform error, got Ok response")
    };
    assert!(matches!(err, swixter_proxy::ProxyError::Transform(_)));
}

/// I1：timeout 只覆盖到响应头；流式 body 慢于 timeout 也不被掐断
#[tokio::test]
async fn slow_streaming_body_not_cut_by_header_timeout() {
    let mock = MockUpstream::start(|| {
        // 响应头立即返回，body 分 3 段每段间隔 150ms（总 450ms > timeout 200ms）
        let stream = futures::stream::unfold(0u8, |i| async move {
            if i >= 3 {
                return None;
            }
            tokio::time::sleep(Duration::from_millis(150)).await;
            let chunk: Result<bytes::Bytes, std::io::Error> =
                Ok(bytes::Bytes::from("data: {}\n\n"));
            Some((chunk, i + 1))
        });
        (
            axum::http::StatusCode::OK,
            "text/event-stream".into(),
            axum::body::Body::from_stream(stream),
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
            Duration::from_millis(200),
            ApiFormat::OpenaiChat,
        )
        .await
        .unwrap();
    assert!(resp.is_stream);
    let ForwardBody::Stream(s) = resp.body else {
        panic!("expected stream body")
    };
    use futures::StreamExt;
    let chunks: Vec<_> = s.collect().await;
    assert_eq!(chunks.len(), 3, "stream must not be cut by timeout");
    assert!(chunks.iter().all(|c| c.is_ok()));
}

/// I1 反向佐证：响应头本身超时仍报错
#[tokio::test]
async fn header_timeout_still_applies() {
    // 裸 TCP listener：接受连接但永不回字节（响应头超时场景）
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let mut held = Vec::new();
        loop {
            let (sock, _) = listener.accept().await.unwrap();
            held.push(sock); // 持有连接，永不响应
        }
    });
    let p = profile(&format!("http://{addr}"));
    let err = Forwarder::new()
        .forward(
            ForwardRequest {
                method: "POST".into(),
                path: "/v1/chat/completions".into(),
                headers: Default::default(),
                body: bytes::Bytes::from("{}"),
            },
            &p,
            None,
            Duration::from_millis(200),
            ApiFormat::OpenaiChat,
        )
        .await;
    let Err(err) = err else {
        panic!("expected header timeout error, got Ok response")
    };
    assert!(matches!(err, swixter_proxy::ProxyError::Transform(_)));
}
