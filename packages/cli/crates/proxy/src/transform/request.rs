use serde_json::{json, Map, Value};

use super::{TransformCtx, TransformedRequest};
use crate::ProxyError;

/// 工具名过滤：等价于 /^(?!.*__)[a-zA-Z][a-zA-Z0-9_-]{0,63}$/（regex crate 不支持前瞻，手写）
pub fn valid_tool_name(name: &str) -> bool {
    !name.contains("__")
        && name.len() <= 64
        && name.as_bytes().first().is_some_and(u8::is_ascii_alphabetic)
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// TS: mergeSystemBlocks —— 字符串直通；数组取 type=="text" 的 text 以 \n 合并
pub fn merge_system_blocks(system: &Value) -> String {
    match system {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// TS: convertAnthropicImageToOpenAI（仅 base64；source 缺失 → 空 url）
fn convert_image_block(block: &Value) -> Value {
    let source = block.get("source");
    let media_type = source
        .and_then(|s| s.get("media_type"))
        .and_then(Value::as_str)
        .unwrap_or("image/png");
    let data = source
        .and_then(|s| s.get("data"))
        .and_then(Value::as_str)
        .unwrap_or("");
    json!({
        "type": "image_url",
        "image_url": { "url": format!("data:{media_type};base64,{data}") },
    })
}

/// TS: convertAnthropicToolUseToOpenAI
fn convert_tool_uses(tool_uses: &[&Value]) -> Vec<Value> {
    tool_uses
        .iter()
        .map(|tu| {
            let input = tu.get("input").cloned().unwrap_or(json!({}));
            json!({
                "id": tu.get("id").cloned().unwrap_or(Value::Null),
                "type": "function",
                "function": {
                    "name": tu.get("name").cloned().unwrap_or(Value::Null),
                    // arguments 是 JSON 字符串（JSON.stringify(input)）
                    "arguments": serde_json::to_string(&input).unwrap_or_else(|_| "{}".into()),
                },
            })
        })
        .collect()
}

/// TS: convertToolChoice（anthropic 侧）：any→required、none→none、auto→auto、{type:"tool"}→function
fn convert_tool_choice(tc: &Value) -> Value {
    match tc {
        Value::String(s) => match s.as_str() {
            "any" => json!("required"),
            "none" => json!("none"),
            _ => json!("auto"),
        },
        Value::Object(_) => {
            if tc.get("type").and_then(Value::as_str) == Some("tool") {
                json!({
                    "type": "function",
                    "function": { "name": tc.get("name").cloned().unwrap_or(Value::Null) },
                })
            } else {
                tc.clone()
            }
        }
        _ => tc.clone(),
    }
}

/// TS: convertMessages —— text/image/tool_use/tool_result 逐块映射
fn convert_messages(messages: Option<&Vec<Value>>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let Some(messages) = messages else { return out };

    for msg in messages {
        let role = msg.get("role").and_then(Value::as_str).unwrap_or("user");
        let content = msg.get("content");

        if let Some(Value::Array(blocks)) = content {
            // text/image 映射为 OpenAI content parts；tool_use/tool_result 不在 parts 中
            let converted_parts: Vec<Value> = blocks
                .iter()
                .filter_map(|block| match block.get("type").and_then(Value::as_str) {
                    Some("text") => Some(json!({
                        "type": "text",
                        "text": block.get("text").cloned().unwrap_or(Value::Null),
                    })),
                    Some("image") => Some(convert_image_block(block)),
                    Some("tool_use") | Some("tool_result") => None,
                    _ => Some(block.clone()), // 未知 block 原样透传
                })
                .collect();

            let tool_uses: Vec<&Value> = blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))
                .collect();
            if !tool_uses.is_empty() && role == "assistant" {
                out.push(json!({
                    "role": "assistant",
                    "content": if converted_parts.is_empty() { Value::Null } else { json!(converted_parts) },
                    "tool_calls": convert_tool_uses(&tool_uses),
                }));
                continue;
            }

            let tool_results: Vec<&Value> = blocks
                .iter()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
                .collect();
            if !tool_results.is_empty() && role == "user" {
                for tr in tool_results {
                    let tr_content = tr.get("content").cloned().unwrap_or(Value::Null);
                    let content_str = match &tr_content {
                        Value::String(s) => s.clone(),
                        other => serde_json::to_string(other).unwrap_or_default(),
                    };
                    out.push(json!({
                        "role": "tool",
                        "tool_call_id": tr.get("tool_use_id").cloned().unwrap_or(Value::Null),
                        "content": content_str,
                    }));
                }
                continue;
            }

            out.push(json!({ "role": role, "content": converted_parts }));
            continue;
        }

        // 字符串或其他（缺失 content 时键省略，对齐 TS undefined 序列化行为）
        let mut m = Map::new();
        m.insert("role".into(), json!(role));
        if let Some(c) = content {
            m.insert("content".into(), c.clone());
        }
        out.push(Value::Object(m));
    }
    out
}

/// 事实表「请求 Anthropic Messages → OpenAI Chat」逐条
pub fn anthropic_to_openai_chat(
    body: &Value,
    _ctx: &TransformCtx,
) -> Result<TransformedRequest, ProxyError> {
    let mut out = Map::new();

    if let Some(model) = body.get("model") {
        out.insert("model".into(), model.clone());
    }

    let mut messages = convert_messages(body.get("messages").and_then(Value::as_array));

    // system → 前置 system 消息（block 数组 text 以 \n 合并）
    if let Some(system) = body.get("system") {
        let text = merge_system_blocks(system);
        if !text.is_empty() {
            messages.insert(0, json!({ "role": "system", "content": text }));
        }
    }
    out.insert("messages".into(), json!(messages));

    // 透传字段 + stop_sequences→stop
    for key in ["max_tokens", "temperature", "top_p", "stream"] {
        if let Some(v) = body.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
    if let Some(stop) = body.get("stop_sequences") {
        out.insert("stop".into(), stop.clone());
    }

    // tools → function
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        let converted: Vec<Value> = tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.get("name").cloned().unwrap_or(Value::Null),
                        "description": tool.get("description").cloned().unwrap_or(Value::Null),
                        "parameters": tool.get("input_schema").cloned().unwrap_or(Value::Null),
                    },
                })
            })
            .collect();
        out.insert("tools".into(), json!(converted));
    }

    if let Some(tc) = body.get("tool_choice") {
        out.insert("tool_choice".into(), convert_tool_choice(tc));
    }

    // thinking.budget_tokens → reasoning_effort 三档
    if let Some(budget) = body
        .pointer("/thinking/budget_tokens")
        .and_then(Value::as_u64)
    {
        let effort = if budget >= 32000 {
            "high"
        } else if budget >= 16000 {
            "medium"
        } else {
            "low"
        };
        out.insert("reasoning_effort".into(), json!(effort));
    }

    Ok(TransformedRequest {
        body: Value::Object(out),
        target_endpoint: "/v1/chat/completions".into(),
    })
}

/// TS: flattenText —— input_text/output_text/text 合并；单个 text part 塌缩为字符串；
/// 不支持的 part 类型抛错（外层回退原样透传）
fn flatten_text(content: &Value) -> Result<Value, ProxyError> {
    let Value::Array(parts) = content else {
        return Ok(content.clone()); // 字符串/其他原样直通
    };
    let mut converted: Vec<Value> = Vec::new();
    for part in parts {
        match part.get("type").and_then(Value::as_str) {
            Some("input_text") | Some("output_text") | Some("text") => {
                converted.push(json!({
                    "type": "text",
                    "text": part.get("text").cloned().unwrap_or(Value::Null),
                }));
            }
            other => {
                return Err(ProxyError::Transform(format!(
                    "openai_responses→openai_chat: unsupported content part type \"{}\"",
                    other.unwrap_or("<missing>")
                )));
            }
        }
    }
    // 单个 text part 塌缩为字符串（对齐 Codex 单 part 消息惯例）
    if converted.len() == 1 {
        if let Some(text) = converted[0].get("text") {
            return Ok(text.clone());
        }
    }
    Ok(json!(converted))
}

/// TS: convertInputItem —— message/developer→system、function_call、function_call_output；其他丢弃
fn convert_input_item(item: &Value) -> Result<Option<Value>, ProxyError> {
    match item.get("type").and_then(Value::as_str) {
        Some("message") => {
            let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
            let role = if role == "developer" { "system" } else { role };
            let content = flatten_text(item.get("content").unwrap_or(&Value::Null))?;
            Ok(Some(json!({ "role": role, "content": content })))
        }
        Some("function_call") => Ok(Some(json!({
            "role": "assistant",
            "content": Value::Null,
            "tool_calls": [{
                "id": item.get("call_id").cloned().unwrap_or(Value::Null),
                "type": "function",
                "function": {
                    "name": item.get("name").cloned().unwrap_or(Value::Null),
                    "arguments": item.get("arguments").cloned().unwrap_or(json!("")),
                },
            }],
        }))),
        Some("function_call_output") => {
            let output = item.get("output").cloned().unwrap_or(Value::Null);
            let content = match &output {
                Value::String(s) => s.clone(),
                other => serde_json::to_string(other).unwrap_or_default(),
            };
            Ok(Some(json!({
                "role": "tool",
                "tool_call_id": item.get("call_id").cloned().unwrap_or(Value::Null),
                "content": content,
            })))
        }
        _ => Ok(None), // 其他 item 类型丢弃
    }
}

/// 事实表「请求 OpenAI Responses → OpenAI Chat」逐条
pub fn openai_responses_to_openai_chat(
    body: &Value,
    _ctx: &TransformCtx,
) -> Result<TransformedRequest, ProxyError> {
    let mut out = Map::new();
    if let Some(model) = body.get("model") {
        out.insert("model".into(), model.clone());
    }

    let mut messages: Vec<Value> = Vec::new();

    // instructions → system
    if let Some(instructions) = body.get("instructions").and_then(Value::as_str) {
        if !instructions.is_empty() {
            messages.push(json!({ "role": "system", "content": instructions }));
        }
    }

    // input：字符串 → 单条 user；数组逐项转换
    match body.get("input") {
        Some(Value::Array(items)) => {
            for item in items {
                if let Some(msg) = convert_input_item(item)? {
                    messages.push(msg);
                }
            }
        }
        Some(Value::String(s)) if !s.is_empty() => {
            messages.push(json!({ "role": "user", "content": s }));
        }
        _ => {}
    }
    out.insert("messages".into(), json!(messages));

    // max_output_tokens→max_tokens；透传 temperature/top_p/stream/parallel_tool_calls
    if let Some(v) = body.get("max_output_tokens") {
        out.insert("max_tokens".into(), v.clone());
    }
    for key in ["temperature", "top_p", "stream", "parallel_tool_calls"] {
        if let Some(v) = body.get(key) {
            out.insert(key.into(), v.clone());
        }
    }

    // 工具名过滤 + 缺 parameters 补空 schema
    if let Some(tools) = body.get("tools").and_then(Value::as_array) {
        let converted: Vec<Value> = tools
            .iter()
            .filter(|t| {
                t.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(valid_tool_name)
            })
            .map(|t| {
                let parameters = match t.get("parameters") {
                    Some(p) if p.is_object() => p.clone(),
                    _ => json!({ "type": "object", "properties": {} }),
                };
                json!({
                    "type": "function",
                    "function": {
                        "name": t.get("name").cloned().unwrap_or(Value::Null),
                        "description": t.get("description").cloned().unwrap_or(Value::Null),
                        "parameters": parameters,
                    },
                })
            })
            .collect();
        out.insert("tools".into(), json!(converted));
    }

    // tool_choice：字符串直通；{type:"function",name}→{type:"function",function:{name}}
    if let Some(tc) = body.get("tool_choice") {
        let converted = match tc {
            Value::Object(_) => {
                if tc.get("type").and_then(Value::as_str) == Some("function")
                    && tc.get("name").is_some()
                {
                    json!({
                        "type": "function",
                        "function": { "name": tc.get("name").cloned().unwrap_or(Value::Null) },
                    })
                } else {
                    tc.clone()
                }
            }
            _ => tc.clone(),
        };
        out.insert("tool_choice".into(), converted);
    }

    // reasoning.effort → reasoning_effort
    if let Some(effort) = body.pointer("/reasoning/effort").and_then(Value::as_str) {
        out.insert("reasoning_effort".into(), json!(effort));
    }

    Ok(TransformedRequest {
        body: Value::Object(out),
        target_endpoint: "/v1/chat/completions".into(),
    })
}
