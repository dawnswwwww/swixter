pub mod request;
pub mod response;
pub mod streaming;

use serde_json::Value;
use swixter_core::types::{ApiFormat, Profile, ProviderPreset, WireApi};

use crate::ProxyError;

#[derive(Debug, Clone)]
pub struct TransformCtx {
    pub endpoint: String, // path + query
    pub client_format: ApiFormat,
    pub target_format: ApiFormat,
    pub stream: bool,
}

pub struct TransformedRequest {
    pub body: Value,
    pub target_endpoint: String,
}

/// TS: transform/index.ts inferClientFormat
pub fn infer_client_format(endpoint: &str) -> ApiFormat {
    if endpoint.contains("/v1/chat/completions") {
        return ApiFormat::OpenaiChat;
    }
    // /v1/responses 无歧义地是 OpenAI Responses（真实 anthropic_responses 客户端不存在）
    if endpoint.contains("/v1/responses") {
        return ApiFormat::OpenaiResponses;
    }
    ApiFormat::AnthropicMessages // 含 /anthropic/ 与 /v1/messages 及默认
}

/// TS: inferApiFormatFromBaseURL
pub fn infer_api_format_from_base_url(base_url: &str) -> Option<ApiFormat> {
    let url = url::Url::parse(base_url).ok()?;
    let path = url.path().to_lowercase();
    if path.contains("/anthropic") {
        return Some(ApiFormat::AnthropicMessages);
    }
    if path.contains("/responses") {
        return Some(ApiFormat::AnthropicResponses);
    }
    if path.contains("/openai") {
        return Some(ApiFormat::OpenaiChat);
    }
    None
}

/// TS: inferTargetApiFormat —— apiFormat > baseURL 路径 > preset.defaultApiFormat > wire_api 兜底
pub fn infer_target_api_format(profile: &Profile, preset: Option<&ProviderPreset>) -> ApiFormat {
    if let Some(f) = profile.api_format {
        return f;
    }
    let base = profile
        .base_url
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(preset.map(|p| p.base_url.as_str()))
        .unwrap_or("");
    if let Some(f) = infer_api_format_from_base_url(base) {
        return f;
    }
    if let Some(f) = preset.and_then(|p| p.default_api_format) {
        return f;
    }
    match preset.and_then(|p| p.wire_api) {
        Some(WireApi::Chat) => ApiFormat::OpenaiChat,
        Some(WireApi::Responses) => ApiFormat::AnthropicMessages,
        None => ApiFormat::OpenaiChat,
    }
}

/// TS: TRANSFORMER_REGISTRY —— 仅 2 对；Rust 用 match 静态分派代替运行时注册
pub fn has_transformer(client: ApiFormat, target: ApiFormat) -> bool {
    use ApiFormat::*;
    matches!(
        (client, target),
        (AnthropicMessages, OpenaiChat)
            | (OpenaiChat, AnthropicMessages)
            | (OpenaiResponses, OpenaiChat)
            | (OpenaiChat, OpenaiResponses)
    )
}

pub fn transform_request(
    body: &Value,
    ctx: &TransformCtx,
) -> Result<TransformedRequest, ProxyError> {
    use ApiFormat::*;
    match (ctx.client_format, ctx.target_format) {
        (AnthropicMessages, OpenaiChat) => request::anthropic_to_openai_chat(body, ctx),
        (OpenaiResponses, OpenaiChat) => request::openai_responses_to_openai_chat(body, ctx),
        // 反向（openai_chat 客户端 → anthropic 上游）TS 未注册请求转换器；
        // client==target 由调用方直通，不会走到这里
        _ => Ok(TransformedRequest {
            body: body.clone(),
            target_endpoint: ctx.endpoint.clone(),
        }),
    }
}

/// TS: transformResponse —— 响应从 target 格式转回 client 格式
pub fn transform_response(body: &Value, ctx: &TransformCtx) -> Result<Value, ProxyError> {
    use ApiFormat::*;
    match (ctx.client_format, ctx.target_format) {
        (AnthropicMessages, OpenaiChat) => response::openai_chat_to_anthropic(body),
        (OpenaiResponses, OpenaiChat) => response::openai_chat_to_openai_responses(body),
        _ => Ok(body.clone()),
    }
}
