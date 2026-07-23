use serde_json::{json, Map, Value};

use crate::ProxyError;

/// stop→end_turn、length→max_tokens、tool_calls/function_call→tool_use、
/// content_filter→end_turn、其他直通、null→Null（事实表 §非流式响应；流式转换器复用）
pub fn map_finish_reason(reason: Option<&str>) -> Value {
    match reason {
        None => Value::Null,
        Some("stop") | Some("content_filter") => json!("end_turn"),
        Some("length") => json!("max_tokens"),
        Some("tool_calls") | Some("function_call") => json!("tool_use"),
        Some(other) => json!(other),
    }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

/// TS: convertOpenAIToolCallsToAnthropic —— input = JSON.parse(arguments)，parse 失败 → {}
fn tool_calls_to_tool_use(tool_calls: &[Value]) -> Vec<Value> {
    tool_calls
        .iter()
        .map(|tc| {
            let func = tc.get("function").cloned().unwrap_or(Value::Null);
            let name = func
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let input = func
                .get("arguments")
                .and_then(Value::as_str)
                .and_then(|args| serde_json::from_str::<Value>(args).ok())
                .unwrap_or_else(|| json!({}));
            json!({
                "type": "tool_use",
                "id": tc.get("id").cloned().unwrap_or(Value::Null),
                "name": name,
                "input": input,
            })
        })
        .collect()
}

/// 事实表「非流式响应 OpenAI Chat → Anthropic」逐条
pub fn openai_chat_to_anthropic(body: &Value) -> Result<Value, ProxyError> {
    let Some(choice) = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first())
    else {
        return Ok(body.clone()); // 无 choices → 原样返回
    };
    let Some(message) = choice.get("message") else {
        return Ok(body.clone()); // 无 message → 原样返回（对齐 TS）
    };

    let mut content: Vec<Value> = Vec::new();

    // 1. reasoning_content → thinking block
    if let Some(reasoning) = message.get("reasoning_content").and_then(Value::as_str) {
        if !reasoning.is_empty() {
            content.push(json!({ "type": "thinking", "thinking": reasoning }));
        }
    }

    // 2. tool_calls → tool_use block
    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        content.extend(tool_calls_to_tool_use(tool_calls));
    }

    // 3. 文本 → text block
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        if !text.is_empty() {
            content.push(json!({ "type": "text", "text": text }));
        }
    }

    // usage：prompt_tokens→input_tokens、completion_tokens→output_tokens、
    // usage.prompt_tokens_details.cached_tokens→cache_read_input_tokens（以 TS 取值路径为准）
    let mut usage = Map::new();
    if let Some(u) = body.get("usage") {
        usage.insert(
            "input_tokens".into(),
            u.get("prompt_tokens").cloned().unwrap_or(json!(0)),
        );
        usage.insert(
            "output_tokens".into(),
            u.get("completion_tokens").cloned().unwrap_or(json!(0)),
        );
        if let Some(cached) = u
            .pointer("/prompt_tokens_details/cached_tokens")
            .and_then(Value::as_u64)
        {
            if cached > 0 {
                usage.insert("cache_read_input_tokens".into(), json!(cached));
            }
        }
    }

    let id = body
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| format!("msg_{}", now_millis()));

    Ok(json!({
        "id": id,
        "type": "message",
        "role": "assistant",
        "model": body.get("model").cloned().filter(|m| !m.is_null()).unwrap_or(json!("unknown")),
        "content": content,
        "stop_reason": map_finish_reason(choice.get("finish_reason").and_then(Value::as_str)),
        "stop_sequence": Value::Null,
        "usage": Value::Object(usage),
    }))
}

/// 事实表「非流式响应 OpenAI Chat → OpenAI Responses」逐条
pub fn openai_chat_to_openai_responses(body: &Value) -> Result<Value, ProxyError> {
    let choice = body
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|c| c.first());
    let message = choice.and_then(|c| c.get("message"));

    let mut output: Vec<Value> = Vec::new();

    if let Some(message) = message {
        // 文本 → message item（msg_0，annotations:[]）
        if let Some(text) = message.get("content").and_then(Value::as_str) {
            if !text.is_empty() {
                output.push(json!({
                    "type": "message",
                    "id": "msg_0",
                    "status": "completed",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": text, "annotations": [] }],
                }));
            }
        }
        // tool_calls → function_call item（fc_<i>）
        if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
            for (i, tc) in tool_calls.iter().enumerate() {
                let func = tc.get("function").cloned().unwrap_or(Value::Null);
                let arguments = match func.get("arguments") {
                    Some(Value::String(s)) => s.clone(),
                    Some(other) => serde_json::to_string(other).unwrap_or_default(),
                    None => String::new(),
                };
                output.push(json!({
                    "type": "function_call",
                    "id": format!("fc_{i}"),
                    "call_id": tc.get("id").cloned().unwrap_or(Value::Null),
                    "name": func.get("name").cloned().unwrap_or(Value::Null),
                    "arguments": arguments,
                    "status": "completed",
                }));
            }
        }
    }

    // id：resp_<chat.id>；缺省 resp_<millis>
    let id = match body.get("id").and_then(Value::as_str) {
        Some(chat_id) if !chat_id.is_empty() => format!("resp_{chat_id}"),
        _ => format!("resp_{}", now_millis()),
    };

    // status：finish_reason=="length"→incomplete 否则 completed
    let status = match choice
        .and_then(|c| c.get("finish_reason"))
        .and_then(Value::as_str)
    {
        Some("length") => "incomplete",
        _ => "completed",
    };

    // usage：total 缺省 = input + output
    let usage = body.get("usage").cloned().unwrap_or(json!({}));
    let input_tokens = usage
        .get("prompt_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let output_tokens = usage
        .get("completion_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let total_tokens = usage
        .get("total_tokens")
        .and_then(Value::as_u64)
        .unwrap_or(input_tokens + output_tokens);

    Ok(json!({
        "id": id,
        "object": "response",
        "status": status,
        "model": body.get("model").cloned().filter(|m| !m.is_null()).unwrap_or(json!("unknown")),
        "output": output,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
        },
    }))
}
