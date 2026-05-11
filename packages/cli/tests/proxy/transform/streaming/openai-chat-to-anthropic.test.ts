import { describe, it, expect } from "bun:test";
import { OpenAIChatToAnthropicStreamTransformer } from "../../../../src/proxy/transform/streaming/openai-chat-to-anthropic.js";
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
    stream: true,
  };
}

function encodeSSE(event: string, data: unknown): Uint8Array {
  const text = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  return new TextEncoder().encode(text);
}

describe("OpenAIChatToAnthropicStreamTransformer", () => {
  it("emits message_start on first chunk", () => {
    const ctx = makeCtx();
    const transformer = new OpenAIChatToAnthropicStreamTransformer(ctx);

    const chunk = encodeSSE("", {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });

    const output = transformer.transformChunk(chunk);
    const outputText = new TextDecoder().decode(output);

    expect(outputText).toContain("event: message_start");
    expect(outputText).toContain('"type":"message_start"');
  });

  it("converts text delta to content_block_delta", () => {
    const ctx = makeCtx();
    const transformer = new OpenAIChatToAnthropicStreamTransformer(ctx);

    const chunk1 = encodeSSE("", {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
    transformer.transformChunk(chunk1);

    const chunk2 = encodeSSE("", {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    });

    const output = transformer.transformChunk(chunk2);
    const outputText = new TextDecoder().decode(output);

    expect(outputText).toContain("event: content_block_delta");
    expect(outputText).toContain('"type":"text_delta"');
    expect(outputText).toContain('"text":"Hello"');
  });

  it("emits message_stop at stream end", () => {
    const ctx = makeCtx();
    const transformer = new OpenAIChatToAnthropicStreamTransformer(ctx);

    const chunk1 = encodeSSE("", {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    });
    transformer.transformChunk(chunk1);

    const chunk2 = encodeSSE("", {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });

    const output = transformer.transformChunk(chunk2);
    const flushOutput = transformer.flush();
    const outputText = new TextDecoder().decode(output) + new TextDecoder().decode(flushOutput);

    expect(outputText).toContain("event: message_delta");
    expect(outputText).toContain('"stop_reason":"end_turn"');
    expect(outputText).toContain("event: message_stop");
  });
});
