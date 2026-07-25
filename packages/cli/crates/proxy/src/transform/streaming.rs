use std::collections::HashMap;

use serde_json::{json, Value};

use super::response::map_finish_reason;
use crate::sse::{SseData, SseEvent};

/// 待序列化的输出事件（data_json 已序列化为 JSON 字符串）
pub struct SseOut {
    pub event: String,
    pub data_json: String,
}

fn out(event: &str, data: Value) -> SseOut {
    SseOut {
        event: event.to_string(),
        data_json: serde_json::to_string(&data).unwrap(),
    }
}

fn now_millis() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis()
}

/// 流式转换器：逐事件转换 + 流结束时冲刷挂起事件。
/// drain 解决上游 finish chunk 后不发 [DONE] 直接断流导致尾部事件丢失的问题。
pub trait StreamTransformer: Send {
    fn convert_event(&mut self, ev: &SseEvent) -> Vec<SseOut>;
    /// 上游流结束（含无 [DONE] 断流）时调用一次，返回剩余挂起事件
    fn drain(&mut self) -> Vec<SseOut>;
}

// ---------------------------------------------------------------------------
// 流式 OpenAI Chat SSE → Anthropic SSE（事实表 6 步状态机）
// ---------------------------------------------------------------------------

#[derive(Default)]
struct PendingTool {
    id: String,
    name: String,
    args: String,
}

#[derive(Clone, Copy)]
enum BlockKind {
    Text,
    Thinking,
}

#[derive(Default)]
pub struct ChatToAnthropicStream {
    message_id: String,
    model: String,
    message_started: bool,
    next_block_index: u32,
    current_text_block: Option<u32>,
    current_thinking_block: Option<u32>,
    tool_block_index: HashMap<u32, u32>, // openai index → anthropic block index
    open_tool_blocks: Vec<u32>,          // 保持插入顺序（对齐 TS Set 迭代序）
    pending_tools: HashMap<u32, PendingTool>,
    last_emitted_args_len: HashMap<u32, usize>,
    finished: bool,
}

impl ChatToAnthropicStream {
    pub fn new() -> Self {
        Self::default()
    }
}

impl StreamTransformer for ChatToAnthropicStream {
    /// 返回空 vec = 丢弃事件（含 [DONE]）
    fn convert_event(&mut self, ev: &SseEvent) -> Vec<SseOut> {
        let SseData::Json(chunk) = &ev.data else {
            return Vec::new(); // [DONE] 丢弃
        };
        let Some(choices) = chunk.get("choices").and_then(Value::as_array) else {
            return Vec::new();
        };
        let Some(choice) = choices.first() else {
            return Vec::new();
        };
        let mut outs = Vec::new();

        // 1. 首个有 choices 的 chunk → message_start（骨架）
        if !self.message_started {
            if let Some(id) = chunk.get("id").and_then(Value::as_str) {
                self.message_id = id.to_string();
                self.model = chunk
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown")
                    .to_string();
            }
            self.message_started = true;
            let id = if self.message_id.is_empty() {
                format!("msg_{}", now_millis())
            } else {
                self.message_id.clone()
            };
            outs.push(out(
                "message_start",
                json!({
                    "type": "message_start",
                    "message": {
                        "id": id,
                        "type": "message",
                        "role": "assistant",
                        "content": [],
                        "model": self.model,
                        "stop_reason": null,
                        "stop_sequence": null,
                        "usage": { "input_tokens": 0, "output_tokens": 0 },
                    },
                }),
            ));
        }

        if let Some(delta) = choice.get("delta") {
            // 2. delta.content → text block
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                if !text.is_empty() {
                    let index = self.ensure_block(BlockKind::Text, &mut outs);
                    outs.push(out(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": index,
                            "delta": { "type": "text_delta", "text": text },
                        }),
                    ));
                }
            }

            // 3. delta.reasoning_content → thinking block
            if let Some(thinking) = delta.get("reasoning_content").and_then(Value::as_str) {
                if !thinking.is_empty() {
                    let index = self.ensure_block(BlockKind::Thinking, &mut outs);
                    outs.push(out(
                        "content_block_delta",
                        json!({
                            "type": "content_block_delta",
                            "index": index,
                            "delta": { "type": "thinking_delta", "thinking": thinking },
                        }),
                    ));
                }
            }

            // 4. delta.tool_calls → 按 openai index 映射独立 block index
            if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for tc in tool_calls {
                    outs.extend(self.handle_tool_call_delta(tc));
                }
            }
        }

        // 5. finish_reason（仅一次）：先关未关 tool block，再关 text/thinking
        if !self.finished {
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                self.finished = true;
                for index in std::mem::take(&mut self.open_tool_blocks) {
                    outs.push(out(
                        "content_block_stop",
                        json!({ "type": "content_block_stop", "index": index }),
                    ));
                }
                if let Some(index) = self.current_text_block.take() {
                    outs.push(out(
                        "content_block_stop",
                        json!({ "type": "content_block_stop", "index": index }),
                    ));
                }
                if let Some(index) = self.current_thinking_block.take() {
                    outs.push(out(
                        "content_block_stop",
                        json!({ "type": "content_block_stop", "index": index }),
                    ));
                }
                outs.push(out(
                    "message_delta",
                    json!({
                        "type": "message_delta",
                        "delta": { "stop_reason": map_finish_reason(Some(reason)), "stop_sequence": null },
                        "usage": { "output_tokens": 0 },
                    }),
                ));
                outs.push(out("message_stop", json!({ "type": "message_stop" })));
            }
        }
        outs
    }

    /// 无挂起事件（message_stop 在 finish_reason 时即发）
    fn drain(&mut self) -> Vec<SseOut> {
        Vec::new()
    }
}

impl ChatToAnthropicStream {
    /// 首次出现时先 content_block_start（text/thinking），返回 block index
    fn ensure_block(&mut self, kind: BlockKind, outs: &mut Vec<SseOut>) -> u32 {
        let existing = match kind {
            BlockKind::Text => self.current_text_block,
            BlockKind::Thinking => self.current_thinking_block,
        };
        if let Some(index) = existing {
            return index;
        }
        let index = self.alloc_block_index();
        match kind {
            BlockKind::Text => self.current_text_block = Some(index),
            BlockKind::Thinking => self.current_thinking_block = Some(index),
        }
        let content_block = match kind {
            BlockKind::Text => json!({ "type": "text" }),
            BlockKind::Thinking => json!({ "type": "thinking" }),
        };
        outs.push(out(
            "content_block_start",
            json!({
                "type": "content_block_start",
                "index": index,
                "content_block": content_block,
            }),
        ));
        index
    }

    fn alloc_block_index(&mut self) -> u32 {
        let index = self.next_block_index;
        self.next_block_index += 1;
        index
    }

    fn handle_tool_call_delta(&mut self, tc: &Value) -> Vec<SseOut> {
        let openai_index = tc.get("index").and_then(Value::as_u64).unwrap_or(0) as u32;
        let block_index = match self.tool_block_index.get(&openai_index) {
            Some(&index) => index,
            None => {
                let index = self.alloc_block_index();
                self.tool_block_index.insert(openai_index, index);
                index
            }
        };

        let pending = self.pending_tools.entry(openai_index).or_default();
        if let Some(id) = tc.get("id").and_then(Value::as_str) {
            pending.id = id.to_string();
        }
        if let Some(func) = tc.get("function") {
            if let Some(name) = func.get("name").and_then(Value::as_str) {
                pending.name = name.to_string();
            }
            if let Some(args) = func.get("arguments").and_then(Value::as_str) {
                pending.args.push_str(args);
            }
        }

        let mut outs = Vec::new();
        // 凑齐 id+name 才 content_block_start（tool_use, input:{}）
        if !pending.id.is_empty()
            && !pending.name.is_empty()
            && !self.open_tool_blocks.contains(&block_index)
        {
            self.open_tool_blocks.push(block_index);
            outs.push(out(
                "content_block_start",
                json!({
                    "type": "content_block_start",
                    "index": block_index,
                    "content_block": {
                        "type": "tool_use",
                        "id": pending.id,
                        "name": pending.name,
                        "input": {},
                    },
                }),
            ));
        }

        // arguments 增量：last_emitted_args_len 只发新增片段
        if self.open_tool_blocks.contains(&block_index) && !pending.args.is_empty() {
            let last = *self.last_emitted_args_len.get(&openai_index).unwrap_or(&0);
            if pending.args.len() > last {
                // last 必为此前某次追加边界，落在 char 边界上
                let new_args = pending.args[last..].to_string();
                self.last_emitted_args_len
                    .insert(openai_index, pending.args.len());
                outs.push(out(
                    "content_block_delta",
                    json!({
                        "type": "content_block_delta",
                        "index": block_index,
                        "delta": { "type": "input_json_delta", "partial_json": new_args },
                    }),
                ));
            }
        }
        outs
    }
}

// ---------------------------------------------------------------------------
// 流式 OpenAI Chat SSE → OpenAI Responses SSE
// ---------------------------------------------------------------------------

struct RespToolState {
    output_index: u32,
    item_id: String, // fc_<chatIndex>
    call_id: String, // 上游 tool_call.id 原样透传
    name: String,
    args_buf: String,
    announced: bool,
}

#[derive(Default)]
pub struct ChatToResponsesStream {
    response_id: String,
    model: String,
    created: bool,
    text_output_index: Option<u32>,
    text_started: bool,
    text_buf: String,
    tools: Vec<(u32, RespToolState)>, // Vec 保持插入顺序（对齐 TS Map 迭代序）
    next_output_index: u32,
    usage: Option<Value>,
    finished: bool,
    /// finish_reason 已处理但 response.completed 尚未发出：
    /// 延迟到下一个事件（尾部 choices:[] 的 usage-only chunk 或 [DONE]）再发，以便捕获 usage
    pending_completed: bool,
    /// finish 时构建好的完整 output[]，供 response.completed 使用
    completed_output: Vec<Value>,
}

impl ChatToResponsesStream {
    pub fn new() -> Self {
        Self::default()
    }
}

impl StreamTransformer for ChatToResponsesStream {
    fn convert_event(&mut self, ev: &SseEvent) -> Vec<SseOut> {
        // [DONE]：flush 挂起的 response.completed（若有），本身不产生其他事件
        if matches!(ev.data, SseData::Done) {
            return self.take_pending_completed();
        }
        let SseData::Json(chunk) = &ev.data else {
            return Vec::new();
        };
        if let Some(id) = chunk.get("id").and_then(Value::as_str) {
            self.response_id = format!("resp_{id}");
        }
        if let Some(model) = chunk.get("model").and_then(Value::as_str) {
            self.model = model.to_string();
        }
        if chunk.get("usage").is_some_and(|u| u.is_object()) {
            self.usage = chunk.get("usage").cloned();
        }

        let mut outs = self.take_pending_completed();

        // choices 可能缺失（尾部 choices:[] 的 usage-only chunk 只用于捕获 usage）
        let Some(choice) = chunk
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
        else {
            return outs;
        };
        // 首 chunk → response.created
        if !self.created {
            self.created = true;
            outs.push(out(
                "response.created",
                json!({ "type": "response.created", "response": self.response_shell("in_progress") }),
            ));
        }

        if let Some(delta) = choice.get("delta") {
            if let Some(text) = delta.get("content").and_then(Value::as_str) {
                if !text.is_empty() {
                    outs.extend(self.handle_text(text));
                }
            }
            // NOTE: delta.reasoning_content 刻意忽略（对齐 TS 注释：kimi thinking → Codex reasoning 不在本期范围）
            if let Some(tool_calls) = delta.get("tool_calls").and_then(Value::as_array) {
                for tc in tool_calls {
                    outs.extend(self.handle_tool(tc));
                }
            }
        }

        if !self.finished
            && choice
                .get("finish_reason")
                .and_then(Value::as_str)
                .is_some()
        {
            outs.extend(self.finish());
        }
        outs
    }

    /// 上游断流（无 [DONE]/usage chunk）时仍发出挂起的 response.completed（带最新捕获的 usage）
    fn drain(&mut self) -> Vec<SseOut> {
        self.take_pending_completed()
    }
}

impl ChatToResponsesStream {
    fn response_shell(&self, status: &str) -> Value {
        json!({
            "id": self.response_id,
            "object": "response",
            "status": status,
            "model": self.model,
            "output": [],
        })
    }

    fn handle_text(&mut self, text: &str) -> Vec<SseOut> {
        self.text_buf.push_str(text);
        let mut outs = Vec::new();
        let output_index = match self.text_output_index {
            Some(index) => index,
            None => {
                let index = self.alloc_output_index();
                self.text_output_index = Some(index);
                index
            }
        };
        if !self.text_started {
            self.text_started = true;
            outs.push(out(
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": output_index,
                    "item": {
                        "type": "message",
                        "id": "msg_0",
                        "status": "in_progress",
                        "role": "assistant",
                        "content": [],
                    },
                }),
            ));
            outs.push(out(
                "response.content_part.added",
                json!({
                    "type": "response.content_part.added",
                    "item_id": "msg_0",
                    "output_index": output_index,
                    "content_index": 0,
                    "part": { "type": "output_text", "text": "", "annotations": [] },
                }),
            ));
        }
        outs.push(out(
            "response.output_text.delta",
            json!({
                "type": "response.output_text.delta",
                "item_id": "msg_0",
                "output_index": output_index,
                "content_index": 0,
                "delta": text,
            }),
        ));
        outs
    }

    fn alloc_output_index(&mut self) -> u32 {
        let index = self.next_output_index;
        self.next_output_index += 1;
        index
    }

    fn handle_tool(&mut self, tc: &Value) -> Vec<SseOut> {
        let idx = tc.get("index").and_then(Value::as_u64).unwrap_or(0) as u32;
        let pos = match self.tools.iter().position(|(i, _)| *i == idx) {
            Some(p) => p,
            None => {
                let call_id = tc
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("call_{idx}"));
                let state = RespToolState {
                    output_index: self.alloc_output_index(),
                    item_id: format!("fc_{idx}"),
                    call_id,
                    name: String::new(),
                    args_buf: String::new(),
                    announced: false,
                };
                self.tools.push((idx, state));
                self.tools.len() - 1
            }
        };
        let st = &mut self.tools[pos].1;
        if let Some(id) = tc.get("id").and_then(Value::as_str) {
            st.call_id = id.to_string();
        }
        if let Some(name) = tc.pointer("/function/name").and_then(Value::as_str) {
            st.name = name.to_string();
        }

        let mut outs = Vec::new();
        // 有 name 才宣布 function_call item（in_progress）
        if !st.announced && !st.name.is_empty() {
            st.announced = true;
            outs.push(out(
                "response.output_item.added",
                json!({
                    "type": "response.output_item.added",
                    "output_index": st.output_index,
                    "item": {
                        "type": "function_call",
                        "id": st.item_id,
                        "call_id": st.call_id,
                        "name": st.name,
                        "arguments": "",
                        "status": "in_progress",
                    },
                }),
            ));
        }
        if let Some(args) = tc.pointer("/function/arguments").and_then(Value::as_str) {
            if !args.is_empty() {
                st.args_buf.push_str(args);
                if st.announced {
                    outs.push(out(
                        "response.function_call_arguments.delta",
                        json!({
                            "type": "response.function_call_arguments.delta",
                            "item_id": st.item_id,
                            "output_index": st.output_index,
                            "delta": args,
                        }),
                    ));
                }
            }
        }
        outs
    }

    fn finish(&mut self) -> Vec<SseOut> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;
        let mut outs = Vec::new();

        // 文本：output_text.done → content_part.done → output_item.done
        if self.text_started {
            let output_index = self.text_output_index.unwrap_or(0);
            outs.push(out(
                "response.output_text.done",
                json!({
                    "type": "response.output_text.done",
                    "item_id": "msg_0",
                    "output_index": output_index,
                    "content_index": 0,
                    "text": self.text_buf,
                }),
            ));
            outs.push(out(
                "response.content_part.done",
                json!({
                    "type": "response.content_part.done",
                    "item_id": "msg_0",
                    "output_index": output_index,
                    "content_index": 0,
                    "part": { "type": "output_text", "text": self.text_buf, "annotations": [] },
                }),
            ));
            outs.push(out(
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": output_index,
                    "item": self.completed_message_item(),
                }),
            ));
        }

        // 完整 output[]：文本 message item + 各已宣布工具的 function_call item
        let mut output_items: Vec<Value> = Vec::new();
        if self.text_started {
            output_items.push(self.completed_message_item());
        }
        for (_, st) in &self.tools {
            if !st.announced {
                continue;
            }
            outs.push(out(
                "response.function_call_arguments.done",
                json!({
                    "type": "response.function_call_arguments.done",
                    "item_id": st.item_id,
                    "output_index": st.output_index,
                    "arguments": st.args_buf,
                }),
            ));
            let item = json!({
                "type": "function_call",
                "id": st.item_id,
                "call_id": st.call_id,
                "name": st.name,
                "arguments": st.args_buf,
                "status": "completed",
            });
            outs.push(out(
                "response.output_item.done",
                json!({
                    "type": "response.output_item.done",
                    "output_index": st.output_index,
                    "item": item,
                }),
            ));
            output_items.push(item);
        }

        // output_items 缓存起来供 response.completed 使用（延迟到下一事件发出，见 take_pending_completed）
        self.completed_output = output_items;
        self.pending_completed = true;
        outs
    }

    /// 取出挂起的 response.completed（usage 用最新捕获值；total 缺省=input+output）
    fn take_pending_completed(&mut self) -> Vec<SseOut> {
        if !self.pending_completed {
            return Vec::new();
        }
        self.pending_completed = false;
        let usage = self.usage.clone().unwrap_or(json!({}));
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
        vec![out(
            "response.completed",
            json!({
                "type": "response.completed",
                "response": {
                    "id": self.response_id,
                    "object": "response",
                    "status": "completed",
                    "model": self.model,
                    "output": std::mem::take(&mut self.completed_output),
                    "usage": {
                        "input_tokens": input_tokens,
                        "output_tokens": output_tokens,
                        "total_tokens": total_tokens,
                    },
                },
            }),
        )]
    }

    fn completed_message_item(&self) -> Value {
        json!({
            "type": "message",
            "id": "msg_0",
            "status": "completed",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": self.text_buf, "annotations": [] }],
        })
    }
}
