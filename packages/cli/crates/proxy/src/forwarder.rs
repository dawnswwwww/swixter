use bytes::Bytes;
use futures::Stream;
use reqwest::header::{HeaderMap, HeaderValue};
use std::pin::Pin;
use std::time::Duration;
use swixter_core::types::{ApiFormat, Profile, ProviderPreset};

use crate::ProxyError;

pub struct ForwardRequest {
    pub method: String,
    pub path: String, // path + query
    pub headers: HeaderMap,
    pub body: Bytes,
}

pub enum ForwardBody {
    Full(Bytes),
    Stream(Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>),
}

pub struct ForwardResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub is_stream: bool,
    pub body: ForwardBody,
}

// accept-encoding 一并剔除：规范上游回 identity（reqwest 虽启用了 gzip/brotli 自动解压，
// 但那是防御仍回 gzip 的上游；首选还是不让上游压缩，避免压缩字节流入 SseChunker）
const STRIP_HEADERS: [&str; 5] = [
    "authorization",
    "x-api-key",
    "content-length",
    "host",
    "accept-encoding",
];

/// TS: baseURL = (profile.baseURL || preset.baseURL).replace(/\/+$/,"")；
/// base 以 /v1 结尾且 path 以 /v1/ 开头 → path 去掉前 3 字符
pub fn build_upstream_url(
    profile: &Profile,
    preset: Option<&ProviderPreset>,
    path: &str,
) -> String {
    let base = profile
        .base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(preset.map(|p| p.base_url.as_str()))
        .unwrap_or("");
    let base = base.trim_end_matches('/');
    let path = if base.ends_with("/v1") && path.starts_with("/v1/") {
        &path[3..]
    } else {
        path
    };
    format!("{base}{path}")
}

/// TS: 剔除 authorization/x-api-key/content-length/host（大小写不敏感，HeaderMap name 已小写）；
/// credential 非空时按目标格式注入。凭据含换行/非 Latin-1 等非法字符时返回错误而非 panic。
pub fn filtered_headers(
    src: &HeaderMap,
    target_format: ApiFormat,
    credential: &str,
) -> Result<HeaderMap, ProxyError> {
    let mut out = HeaderMap::new();
    for (name, value) in src.iter() {
        if STRIP_HEADERS.contains(&name.as_str()) {
            continue;
        }
        out.insert(name.clone(), value.clone());
    }
    if !credential.is_empty() {
        let is_anthropic = matches!(
            target_format,
            ApiFormat::AnthropicMessages | ApiFormat::AnthropicResponses
        );
        let value = if is_anthropic {
            credential.to_string()
        } else {
            format!("Bearer {credential}")
        };
        let value = HeaderValue::from_str(&value).map_err(|e| {
            ProxyError::Transform(format!(
                "credential contains invalid header characters: {e}"
            ))
        })?;
        if is_anthropic {
            out.insert("x-api-key", value);
        } else {
            out.insert("authorization", value);
        }
    }
    Ok(out)
}

/// TS: credential = profile.authToken || profile.apiKey || ""（JS || 跳过空字符串）
pub fn credential_of(profile: &Profile) -> &str {
    profile
        .auth_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(Some(profile.api_key.as_str()).filter(|s| !s.is_empty()))
        .unwrap_or("")
}

pub struct Forwarder {
    client: reqwest::Client,
}

impl Forwarder {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::builder().build().expect("reqwest client"),
        }
    }

    pub async fn forward(
        &self,
        req: ForwardRequest,
        profile: &Profile,
        preset: Option<&ProviderPreset>,
        timeout: Duration,
        target_format: ApiFormat,
    ) -> Result<ForwardResponse, ProxyError> {
        let url = build_upstream_url(profile, preset, &req.path);
        let headers = filtered_headers(&req.headers, target_format, credential_of(profile))?;
        let method = reqwest::Method::from_bytes(req.method.as_bytes())
            .map_err(|e| ProxyError::Transform(format!("bad method: {e}")))?;

        // TS 语义：timeout 只到拿到响应头为止；流式 body 不设总时限（reqwest .timeout() 会覆盖整个 body 读取）
        let resp = tokio::time::timeout(
            timeout,
            self.client
                .request(method, &url)
                .headers(headers)
                .body(req.body)
                .send(),
        )
        .await
        .map_err(|_| {
            ProxyError::Transform(format!("upstream response header timeout ({timeout:?})"))
        })??;

        let status = resp.status().as_u16();
        let headers = resp.headers().clone();
        let content_type = headers
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let is_stream = content_type.contains("text/event-stream")
            || content_type.contains("application/x-ndjson");

        let body = if is_stream {
            ForwardBody::Stream(Box::pin(resp.bytes_stream()))
        } else {
            ForwardBody::Full(resp.bytes().await?)
        };
        Ok(ForwardResponse {
            status,
            headers,
            is_stream,
            body,
        })
    }
}

impl Default for Forwarder {
    fn default() -> Self {
        Self::new()
    }
}
