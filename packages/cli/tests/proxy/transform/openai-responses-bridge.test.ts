import { describe, test, expect } from "bun:test";
import { inferClientFormat } from "../../../src/proxy/transform/index.js";
import { openaiResponsesToOpenAIChatRequest } from "../../../src/proxy/transform/request/openai-responses-to-openai-chat.js";
import { openAIChatToOpenAIResponsesResponse } from "../../../src/proxy/transform/response/openai-chat-to-openai-responses.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const codexReq = JSON.parse(
  readFileSync(join(here, "fixtures/codex-responses-request.json"), "utf-8")
);

describe("inferClientFormat", () => {
  test("/v1/responses is classified as openai_responses (Codex), not anthropic", () => {
    expect(inferClientFormat("/v1/responses")).toBe("openai_responses");
  });
  test("/v1/chat/completions -> openai_chat", () => {
    expect(inferClientFormat("/v1/chat/completions")).toBe("openai_chat");
  });
  test("/v1/messages -> anthropic_messages", () => {
    expect(inferClientFormat("/v1/messages")).toBe("anthropic_messages");
  });
});

describe("openaiResponsesToOpenAIChatRequest", () => {
  test("remaps instructions to a leading system message", () => {
    const out = openaiResponsesToOpenAIChatRequest({ ...codexReq, stream: false }, {} as any);
    const msgs = out.body.messages as any[];
    expect(msgs[0]).toEqual({ role: "system", content: "You are a coding agent." });
    expect(out.targetEndpoint).toBe("/v1/chat/completions");
  });

  test("accepts a bare string input as one user message", () => {
    const out = openaiResponsesToOpenAIChatRequest({ model: "m", input: "Reply with exactly: pong" }, {} as any);
    expect(out.body.messages).toEqual([{ role: "user", content: "Reply with exactly: pong" }]);
  });

  test("maps developer role to system and input_text to text", () => {
    const out = openaiResponsesToOpenAIChatRequest({ ...codexReq, stream: false }, {} as any);
    const dev = (out.body.messages as any[]).find((m) => m.content === "<dev instructions>");
    expect(dev).toBeDefined();
    expect((out.body.messages as any[]).at(-1)).toEqual({ role: "user", content: "Reply with exactly: pong" });
  });

  test("nests tools under function{}", () => {
    const out = openaiResponsesToOpenAIChatRequest({ ...codexReq, stream: false }, {} as any);
    expect(out.body.tools[0]).toEqual({
      type: "function",
      function: { name: "exec_command", description: "Runs a command.", parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"], additionalProperties: false } },
    });
  });

  test("converts function_call + function_call_output items into assistant tool_calls + tool message", () => {
    const body = {
      model: "m",
      input: [
        { type: "function_call", call_id: "call_42", name: "exec_command", arguments: '{"cmd":"ls"}' },
        { type: "function_call_output", call_id: "call_42", output: "file.txt" },
      ],
    };
    const out = openaiResponsesToOpenAIChatRequest(body, {} as any);
    const msgs = out.body.messages as any[];
    expect(msgs).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "call_42", type: "function", function: { name: "exec_command", arguments: '{"cmd":"ls"}' } }] },
      { role: "tool", tool_call_id: "call_42", content: "file.txt" },
    ]);
  });

  test("maps tool_choice object form and drops store/include/client_metadata", () => {
    const out = openaiResponsesToOpenAIChatRequest(
      { ...codexReq, tool_choice: { type: "function", name: "exec_command" }, store: true, include: ["x"], client_metadata: { a: 1 } },
      {} as any
    );
    expect(out.body.tool_choice).toEqual({ type: "function", function: { name: "exec_command" } });
    expect(out.body.store).toBeUndefined();
    expect(out.body.include).toBeUndefined();
    expect(out.body.client_metadata).toBeUndefined();
  });

  test("maps max_output_tokens -> max_tokens and reasoning.effort -> reasoning_effort", () => {
    const out = openaiResponsesToOpenAIChatRequest(
      { model: "m", input: [], max_output_tokens: 1234, reasoning: { effort: "high" } },
      {} as any
    );
    expect(out.body.max_tokens).toBe(1234);
    expect(out.body.reasoning_effort).toBe("high");
  });
});

describe("openAIChatToOpenAIResponsesResponse", () => {
  test("text reply becomes a response with one output_text message", () => {
    const chat = {
      id: "chatcmpl-1", model: "kimi", choices: [{ message: { content: "pong" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    };
    const out: any = openAIChatToOpenAIResponsesResponse(chat, {} as any);
    expect(out.object).toBe("response");
    expect(out.status).toBe("completed");
    expect(out.id).toBe("resp_chatcmpl-1");
    expect(out.output).toEqual([
      { type: "message", id: "msg_0", status: "completed", role: "assistant", content: [{ type: "output_text", text: "pong", annotations: [] }] },
    ]);
    expect(out.usage).toEqual({ input_tokens: 5, output_tokens: 1, total_tokens: 6 });
  });

  test("tool_calls become function_call items with call_id", () => {
    const chat = {
      id: "c1", model: "m", choices: [{ message: { content: null, tool_calls: [
        { id: "call_7", type: "function", function: { name: "exec_command", arguments: '{"cmd":"ls"}' } },
      ] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    };
    const out: any = openAIChatToOpenAIResponsesResponse(chat, {} as any);
    expect(out.output[0]).toEqual({ type: "function_call", id: "fc_0", call_id: "call_7", name: "exec_command", arguments: '{"cmd":"ls"}', status: "completed" });
    expect(out.status).toBe("completed");
  });

  test("finish_reason length -> status incomplete", () => {
    const chat = { id: "c", model: "m", choices: [{ message: { content: "..." }, finish_reason: "length" }] };
    expect((openAIChatToOpenAIResponsesResponse(chat, {} as any) as any).status).toBe("incomplete");
  });
});

describe("openaiResponsesToOpenAIChatRequest — tool name filtering", () => {
  test("drops tools whose names don't match upstream validation (mcp__node_repl, null, dotted)", () => {
    const body = {
      model: "m",
      input: [],
      tools: [
        { type: "function", name: "exec_command", parameters: { type: "object" } },
        { type: "function", name: "mcp__node_repl", parameters: { type: "object" } },
        { type: "function", name: "mcp__penpot", parameters: { type: "object" } },
        { type: "function", name: null, parameters: { type: "object" } },
        { type: "function", name: "my.tool", parameters: { type: "object" } },
        { type: "function", name: "view_image", parameters: { type: "object" } },
      ],
    };
    const out = openaiResponsesToOpenAIChatRequest(body, {} as any);
    const names = (out.body.tools as any[]).map((t) => t.function.name);
    expect(names).toEqual(["exec_command", "view_image"]);
  });

  test("defaults missing tool parameters to an empty object schema", () => {
    const body = {
      model: "m",
      input: [],
      tools: [
        { type: "function", name: "exec_command", parameters: { type: "object", properties: { cmd: { type: "string" } } } },
        { type: "custom", name: "apply_patch" },
        { type: "function", name: "view_image", parameters: null },
      ],
    };
    const out = openaiResponsesToOpenAIChatRequest(body, {} as any);
    const tools = out.body.tools as any[];
    expect(tools[0].function.parameters).toEqual({ type: "object", properties: { cmd: { type: "string" } } });
    expect(tools[1].function.parameters).toEqual({ type: "object", properties: {} });
    expect(tools[2].function.parameters).toEqual({ type: "object", properties: {} });
  });
});

// --- Streaming bridge: openai_chat SSE -> openai_responses SSE (Codex) ---
import { createOpenAIChatToOpenAIResponsesStream } from "../../../src/proxy/transform/streaming/openai-chat-to-openai-responses.js";

const fixtureDir = join(here, "fixtures");
function sseBytes(events: any[]): Uint8Array {
  return new TextEncoder().encode(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n");
}
async function drain(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      out.push(buf.slice(0, idx));
      buf = buf.slice(idx + 2);
    }
  }
  return out;
}
const streamCtx = { endpoint: "/v1/responses", clientFormat: "openai_responses", targetFormat: "openai_chat", profile: {} as any, preset: {} as any, stream: true } as any;

describe("openAIChatToOpenAIResponsesStream", () => {
  test("text deltas emit created→added→delta→done→completed", async () => {
    const chunks = sseBytes([
      { id: "c1", model: "kimi", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
      { id: "c1", model: "kimi", choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }] },
    ]);
    const events = await drain(createOpenAIChatToOpenAIResponsesStream(chunks, streamCtx));
    const types = events.map((raw) => {
      const m = raw.match(/^event: (\S+)/); return m ? m[1] : "(data)";
    });
    expect(types).toEqual([
      "response.created", "response.output_item.added", "response.content_part.added",
      "response.output_text.delta", "response.output_text.delta",
      "response.output_text.done", "response.content_part.done", "response.output_item.done",
      "response.completed",
    ]);
  });

  test("tool_call deltas emit function_call + arguments.delta + completed with call_id", async () => {
    const chunks = sseBytes([
      { id: "c1", model: "kimi", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_9", function: { name: "exec_command", arguments: "{\"cmd\":" } }] }, finish_reason: null }] },
      { id: "c1", model: "kimi", choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"ls\"}" } }] }, finish_reason: "tool_calls" }] },
    ]);
    const events = await drain(createOpenAIChatToOpenAIResponsesStream(chunks, streamCtx));
    const joined = events.join("\n");
    expect(joined).toContain('"call_id":"call_9"');
    expect(joined).toContain("response.function_call_arguments.delta");
    // arguments are JSON-stringified inside the SSE data payload, so the
    // concatenated args {"cmd":"ls"} appear escaped as {\"cmd\":\"ls\"}
    expect(joined).toContain('{\\"cmd\\":\\"ls\\"}');
    expect(joined).toContain("response.completed");
  });

  test("regression: real kimi fixture (with reasoning_content + no-space data:) parses without throwing and reaches completed", async () => {
    // Normalize CRLF: git may check the fixture out with Windows line endings
    // (core.autocrlf), while SSE framing is defined in terms of LF.
    const raw = readFileSync(join(fixtureDir, "kimi-chat-stream.txt"), "utf-8").replace(/\r\n/g, "\n");
    const stream = createOpenAIChatToOpenAIResponsesStream(new TextEncoder().encode(raw), streamCtx);
    const events = await drain(stream);
    expect(events.some((e) => e.includes("response.completed"))).toBe(true);
  });
});
