import { describe, it, expect } from "bun:test";
import {
  getTransformer,
  transformRequest,
  transformResponse,
  inferClientFormat,
  inferTargetApiFormat,
} from "../../src/proxy/transform/index.js";
// Import to trigger self-registration
import "../../src/proxy/transform/request/anthropic-to-openai-chat.js";
import "../../src/proxy/transform/response/openai-chat-to-anthropic.js";
import "../../src/proxy/transform/streaming/openai-chat-to-anthropic.js";
import type { ClaudeCodeProfile, ProviderPreset } from "../../src/types.js";

function makeProfile(overrides?: Partial<ClaudeCodeProfile>): ClaudeCodeProfile {
  return {
    name: "test",
    providerId: "groq",
    apiKey: "test",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-01",
    ...overrides,
  };
}

function makePreset(overrides?: Partial<ProviderPreset>): ProviderPreset {
  return {
    id: "groq",
    name: "Groq",
    displayName: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModels: [],
    authType: "api-key",
    wire_api: "chat",
    env_key: "GROQ_API_KEY",
    ...overrides,
  };
}

describe("Transform Integration", () => {
  it("has the anthropic_messages -> openai_chat transformer registered", () => {
    const transformer = getTransformer("anthropic_messages", "openai_chat");
    expect(transformer).not.toBeNull();
    expect(transformer?.clientFormat).toBe("anthropic_messages");
    expect(transformer?.targetFormat).toBe("openai_chat");
  });

  it("converts request and response end-to-end", () => {
    const profile = makeProfile();
    const preset = makePreset();

    const ctx = {
      endpoint: "/v1/messages",
      clientFormat: inferClientFormat("/v1/messages"),
      targetFormat: inferTargetApiFormat(profile, preset),
      profile,
      preset,
      stream: false,
    };

    // Anthropic request
    const anthropicRequest = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      system: "You are helpful.",
      max_tokens: 1024,
    };

    // Transform to OpenAI
    const transformedReq = transformRequest(anthropicRequest, ctx);
    expect(transformedReq.targetEndpoint).toBe("/v1/chat/completions");
    expect(transformedReq.body.messages[0]).toEqual({ role: "system", content: "You are helpful." });
    expect(transformedReq.body.messages[1]).toEqual({ role: "user", content: "Hello" });

    // Simulate OpenAI response
    const openaiResponse = {
      id: "chatcmpl-mock",
      object: "chat.completion",
      created: 1700000000,
      model: "llama-3.3-70b",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hi there!" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };

    // Transform back to Anthropic
    const transformedRes = transformResponse(openaiResponse, ctx) as Record<string, unknown>;
    expect(transformedRes.type).toBe("message");
    expect(transformedRes.role).toBe("assistant");
    expect(transformedRes.content).toEqual([{ type: "text", text: "Hi there!" }]);
    expect(transformedRes.stop_reason).toBe("end_turn");
    expect(transformedRes.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("converts tool calls end-to-end", () => {
    const profile = makeProfile();
    const preset = makePreset();

    const ctx = {
      endpoint: "/v1/messages",
      clientFormat: inferClientFormat("/v1/messages"),
      targetFormat: inferTargetApiFormat(profile, preset),
      profile,
      preset,
      stream: false,
    };

    // Anthropic request with tools
    const anthropicRequest = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "What's the weather?" }],
      tools: [{
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      }],
      max_tokens: 1024,
    };

    const transformedReq = transformRequest(anthropicRequest, ctx);
    expect(transformedReq.body.tools).toHaveLength(1);
    expect(transformedReq.body.tools[0].type).toBe("function");

    // OpenAI response with tool_calls
    const openaiResponse = {
      id: "chatcmpl-mock",
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

    const transformedRes = transformResponse(openaiResponse, ctx) as Record<string, unknown>;
    expect(transformedRes.stop_reason).toBe("tool_use");
    const content = transformedRes.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("tool_use");
    expect(content[0].name).toBe("get_weather");
    expect(content[0].input).toEqual({ city: "Tokyo" });
  });
});
