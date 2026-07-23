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

/// TS: transformStream —— SSE 字节流经 SseChunker 切事件后逐事件转换，再序列化回字节流。
/// 上游流结束时 chunker.flush() 的残余事件追加在尾部。
pub fn transform_stream<S>(
    stream: S,
    ctx: &TransformCtx,
) -> std::pin::Pin<Box<dyn futures::Stream<Item = Result<bytes::Bytes, std::io::Error>> + Send>>
where
    S: futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + 'static,
{
    use futures::StreamExt;

    type Converter = Box<dyn FnMut(&crate::sse::SseEvent) -> Vec<streaming::SseOut> + Send>;
    let converter: Converter = match (ctx.client_format, ctx.target_format) {
        (ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat) => {
            let mut c = streaming::ChatToAnthropicStream::new();
            Box::new(move |ev| c.convert_event(ev))
        }
        (ApiFormat::OpenaiResponses, ApiFormat::OpenaiChat) => {
            let mut c = streaming::ChatToResponsesStream::new();
            Box::new(move |ev| c.convert_event(ev))
        }
        _ => unreachable!("transform_stream 只在 has_transformer 为真时调用"),
    };

    let render = |events: Vec<crate::sse::SseEvent>, converter: &mut Converter| -> String {
        events
            .iter()
            .flat_map(&mut *converter)
            .map(|o| crate::sse::serialize_sse_event(&o.event, &o.data_json))
            .collect()
    };

    let state = std::sync::Arc::new(std::sync::Mutex::new((
        crate::sse::SseChunker::new(),
        converter,
    )));
    let st = state.clone();
    let main = stream.filter_map(move |item| {
        let text = match item {
            Ok(bytes) => {
                let mut guard = st.lock().unwrap();
                let (chunker, converter) = &mut *guard;
                let events = chunker.feed(&bytes);
                render(events, converter)
            }
            Err(e) => return futures::future::ready(Some(Err(std::io::Error::other(e)))),
        };
        futures::future::ready(if text.is_empty() {
            None
        } else {
            Some(Ok(bytes::Bytes::from(text)))
        })
    });
    let tail = futures::stream::once(async move {
        let mut guard = state.lock().unwrap();
        let (chunker, converter) = &mut *guard;
        let events = chunker.flush();
        render(events, converter)
    })
    .filter_map(|text| {
        futures::future::ready(if text.is_empty() {
            None
        } else {
            Some(Ok(bytes::Bytes::from(text)))
        })
    });
    Box::pin(main.chain(tail))
}
