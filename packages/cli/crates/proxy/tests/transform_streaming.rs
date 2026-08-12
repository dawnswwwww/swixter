use swixter_proxy::sse::{parse_sse_events, SseData, SseEvent};
use swixter_proxy::transform::streaming::*;

fn upstream_events(name: &str) -> Vec<SseEvent> {
    let text = std::fs::read_to_string(format!(
        "{}/tests/fixtures/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap();
    parse_sse_events(&text)
}

fn run_converter(
    mut conv: impl FnMut(&SseEvent) -> Vec<SseOut>,
    events: &[SseEvent],
) -> Vec<(String, serde_json::Value)> {
    events
        .iter()
        .flat_map(&mut conv)
        .map(|o| (o.event, serde_json::from_str(&o.data_json).unwrap()))
        .collect()
}

fn expected_events(name: &str) -> Vec<(String, serde_json::Value)> {
    upstream_events(name)
        .into_iter()
        .map(|e| {
            let SseData::Json(data) = e.data else {
                panic!("expected fixture must be JSON events")
            };
            (e.event, data)
        })
        .collect()
}

#[test]
fn openai_text_to_anthropic_event_sequence() {
    let mut c = ChatToAnthropicStream::new();
    let out = run_converter(
        |e| c.convert_event(e),
        &upstream_events("sse_openai_text.upstream.sse"),
    );
    let expected = expected_events("sse_openai_text.expected_anthropic.sse");
    assert_eq!(out, expected);
}

#[test]
fn openai_tools_to_anthropic_full_sequence() {
    let mut c = ChatToAnthropicStream::new();
    let out = run_converter(
        |e| c.convert_event(e),
        &upstream_events("sse_openai_tools.upstream.sse"),
    );
    let expected = expected_events("sse_openai_tools.expected_anthropic.sse");
    assert_eq!(out, expected);
}

#[test]
fn openai_tools_to_anthropic_incremental_arguments() {
    let mut c = ChatToAnthropicStream::new();
    let out = run_converter(
        |e| c.convert_event(e),
        &upstream_events("sse_openai_tools.upstream.sse"),
    );
    // block_start 在 id+name 凑齐的 chunk 才发出；两次 input_json_delta 的 partial_json 拼接 == 完整 arguments
    let deltas: Vec<&serde_json::Value> = out
        .iter()
        .filter(|(e, _)| e == "content_block_delta")
        .map(|(_, d)| d)
        .collect();
    let joined: String = deltas
        .iter()
        .filter_map(|d| d.pointer("/delta/partial_json").and_then(|v| v.as_str()))
        .collect();
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&joined).unwrap()["city"],
        "Paris"
    );
    // 只发出一次 message_start / message_stop
    assert_eq!(out.iter().filter(|(e, _)| e == "message_start").count(), 1);
    assert_eq!(out.iter().filter(|(e, _)| e == "message_stop").count(), 1);
}

#[test]
fn done_sentinel_dropped() {
    let mut c = ChatToAnthropicStream::new();
    let ev = SseEvent {
        event: String::new(),
        data: SseData::Done,
    };
    assert!(c.convert_event(&ev).is_empty());
}

#[test]
fn openai_to_responses_ignores_reasoning_and_captures_usage() {
    let mut c = ChatToResponsesStream::new();
    let events = parse_sse_events(concat!(
        "data: {\"id\":\"c1\",\"model\":\"kimi-k2\",\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"},\"index\":0}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"delta\":{\"content\":\"hi\"},\"index\":0}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\",\"index\":0}]}\n\n",
        "data: {\"id\":\"c1\",\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":1}}\n\n",
    ));
    let out = run_converter(|e| c.convert_event(e), &events);
    assert!(out
        .iter()
        .all(|(_, d)| d.get("type").and_then(|t| t.as_str()) != Some("response.reasoning.delta")));
    let completed = out
        .iter()
        .find(|(_, d)| d["type"] == "response.completed")
        .unwrap();
    assert_eq!(completed.1["response"]["usage"]["input_tokens"], 3);
    assert_eq!(completed.1["response"]["usage"]["output_tokens"], 1);
    assert_eq!(completed.1["response"]["usage"]["total_tokens"], 4);
    assert_eq!(completed.1["response"]["id"], "resp_c1");
}

#[test]
fn openai_to_responses_tool_lifecycle() {
    let mut c = ChatToResponsesStream::new();
    let events = parse_sse_events(concat!(
        "data: {\"id\":\"c2\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_9\",\"function\":{\"name\":\"shell\",\"arguments\":\"\"}}]},\"index\":0}]}\n\n",
        "data: {\"id\":\"c2\",\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"cmd\\\":\\\"ls\\\"}\"}}]},\"index\":0}]}\n\n",
        "data: {\"id\":\"c2\",\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\",\"index\":0}]}\n\n",
        "data: [DONE]\n\n",
    ));
    let out = run_converter(|e| c.convert_event(e), &events);
    let types: Vec<&str> = out.iter().filter_map(|(_, d)| d["type"].as_str()).collect();
    assert_eq!(
        types,
        [
            "response.created",
            "response.output_item.added",
            "response.function_call_arguments.delta",
            "response.function_call_arguments.done",
            "response.output_item.done",
            "response.completed",
        ]
    );
    // fc_<idx> + callId 透传 tc.id
    let added = &out[1].1;
    assert_eq!(added["item"]["id"], "fc_0");
    assert_eq!(added["item"]["call_id"], "call_9");
    // completed 的 output 含完整 arguments
    let completed = out.last().unwrap();
    assert_eq!(
        completed.1["response"]["output"][0]["arguments"],
        "{\"cmd\":\"ls\"}"
    );
}

/// C1：finish chunk 后无 [DONE] 直接断流，drain 仍发出挂起的 response.completed
#[test]
fn responses_drain_emits_pending_completed_after_abrupt_eof() {
    let mut c = ChatToResponsesStream::new();
    let events = parse_sse_events(concat!(
        "data: {\"id\":\"c8\",\"model\":\"kimi-k2\",\"choices\":[{\"delta\":{\"content\":\"hi\"},\"index\":0}]}\n\n",
        "data: {\"id\":\"c8\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\",\"index\":0}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
    ));
    let out = run_converter(|e| c.convert_event(e), &events);
    // finish 时只发 done 系列，completed 挂起
    assert!(out.iter().all(|(_, d)| d["type"] != "response.completed"));
    let drained = c.drain();
    assert_eq!(drained.len(), 1);
    let data: serde_json::Value = serde_json::from_str(&drained[0].data_json).unwrap();
    assert_eq!(drained[0].event, "response.completed");
    assert_eq!(data["type"], "response.completed");
    // 带最新捕获的 usage
    assert_eq!(data["response"]["usage"]["input_tokens"], 5);
    assert_eq!(data["response"]["usage"]["output_tokens"], 2);
    assert_eq!(data["response"]["usage"]["total_tokens"], 7);
    assert_eq!(data["response"]["status"], "completed");
    // drain 幂等：再次调用无事件
    assert!(c.drain().is_empty());
}

#[test]
fn anthropic_drain_is_empty() {
    let mut c = ChatToAnthropicStream::new();
    let events = parse_sse_events(concat!(
        "data: {\"id\":\"c9\",\"model\":\"m\",\"choices\":[{\"delta\":{\"content\":\"hi\"},\"index\":0}]}\n\n",
        "data: {\"id\":\"c9\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\",\"index\":0}]}\n\n",
    ));
    let _ = run_converter(|e| c.convert_event(e), &events);
    assert!(c.drain().is_empty());
}

/// C1：transform_stream 端到端 —— 上游 finish 后直接 EOF（无 [DONE]），completed 不丢失
#[tokio::test]
async fn transform_stream_drains_completed_when_upstream_ends_without_done() {
    use futures::StreamExt;
    use swixter_core::types::ApiFormat;
    use swixter_proxy::transform::{transform_stream, TransformCtx};

    let sse = concat!(
        "data: {\"id\":\"c10\",\"model\":\"kimi-k2\",\"choices\":[{\"delta\":{\"content\":\"hi\"},\"index\":0}]}\n\n",
        "data: {\"id\":\"c10\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\",\"index\":0}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":2,\"total_tokens\":7}}\n\n",
    );
    let chunks: Vec<Result<bytes::Bytes, reqwest::Error>> = vec![Ok(bytes::Bytes::from(sse))];
    let upstream = futures::stream::iter(chunks);
    let ctx = TransformCtx {
        endpoint: "/v1/responses".into(),
        client_format: ApiFormat::OpenaiResponses,
        target_format: ApiFormat::OpenaiChat,
        stream: true,
    };
    let mut out = transform_stream(upstream, &ctx);
    let mut text = String::new();
    while let Some(item) = out.next().await {
        text.push_str(std::str::from_utf8(&item.unwrap()).unwrap());
    }
    assert!(
        text.contains("\"type\":\"response.completed\""),
        "missing response.completed: {text}"
    );
    assert!(text.contains("\"input_tokens\":5"), "missing usage: {text}");
    assert!(text.contains("\"total_tokens\":7"), "missing usage: {text}");
}

/// C2 防御：无转换器的组合透传原始流而非 panic
#[tokio::test]
async fn transform_stream_passthrough_for_unregistered_pair() {
    use futures::StreamExt;
    use swixter_core::types::ApiFormat;
    use swixter_proxy::transform::{transform_stream, TransformCtx};

    let sse = "data: {\"id\":\"x\",\"choices\":[]}\n\n";
    let chunks: Vec<Result<bytes::Bytes, reqwest::Error>> = vec![Ok(bytes::Bytes::from(sse))];
    let upstream = futures::stream::iter(chunks);
    let ctx = TransformCtx {
        endpoint: "/v1/chat/completions".into(),
        client_format: ApiFormat::OpenaiChat,
        target_format: ApiFormat::AnthropicMessages,
        stream: true,
    };
    let mut out = transform_stream(upstream, &ctx);
    let mut text = String::new();
    while let Some(item) = out.next().await {
        text.push_str(std::str::from_utf8(&item.unwrap()).unwrap());
    }
    assert_eq!(text, sse); // 原样透传
}
