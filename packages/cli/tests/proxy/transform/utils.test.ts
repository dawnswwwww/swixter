import { describe, it, expect } from "bun:test";
import {
  parseSSEEvents,
  serializeSSEEvent,
  extractContentBlocks,
  convertAnthropicImageToOpenAI,
  convertOpenAIToolCallsToAnthropic,
  convertAnthropicToolUseToOpenAI,
  mergeSystemBlocks,
} from "../../../src/proxy/transform/utils.js";

describe("parseSSEEvents", () => {
  it("parses a single SSE event", () => {
    const chunk = 'event: message_start\ndata: {"type":"message_start"}\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message_start");
    expect(events[0].data).toEqual({ type: "message_start" });
  });

  it("parses multiple SSE events in one chunk", () => {
    const chunk = 'event: a\ndata: 1\n\nevent: b\ndata: 2\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe("a");
    expect(events[1].event).toBe("b");
  });

  it("handles events with no event name", () => {
    const chunk = 'data: {"x":1}\n\n';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("");
    expect(events[0].data).toEqual({ x: 1 });
  });

  it("returns empty array for incomplete data", () => {
    const chunk = 'event: x\ndata: {"incomplete';
    const events = parseSSEEvents(chunk);
    expect(events).toHaveLength(0);
  });
});

describe("serializeSSEEvent", () => {
  it("serializes an event with data object", () => {
    const result = serializeSSEEvent("content_block_delta", { delta: { text: "hi" } });
    expect(result).toBe('event: content_block_delta\ndata: {"delta":{"text":"hi"}}\n\n');
  });

  it("serializes an event with string data", () => {
    const result = serializeSSEEvent("", "[DONE]");
    expect(result).toBe('data: [DONE]\n\n');
  });
});

describe("extractContentBlocks", () => {
  it("returns string content as text block", () => {
    expect(extractContentBlocks("hello")).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns array content as-is", () => {
    const blocks = [{ type: "text", text: "hi" }];
    expect(extractContentBlocks(blocks)).toEqual(blocks);
  });

  it("returns empty array for null", () => {
    expect(extractContentBlocks(null)).toEqual([]);
  });
});

describe("convertAnthropicImageToOpenAI", () => {
  it("converts base64 image to OpenAI image_url format", () => {
    const anthropicImage = {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "abc123",
      },
    };
    const result = convertAnthropicImageToOpenAI(anthropicImage);
    expect(result).toEqual({
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc123" },
    });
  });
});

describe("convertOpenAIToolCallsToAnthropic", () => {
  it("converts tool_calls to tool_use blocks", () => {
    const toolCalls = [{
      id: "call_123",
      type: "function",
      function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
    }];
    const result = convertOpenAIToolCallsToAnthropic(toolCalls);
    expect(result).toEqual([{
      type: "tool_use",
      id: "call_123",
      name: "get_weather",
      input: { city: "Tokyo" },
    }]);
  });
});

describe("convertAnthropicToolUseToOpenAI", () => {
  it("converts tool_use blocks to tool_calls", () => {
    const toolUses = [{
      type: "tool_use",
      id: "tu_123",
      name: "get_weather",
      input: { city: "Tokyo" },
    }];
    const result = convertAnthropicToolUseToOpenAI(toolUses);
    expect(result[0].id).toBe("tu_123");
    expect(result[0].type).toBe("function");
    expect((result[0] as Record<string, unknown>).function).toMatchObject({
      name: "get_weather",
    });
  });
});

describe("mergeSystemBlocks", () => {
  it("returns string system as-is", () => {
    expect(mergeSystemBlocks("You are helpful.")).toBe("You are helpful.");
  });

  it("merges array of text blocks", () => {
    const blocks = [
      { type: "text", text: "Line 1" },
      { type: "text", text: "Line 2" },
    ];
    expect(mergeSystemBlocks(blocks)).toBe("Line 1\nLine 2");
  });

  it("filters non-text blocks", () => {
    const blocks = [
      { type: "text", text: "Keep" },
      { type: "other", text: "Drop" },
    ];
    expect(mergeSystemBlocks(blocks)).toBe("Keep");
  });
});
