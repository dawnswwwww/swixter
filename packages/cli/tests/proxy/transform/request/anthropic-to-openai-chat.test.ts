import { describe, it, expect } from "bun:test";
import { anthropicToOpenAIChatRequest } from "../../../../src/proxy/transform/request/anthropic-to-openai-chat.js";
import type { TransformContext } from "../../../../src/proxy/transform/types.js";
import type { ClaudeCodeProfile, ProviderPreset } from "../../../../src/types.js";

function makeCtx(overrides?: Partial<TransformContext>): TransformContext {
  const profile: ClaudeCodeProfile = {
    name: "test",
    providerId: "groq",
    apiKey: "test",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides?.profile,
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
    ...overrides,
  };
}

describe("anthropicToOpenAIChatRequest", () => {
  it("converts a simple text message", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };
    const ctx = makeCtx();
    const result = anthropicToOpenAIChatRequest(body, ctx);

    expect(result.targetEndpoint).toBe("/v1/chat/completions");
    expect(result.body).toMatchObject({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    });
  });

  it("converts system field to system message", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      system: "You are helpful.",
      max_tokens: 1024,
    };
    const ctx = makeCtx();
    const result = anthropicToOpenAIChatRequest(body, ctx);

    expect(result.body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(result.body.messages[1]).toEqual({ role: "user", content: "Hello" });
    expect(result.body.system).toBeUndefined();
  });

  it("converts array content blocks", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } },
          ],
        },
      ],
      max_tokens: 1024,
    };
    const ctx = makeCtx();
    const result = anthropicToOpenAIChatRequest(body, ctx);

    const userMsg = result.body.messages[0];
    expect(userMsg.role).toBe("user");
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect(userMsg.content[0]).toEqual({ type: "text", text: "What is this?" });
    expect(userMsg.content[1].type).toBe("image_url");
  });

  it("converts tools", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather info",
          input_schema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
      max_tokens: 1024,
    };
    const ctx = makeCtx();
    const result = anthropicToOpenAIChatRequest(body, ctx);

    expect(result.body.tools).toHaveLength(1);
    expect(result.body.tools[0]).toMatchObject({
      type: "function",
      function: {
        name: "get_weather",
        description: "Get weather info",
        parameters: { type: "object", properties: { city: { type: "string" } } },
      },
    });
  });

  it("maps stop_sequences to stop", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hi" }],
      stop_sequences: ["END", "STOP"],
      max_tokens: 1024,
    };
    const ctx = makeCtx();
    const result = anthropicToOpenAIChatRequest(body, ctx);

    expect(result.body.stop).toEqual(["END", "STOP"]);
    expect(result.body.stop_sequences).toBeUndefined();
  });

  it("converts tool_use in assistant message to tool_calls", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Tokyo" } },
          ],
        },
      ],
      max_tokens: 1024,
    };
    const ctx = makeCtx();
    const result = anthropicToOpenAIChatRequest(body, ctx);

    const msg = result.body.messages[0];
    expect(msg.role).toBe("assistant");
    expect(msg.tool_calls).toHaveLength(1);
    expect(msg.tool_calls[0].id).toBe("tu_1");
    expect(msg.tool_calls[0].function.name).toBe("get_weather");
  });

  it("converts tool_result in user message to tool messages", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tu_1", content: "Sunny, 25C" }],
        },
      ],
      max_tokens: 1024,
    };
    const ctx = makeCtx();
    const result = anthropicToOpenAIChatRequest(body, ctx);

    const msg = result.body.messages[0];
    expect(msg.role).toBe("tool");
    expect(msg.tool_call_id).toBe("tu_1");
    expect(msg.content).toBe("Sunny, 25C");
  });
});
