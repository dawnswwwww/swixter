use serde_json::Value;
use swixter_core::types::ApiFormat;
use swixter_proxy::transform::response::map_finish_reason;
use swixter_proxy::transform::{transform_response, TransformCtx};

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
fn openai_basic_to_anthropic_matches_fixture() {
    let out = transform_response(
        &fixture("resp_openai_basic.json"),
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat),
    )
    .unwrap();
    assert_eq!(out, fixture("resp_openai_basic.expected.json"));
}

#[test]
fn openai_tools_to_anthropic_matches_fixture() {
    let out = transform_response(
        &fixture("resp_openai_tools.json"),
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat),
    )
    .unwrap();
    assert_eq!(out, fixture("resp_openai_tools.expected.json"));
}

#[test]
fn no_choices_returns_body_unchanged() {
    let body = serde_json::json!({"id": "x"});
    let out = transform_response(
        &body,
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiChat),
    )
    .unwrap();
    assert_eq!(out, body);
}

#[test]
fn finish_reason_mapping() {
    assert_eq!(
        map_finish_reason(Some("stop")),
        serde_json::json!("end_turn")
    );
    assert_eq!(
        map_finish_reason(Some("length")),
        serde_json::json!("max_tokens")
    );
    assert_eq!(
        map_finish_reason(Some("tool_calls")),
        serde_json::json!("tool_use")
    );
    assert_eq!(
        map_finish_reason(Some("function_call")),
        serde_json::json!("tool_use")
    );
    assert_eq!(
        map_finish_reason(Some("content_filter")),
        serde_json::json!("end_turn")
    );
    assert_eq!(
        map_finish_reason(Some("weird_new_reason")),
        serde_json::json!("weird_new_reason")
    );
    assert_eq!(map_finish_reason(None), serde_json::Value::Null);
}

#[test]
fn openai_to_responses_shape() {
    let body = serde_json::json!({
        "id": "chatcmpl-1",
        "choices": [{
            "message": {
                "content": "hi",
                "tool_calls": [{"id": "c1", "function": {"name": "f", "arguments": "{}"}}]
            },
            "finish_reason": "length"
        }],
        "usage": {"prompt_tokens": 3, "completion_tokens": 5}
    });
    let out = transform_response(
        &body,
        &ctx(ApiFormat::OpenaiResponses, ApiFormat::OpenaiChat),
    )
    .unwrap();
    assert_eq!(out["id"], "resp_chatcmpl-1");
    assert_eq!(out["status"], "incomplete");
    assert_eq!(out["output"][0]["type"], "message");
    assert_eq!(
        out["output"][0]["content"][0]["annotations"],
        serde_json::json!([])
    );
    assert_eq!(out["output"][1]["type"], "function_call");
    assert_eq!(out["output"][1]["id"], "fc_0");
    assert_eq!(out["usage"]["total_tokens"], 8);
}

#[test]
fn unsupported_pair_passes_response_through() {
    let body = serde_json::json!({"id": "x", "choices": []});
    let out = transform_response(
        &body,
        &ctx(ApiFormat::AnthropicMessages, ApiFormat::OpenaiResponses),
    )
    .unwrap();
    assert_eq!(out, body);
}
