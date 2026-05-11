import { describe, it, expect } from "bun:test";
import { openAIChatToAnthropicResponse } from "../../../../src/proxy/transform/response/openai-chat-to-anthropic.js";
import type { TransformContext } from "../../../../src/proxy/transform/types.js";
import type { ClaudeCodeProfile, ProviderPreset } from "../../../../src/types.js";

function makeCtx(): TransformContext {
  const profile: ClaudeCodeProfile = {
    name: "test",
    providerId: "groq",
    apiKey: "test",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
  };
  const preset: ProviderPreset = {
    id: "groq",
    name: "Groq",
    displayName: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModels: [],
    authType: "api-key",
    wire_api: "chat",
    env_key: "GROQ_API_KEY",
  };
  return {
    endpoint: "/v1/messages",
    clientFormat: "anthropic_messages",
    targetFormat: "openai_chat",
    profile,
    preset,
    stream: false,
  };
}

describe("openAIChatToAnthropicResponse", () => {
  it("converts a simple text response", () => {
    const body = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hello! How can I help?" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 8, total_tokens: 18 },
    };
    const ctx = makeCtx();
    const result = openAIChatToAnthropicResponse(body, ctx) as Record<string, unknown>;

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "Hello! How can I help?" }]);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 8 });
  });

  it("converts tool_calls to tool_use blocks", () => {
    const body = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_123",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Tokyo"}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 15, completion_tokens: 20, total_tokens: 35 },
    };
    const ctx = makeCtx();
    const result = openAIChatToAnthropicResponse(body, ctx) as Record<string, unknown>;

    expect(result.stop_reason).toBe("tool_use");
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0]).toMatchObject({
      type: "tool_use",
      id: "call_123",
      name: "get_weather",
      input: { city: "Tokyo" },
    });
  });

  it("maps finish_reason values correctly", () => {
    const testCases = [
      { finish_reason: "stop", expected: "end_turn" },
      { finish_reason: "length", expected: "max_tokens" },
      { finish_reason: "tool_calls", expected: "tool_use" },
      { finish_reason: "content_filter", expected: "end_turn" },
    ];

    for (const tc of testCases) {
      const body = {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: 1700000000,
        model: "test",
        choices: [{ index: 0, message: { role: "assistant", content: "" }, finish_reason: tc.finish_reason }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
      const ctx = makeCtx();
      const result = openAIChatToAnthropicResponse(body, ctx) as Record<string, unknown>;
      expect(result.stop_reason).toBe(tc.expected);
    }
  });

  it("converts reasoning_content to thinking block", () => {
    const body = {
      id: "chatcmpl-123",
      object: "chat.completion",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: "The answer is 42.",
          reasoning_content: "Let me think... 6*7=42",
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    };
    const ctx = makeCtx();
    const result = openAIChatToAnthropicResponse(body, ctx) as Record<string, unknown>;

    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: "thinking", thinking: "Let me think... 6*7=42" });
    expect(content[1]).toEqual({ type: "text", text: "The answer is 42." });
  });
});
