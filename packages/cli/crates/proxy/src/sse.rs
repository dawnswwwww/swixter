use serde_json::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum SseData {
    Json(Value),
    Done,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SseEvent {
    pub event: String,
    pub data: SseData,
}

/// TS: transform/utils.ts parseSSEEvents
pub fn parse_sse_events(chunk: &str) -> Vec<SseEvent> {
    let mut events = Vec::new();
    let mut current_event = String::new();
    let mut data_lines: Vec<&str> = Vec::new();

    let flush =
        |current_event: &mut String, data_lines: &mut Vec<&str>, events: &mut Vec<SseEvent>| {
            if !data_lines.is_empty() {
                let data_str = data_lines.join("\n");
                if data_str == "[DONE]" {
                    events.push(SseEvent {
                        event: current_event.clone(),
                        data: SseData::Done,
                    });
                } else if let Ok(v) = serde_json::from_str::<Value>(&data_str) {
                    events.push(SseEvent {
                        event: current_event.clone(),
                        data: SseData::Json(v),
                    });
                }
                // JSON 解析失败：丢弃该事件
            }
            current_event.clear();
            data_lines.clear();
        };

    for line in chunk.split('\n') {
        if let Some(rest) = line.strip_prefix("event:") {
            current_event = rest.strip_prefix(' ').unwrap_or(rest).to_string();
        } else if let Some(rest) = line.strip_prefix("data:") {
            data_lines.push(rest.strip_prefix(' ').unwrap_or(rest));
        } else if line.is_empty() {
            flush(&mut current_event, &mut data_lines, &mut events);
        }
    }
    events
}

/// TS: transform/utils.ts serializeSSEEvent（data 由调用方预先序列化为 JSON 字符串）
pub fn serialize_sse_event(event_name: &str, data_json: &str) -> String {
    if event_name.is_empty() {
        format!("data: {data_json}\n\n")
    } else {
        format!("event: {event_name}\ndata: {data_json}\n\n")
    }
}

/// TS: streaming/base.ts —— 字节缓冲，只在 \n\n 边界切完整 block 再解码。
/// 边界字节是 ASCII，完整 block 内的 UTF-8 序列必然完整，等价于 streaming TextDecoder。
#[derive(Default)]
pub struct SseChunker {
    buf: Vec<u8>,
}

impl SseChunker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed(&mut self, chunk: &[u8]) -> Vec<SseEvent> {
        self.buf.extend_from_slice(chunk);
        let Some(idx) = rfind_double_newline(&self.buf) else {
            return Vec::new();
        };
        let complete: Vec<u8> = self.buf.drain(..idx + 2).collect();
        parse_sse_events(&String::from_utf8_lossy(&complete))
    }

    pub fn flush(&mut self) -> Vec<SseEvent> {
        if self.buf.iter().all(|b| b.is_ascii_whitespace()) {
            self.buf.clear();
            return Vec::new();
        }
        let mut rest = std::mem::take(&mut self.buf);
        rest.extend_from_slice(b"\n\n");
        parse_sse_events(&String::from_utf8_lossy(&rest))
    }
}

fn rfind_double_newline(buf: &[u8]) -> Option<usize> {
    buf.windows(2).rposition(|w| w == b"\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_event_and_data_with_optional_space() {
        let ev = parse_sse_events("event: message_start\ndata: {\"type\":\"message_start\"}\n\n");
        assert_eq!(ev.len(), 1);
        assert_eq!(ev[0].event, "message_start");
        // 无空格变体
        let ev2 = parse_sse_events("data:{\"a\":1}\n\n");
        assert!(matches!(&ev2[0].data, SseData::Json(v) if v["a"] == 1));
    }

    #[test]
    fn done_sentinel_preserved_and_bad_json_dropped() {
        let ev = parse_sse_events("data: {bad json\n\ndata: [DONE]\n\n");
        assert_eq!(ev.len(), 1);
        assert!(matches!(ev[0].data, SseData::Done));
    }

    #[test]
    fn multiline_data_joined_and_eventless_block_has_empty_event() {
        let ev = parse_sse_events("data: {\"a\":\ndata: 1}\n\n");
        assert!(matches!(&ev[0].data, SseData::Json(v) if v["a"] == 1));
        assert_eq!(ev[0].event, "");
    }

    #[test]
    fn chunker_buffers_across_chunks_and_utf8_boundary() {
        let mut c = SseChunker::new();
        // "你好" 的 UTF-8 被切到两个 chunk
        let full = "data: {\"t\":\"你\"}\n\n".as_bytes();
        let split = full.iter().position(|_| true).unwrap(); // 任意位置
        assert!(c.feed(&full[..split]).is_empty());
        let ev = c.feed(&full[split..]);
        assert_eq!(ev.len(), 1);
    }

    #[test]
    fn chunker_flush_parses_remainder() {
        let mut c = SseChunker::new();
        assert!(c.feed(b"data: {\"a\":1}").is_empty()); // 无 \n\n 边界
        let ev = c.flush();
        assert_eq!(ev.len(), 1);
    }

    #[test]
    fn serialize_roundtrip() {
        assert_eq!(
            serialize_sse_event("msg", "{\"a\":1}"),
            "event: msg\ndata: {\"a\":1}\n\n"
        );
        assert_eq!(serialize_sse_event("", "{\"a\":1}"), "data: {\"a\":1}\n\n");
    }
}
