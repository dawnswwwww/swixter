use serde_json::Value;
use swixter_core::types::{ApiFormat, Profile, ProviderPreset, WireApi};
use swixter_proxy::transform::*;

fn fixture(name: &str) -> Value {
    let p = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn ctx(client: ApiFormat, target: ApiFormat) -> TransformCtx {
    TransformCtx {
        endpoint: "/v1/messages".into(),
        client_format: client,
        target_format: target,
        stream: false,
    }
}

#[test]
fn anthropic_basic_matches_fixture() {
    let out = transform_request(
        &fixture("req_anthropic_basic.json"),
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat),
    )
    .unwrap();
    assert_eq!(out.target_endpoint, "/v1/chat/completions");
    assert_eq!(out.body, fixture("req_anthropic_basic.expected.json"));
}

#[test]
fn anthropic_tools_matches_fixture() {
    let out = transform_request(
        &fixture("req_anthropic_tools.json"),
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat),
    )
    .unwrap();
    assert_eq!(out.target_endpoint, "/v1/chat/completions");
    assert_eq!(out.body, fixture("req_anthropic_tools.expected.json"));
}

#[test]
fn responses_basic_matches_fixture() {
    let mut c = ctx(ApiFormat::OpenaiResponses, ApiFormat::OpenaiChat);
    c.endpoint = "/v1/responses".into();
    let out = transform_request(&fixture("req_responses_basic.json"), &c).unwrap();
    assert_eq!(out.target_endpoint, "/v1/chat/completions");
    assert_eq!(out.body, fixture("req_responses_basic.expected.json"));
}

#[test]
fn unsupported_pair_passes_through() {
    let body = serde_json::json!({"model": "m"});
    let c = ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiResponses);
    let out = transform_request(&body, &c).unwrap();
    assert_eq!(out.body, body);
    assert_eq!(out.target_endpoint, "/v1/messages");
}

#[test]
fn infer_client_format_rules() {
    assert_eq!(
        infer_client_format("/v1/chat/completions"),
        ApiFormat::OpenaiChat
    );
    assert_eq!(
        infer_client_format("/v1/responses"),
        ApiFormat::OpenaiResponses
    );
    assert_eq!(
        infer_client_format("/anthropic/v1/messages"),
        ApiFormat::AnthropicMessages
    );
    assert_eq!(
        infer_client_format("/v1/messages"),
        ApiFormat::AnthropicMessages
    );
    assert_eq!(
        infer_client_format("/anything/else"),
        ApiFormat::AnthropicMessages
    );
}

#[test]
fn infer_target_format_priority_chain() {
    let mut p = Profile {
        provider_id: "custom".into(),
        ..Default::default()
    };
    let preset = ProviderPreset {
        wire_api: Some(WireApi::Responses),
        ..Default::default()
    };
    // 1. apiFormat 显式
    p.api_format = Some(ApiFormat::OpenaiChat);
    assert_eq!(
        infer_target_api_format(&p, Some(&preset)),
        ApiFormat::OpenaiChat
    );
    // 2. baseURL 路径
    p.api_format = None;
    p.base_url = Some("https://x.com/anthropic".into());
    assert_eq!(
        infer_target_api_format(&p, Some(&preset)),
        ApiFormat::AnthropicMessages
    );
    // 4. wire_api 兜底（default_api_format 为 None 时）
    p.base_url = Some("https://x.com".into());
    assert_eq!(
        infer_target_api_format(&p, Some(&preset)),
        ApiFormat::AnthropicMessages
    );
    // 无 preset → 默认 openai_chat
    assert_eq!(infer_target_api_format(&p, None), ApiFormat::OpenaiChat);
}

#[test]
fn has_transformer_only_two_pairs() {
    use ApiFormat::*;
    assert!(has_transformer(AnthropicMessages, OpenaiChat));
    assert!(has_transformer(OpenaiChat, AnthropicMessages));
    assert!(has_transformer(OpenaiResponses, OpenaiChat));
    assert!(has_transformer(OpenaiChat, OpenaiResponses));
    assert!(!has_transformer(AnthropicMessages, OpenaiResponses));
    assert!(!has_transformer(GeminiNative, OpenaiChat));
}

#[test]
fn tool_name_filter_rejects_double_underscore() {
    assert!(request::valid_tool_name("get_weather"));
    assert!(request::valid_tool_name("a".repeat(64).as_str()));
    assert!(!request::valid_tool_name("mcp__tool"));
    assert!(!request::valid_tool_name("1abc"));
    assert!(!request::valid_tool_name("has space"));
    assert!(!request::valid_tool_name("a".repeat(65).as_str()));
}

#[test]
fn responses_flatten_text_unsupported_part_errors() {
    let body = serde_json::json!({
        "model": "m",
        "input": [
            { "type": "message", "role": "user",
              "content": [ { "type": "input_image", "image_url": "data:..." } ] }
        ]
    });
    let c = ctx(ApiFormat::OpenaiResponses, ApiFormat::OpenaiChat);
    assert!(transform_request(&body, &c).is_err());
}
