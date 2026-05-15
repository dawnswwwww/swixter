import { describe, it, expect } from "bun:test";
import {
  inferClientFormat,
  inferTargetApiFormat,
  getTransformer,
  transformRequest,
  transformResponse,
  transformStream,
  registerTransformer,
} from "../../../src/proxy/transform/index.js";
import type { ClaudeCodeProfile, ProviderPreset } from "../../../src/types.js";

describe("inferClientFormat", () => {
  it("returns anthropic_messages for /v1/messages", () => {
    expect(inferClientFormat("/v1/messages")).toBe("anthropic_messages");
  });

  it("returns openai_chat for /v1/chat/completions", () => {
    expect(inferClientFormat("/v1/chat/completions")).toBe("openai_chat");
  });

  it("returns anthropic_responses for /v1/responses", () => {
    expect(inferClientFormat("/v1/responses")).toBe("anthropic_responses");
  });

  it("returns anthropic_messages for /anthropic/", () => {
    expect(inferClientFormat("/anthropic/v1/messages")).toBe("anthropic_messages");
  });
});

describe("inferTargetApiFormat", () => {
  const mockPreset: ProviderPreset = {
    id: "groq",
    name: "Groq",
    displayName: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModels: [],
    authType: "api-key",
    wire_api: "chat",
    env_key: "GROQ_API_KEY",
  };

  it("infers openai_chat from wire_api=chat", () => {
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "groq",
      apiKey: "test",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };
    expect(inferTargetApiFormat(profile, mockPreset)).toBe("openai_chat");
  });

  it("uses profile.apiFormat when explicitly set", () => {
    const profile = {
      name: "test",
      providerId: "groq",
      apiKey: "test",
      apiFormat: "openai_responses",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    } as ClaudeCodeProfile;
    expect(inferTargetApiFormat(profile, mockPreset)).toBe("openai_responses");
  });

  it("infers anthropic_messages from wire_api=responses", () => {
    const preset: ProviderPreset = {
      ...mockPreset,
      baseURL: "https://api.anthropic.com",
      wire_api: "responses",
    };
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "anthropic",
      apiKey: "test",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };
    expect(inferTargetApiFormat(profile, preset)).toBe("anthropic_messages");
  });

  it("uses defaultApiFormat when baseURL has no strong signal", () => {
    const preset: ProviderPreset = {
      ...mockPreset,
      baseURL: "https://api.siliconflow.cn",
      defaultApiFormat: "anthropic_messages",
      wire_api: "responses",
    };
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "siliconflow-cn",
      apiKey: "test",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };
    expect(inferTargetApiFormat(profile, preset)).toBe("anthropic_messages");
  });

  it("infers anthropic_messages from baseURL containing /anthropic", () => {
    const preset: ProviderPreset = {
      ...mockPreset,
      baseURL: "https://api.deepseek.com/anthropic",
      defaultApiFormat: "anthropic_messages",
      wire_api: "chat",
    };
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "deepseek",
      apiKey: "test",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };
    expect(inferTargetApiFormat(profile, preset)).toBe("anthropic_messages");
  });

  it("infers openai_chat from baseURL containing /openai", () => {
    const preset: ProviderPreset = {
      ...mockPreset,
      baseURL: "https://api.groq.com/openai/v1",
      defaultApiFormat: "openai_chat",
      wire_api: "chat",
    };
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "groq",
      apiKey: "test",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };
    expect(inferTargetApiFormat(profile, preset)).toBe("openai_chat");
  });

  it("profile.apiFormat overrides all other inference", () => {
    const preset: ProviderPreset = {
      ...mockPreset,
      baseURL: "https://api.deepseek.com/anthropic",
      defaultApiFormat: "anthropic_messages",
      wire_api: "chat",
    };
    const profile: ClaudeCodeProfile = {
      name: "test",
      providerId: "deepseek",
      apiKey: "test",
      apiFormat: "openai_chat",
      createdAt: "2024-01-01",
      updatedAt: "2024-01-01",
    };
    expect(inferTargetApiFormat(profile, preset)).toBe("openai_chat");
  });
});

describe("getTransformer", () => {
  it("returns null when client and target formats are the same", () => {
    const result = getTransformer("openai_chat", "openai_chat");
    expect(result).toBeNull();
  });

  it("returns null for unregistered conversion pairs", () => {
    const result = getTransformer("gemini_native", "openai_responses");
    expect(result).toBeNull();
  });
});

describe("registerTransformer", () => {
  it("registers a transformer and makes it available", () => {
    const mockTransformer = {
      clientFormat: "anthropic_messages" as const,
      targetFormat: "openai_chat" as const,
      requestTransform: (body: unknown) => ({ body }),
      responseTransform: (body: unknown) => body,
      streamTransform: (stream: ReadableStream<Uint8Array>) => stream,
    };
    registerTransformer(mockTransformer);
    const result = getTransformer("anthropic_messages", "openai_chat");
    expect(result).not.toBeNull();
    expect(result?.clientFormat).toBe("anthropic_messages");
    expect(result?.targetFormat).toBe("openai_chat");
  });

  it("replaces existing transformer for same format pair", () => {
    const first = {
      clientFormat: "anthropic_messages" as const,
      targetFormat: "openai_chat" as const,
      requestTransform: (body: unknown) => ({ body: { version: 1 } }),
      responseTransform: (body: unknown) => body,
      streamTransform: (stream: ReadableStream<Uint8Array>) => stream,
    };
    const second = {
      clientFormat: "anthropic_messages" as const,
      targetFormat: "openai_chat" as const,
      requestTransform: (body: unknown) => ({ body: { version: 2 } }),
      responseTransform: (body: unknown) => body,
      streamTransform: (stream: ReadableStream<Uint8Array>) => stream,
    };
    registerTransformer(first);
    registerTransformer(second);
    const result = getTransformer("anthropic_messages", "openai_chat");
    const transformed = result?.requestTransform({}, {} as any);
    expect(transformed).toEqual({ body: { version: 2 } });
  });
});

describe("transformRequest", () => {
  it("returns passthrough when no transformer is registered", () => {
    const ctx = {
      endpoint: "/v1/messages",
      clientFormat: "anthropic_messages" as const,
      targetFormat: "anthropic_messages" as const,
      profile: { name: "test", providerId: "anthropic", apiKey: "test", createdAt: "", updatedAt: "" } as ClaudeCodeProfile,
      preset: { id: "anthropic", name: "Anthropic", displayName: "Anthropic", baseURL: "", defaultModels: [], authType: "api-key" as const } as ProviderPreset,
      stream: false,
    };
    const body = { model: "claude", messages: [] };
    const result = transformRequest(body, ctx);
    expect(result.body).toBe(body);
    expect(result.targetEndpoint).toBe("/v1/messages");
  });
});

describe("transformResponse", () => {
  it("returns body unchanged when no transformer is registered", () => {
    const ctx = {
      endpoint: "/v1/messages",
      clientFormat: "anthropic_messages" as const,
      targetFormat: "anthropic_messages" as const,
      profile: { name: "test", providerId: "anthropic", apiKey: "test", createdAt: "", updatedAt: "" } as ClaudeCodeProfile,
      preset: { id: "anthropic", name: "Anthropic", displayName: "Anthropic", baseURL: "", defaultModels: [], authType: "api-key" as const } as ProviderPreset,
      stream: false,
    };
    const body = { type: "message", content: [] };
    const result = transformResponse(body, ctx);
    expect(result).toBe(body);
  });
});

describe("transformStream", () => {
  it("returns stream unchanged when no transformer is registered", () => {
    const ctx = {
      endpoint: "/v1/messages",
      clientFormat: "anthropic_messages" as const,
      targetFormat: "anthropic_messages" as const,
      profile: { name: "test", providerId: "anthropic", apiKey: "test", createdAt: "", updatedAt: "" } as ClaudeCodeProfile,
      preset: { id: "anthropic", name: "Anthropic", displayName: "Anthropic", baseURL: "", defaultModels: [], authType: "api-key" as const } as ProviderPreset,
      stream: true,
    };
    const stream = new ReadableStream({ start(controller) { controller.close(); } });
    const result = transformStream(stream, ctx);
    expect(result).toBe(stream);
  });
});
