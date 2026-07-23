# Codex Responses ↔ OpenAI-Chat Proxy Bridge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Codex (which only speaks the OpenAI Responses API, `/v1/responses`) drive chat-only providers (Kimi, GLM, MiniMax — all return 404 on `/v1/responses`) by routing Codex traffic through swixter's local proxy, which translates `openai_responses ↔ openai_chat`.

**Architecture:** swixter already has a proxy server + a generic request→transform→forward→response/stream-transform pipeline (`packages/cli/src/proxy/handler.ts`) and a transformer registry (`packages/cli/src/proxy/transform/`). Today the registry only contains `anthropic_messages ↔ openai_chat` (for Claude Code). We add a second registered transformer pair, `openai_responses ↔ openai_chat`, fix the format-inference bug that misclassifies Codex's `/v1/responses` calls, and wire `swixter codex apply` to point chat-only providers at the local proxy.

**Tech Stack:** TypeScript (strict), Bun runtime + `bun:test`, `smol-toml`, existing swixter proxy (Bun.serve). No new dependencies.

**Ground-truth sources (do not re-derive from memory):**
- Codex request shape: captured from Codex 0.137.0 `codex exec` — see fixture in Task 1.
- Codex accepted response SSE sequence: validated end-to-end (Codex rendered "pong" / executed a function call from hand-written events) — see Task 4 spec.
- Kimi chat shapes: probed live against `https://api.kimi.com/coding/v1` — `/chat/completions` returns standard OpenAI chat (200), `/responses` returns 404.

---

## File Structure

**Create:**
- `packages/cli/src/proxy/transform/request/openai-responses-to-openai-chat.ts` — request transformer (Codex responses body → kimi chat body).
- `packages/cli/src/proxy/transform/response/openai-chat-to-openai-responses.ts` — non-streaming response transformer + registration of the full `openai_responses ↔ openai_chat` pair (mirrors how `streaming/openai-chat-to-anthropic.ts` owns registration today).
- `packages/cli/src/proxy/transform/streaming/openai-chat-to-openai-responses.ts` — SSE stream transformer (the tool-call-aware hard part).

**Modify:**
- `packages/cli/src/proxy/transform/index.ts` — fix `inferClientFormat` so `/v1/responses` → `openai_responses` (currently wrongly → `anthropic_responses`).
- `packages/cli/src/proxy/handler.ts:5` — import the new streaming module so its self-registration side-effect runs.
- `packages/cli/src/cli/codex.ts` (`cmdApply`, ~line 940) — when the active profile's target format is `openai_chat` (chat-only provider), write the provider `base_url` as the local proxy URL and ensure the proxy is running.

**Test (create):**
- `packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts` — all transformer unit tests.

**Design boundaries:** Each transformer file has one responsibility and one format pair. The request transformer is a pure function. The response + streaming files mirror the existing anthropic-pair structure exactly (streaming file owns `registerTransformer`).

---

## Phase 1 — Transformers (pure, unit-tested, committable independently)

### Task 1: Capture kimi chat streaming fixture + lock Codex request fixture

**Why:** The streaming transformer must consume real kimi SSE and emit real Codex-accepted SSE. We lock both as test fixtures before writing code so tests are grounded in captured reality, not memory.

**Files:**
- Create: `packages/cli/tests/proxy/transform/fixtures/codex-responses-request.json`
- Create: `packages/cli/tests/proxy/transform/fixtures/kimi-chat-stream.txt`

- [ ] **Step 1: Write the Codex request fixture**

A `/tmp/codex-capture/fixture.json` already exists from the capture session. Copy a representative subset into the repo test fixtures. Create `packages/cli/tests/proxy/transform/fixtures/codex-responses-request.json`:

```json
{
  "model": "kimi-for-coding",
  "instructions": "You are a coding agent.",
  "input": [
    { "type": "message", "role": "developer", "content": [{ "type": "input_text", "text": "<dev instructions>" }] },
    { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "Reply with exactly: pong" }] }
  ],
  "tools": [
    {
      "type": "function",
      "name": "exec_command",
      "description": "Runs a command.",
      "strict": false,
      "parameters": { "type": "object", "properties": { "cmd": { "type": "string" } }, "required": ["cmd"], "additionalProperties": false }
    }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "reasoning": null,
  "store": false,
  "stream": true,
  "include": []
}
```

This matches the captured Codex 0.137.0 body (flat `tools[].name`, `input[].content[].type = "input_text"`, `role: "developer"`).

- [ ] **Step 2: Capture a real kimi chat streaming response**

Run (zsh; the `--` keeps the JSON clean). This hits the user's own Kimi key for a 1-token stream — minimal cost, the user has authorized this provider for this purpose.

```bash
mkdir -p packages/cli/tests/proxy/transform/fixtures
KEY=$(bun -e 'import{readFile}from"node:fs/promises";import{join}from"node:path";import{homedir}from"node:os";const c=JSON.parse(await readFile(join(homedir(),".config/swixter/config.json"),"utf-8"));const f=o=>{for(const k in o){const v=o[k];if(v&&typeof v==="object"){if(v.name==="kimi-codex")return v;const r=f(v);if(r)return r;}}};console.log(f(c).apiKey)')
curl -sN https://api.kimi.com/coding/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"kimi-for-coding","messages":[{"role":"user","content":"Reply with exactly: pong"}],"max_tokens":5,"stream":true}' \
  > packages/cli/tests/proxy/transform/fixtures/kimi-chat-stream.txt
```

- [ ] **Step 3: Verify the fixture shapes**

```bash
head -20 packages/cli/tests/proxy/transform/fixtures/kimi-chat-stream.txt
```
Expected: lines beginning `data: {"id":...,"choices":[{"delta":{"content":"..."}}]}` and a final `data: [DONE]`. If the file is empty or an error JSON, stop and re-capture (key wrong / endpoint changed).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/tests/proxy/transform/fixtures/
git commit -m "test(proxy): add captured codex-responses + kimi-chat fixtures"
```

---

### Task 2: Fix `inferClientFormat` OpenAI Responses misclassification

**Why:** `transform/index.ts:31-33` maps `/v1/responses` → `anthropic_responses`. Codex hits `/v1/responses` speaking **OpenAI** Responses, so today the proxy misroutes it and finds no transformer → passes through → 404. This is the root enabler.

**Files:**
- Modify: `packages/cli/src/proxy/transform/index.ts:27-38`
- Test: `packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { inferClientFormat } from "../../../src/proxy/transform/index.js";

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
```

- [ ] **Step 2: Run — verify it fails**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: the `/v1/responses` test FAILS (`Expected: "openai_responses" / Received: "anthropic_responses"`); other two pass.

- [ ] **Step 3: Fix `inferClientFormat`**

In `packages/cli/src/proxy/transform/index.ts`, replace the body of `inferClientFormat` (lines 27-38):

```ts
export function inferClientFormat(endpoint: string): ApiFormat {
  if (endpoint.includes("/v1/chat/completions")) {
    return "openai_chat";
  }
  // Codex drives the OpenAI Responses API at /v1/responses. (Anthropic clients
  // use /v1/messages; there is no real anthropic_responses client, so /v1/responses
  // is unambiguously OpenAI Responses.)
  if (endpoint.includes("/v1/responses")) {
    return "openai_responses";
  }
  if (endpoint.includes("/anthropic/") || endpoint.includes("/v1/messages")) {
    return "anthropic_messages";
  }
  return "anthropic_messages";
}
```

- [ ] **Step 4: Run — verify pass**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: 3 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/proxy/transform/index.ts packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts
git commit -m "fix(proxy): classify /v1/responses as openai_responses for Codex"
```

---

### Task 3: Request transformer `openai_responses → openai_chat`

**Why:** Codex sends a responses body (`instructions`, `input[]`, flat `tools`). Kimi needs a chat body (`messages[]`, nested `tools`, `max_tokens`). Pure function, easiest to test first.

**Files:**
- Create: `packages/cli/src/proxy/transform/request/openai-responses-to-openai-chat.ts`
- Test: append to `packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts`

Field map (derived from captured Codex body + OpenAI chat spec):

| Codex responses | → | chat completions |
|---|---|---|
| `model` | → | `model` |
| `instructions` (string) | → | `messages[0] = {role:"system", content}` (only if non-empty) |
| `input[]` | → | `messages[]` (see item rules below) |
| `max_output_tokens` | → | `max_tokens` |
| `temperature` / `top_p` | → | same |
| `stream` | → | `stream` |
| `tools[]` flat `{type:"function", name, description, parameters}` | → | `tools[]` nested `{type:"function", function:{name, description, parameters}}` |
| `tool_choice` `"auto"\|"none"\|"required"` | → | same string |
| `tool_choice` `{type:"function", name}` | → | `{type:"function", function:{name}}` |
| `parallel_tool_calls` | → | `parallel_tool_calls` |
| `reasoning.effort` | → | `reasoning_effort` (drop if absent) |
| `store`, `include`, `prompt_cache_key`, `client_metadata` | → | drop |

`input[]` item rules:
- `{type:"message", role:"developer", content}` → `{role:"system", content: flattenText(content)}`
- `{type:"message", role:"user"\|"assistant"\|"system", content}` → same role, `flattenText(content)`
- `{type:"message", role:"assistant", content:[...function_call...]}` → handled via the function_call item rule below (Codex puts tool calls as separate top-level items, not inline)
- `{type:"function_call", call_id, name, arguments}` → `{role:"assistant", content:null, tool_calls:[{id:call_id, type:"function", function:{name, arguments}}]}`
- `{type:"function_call_output", call_id, output}` → `{role:"tool", tool_call_id:call_id, content: stringify(output)}`

`flattenText(content)`: if `content` is a string, return it; if it's an array of `{type:"input_text"\|"output_text", text}` (and any image parts), map text parts to `{type:"text", text}` and keep image parts as-is (chat format `{type:"image_url", image_url:{url}}` — but Codex's bridge today is text-only; for an image part, pass through `{type:"text", text:"[image]"}` placeholder and log). For the first cut, handle text only; throw a clear error on unsupported part types so we notice.

`targetEndpoint = "/v1/chat/completions"`.

- [ ] **Step 1: Write failing tests**

Append to `packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts`:

```ts
import { openaiResponsesToOpenAIChatRequest } from "../../../src/proxy/transform/request/openai-responses-to-openai-chat.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const codexReq = JSON.parse(
  readFileSync(join(here, "fixtures/codex-responses-request.json"), "utf-8")
);

describe("openaiResponsesToOpenAIChatRequest", () => {
  test("remaps instructions to a leading system message", () => {
    const out = openaiResponsesToOpenAIChatRequest({ ...codexReq, stream: false }, {} as any);
    const msgs = out.body.messages as any[];
    expect(msgs[0]).toEqual({ role: "system", content: "You are a coding agent." });
    expect(out.targetEndpoint).toBe("/v1/chat/completions");
  });

  test("maps developer role to system and input_text to text", () => {
    const out = openaiResponsesToOpenAIChatRequest({ ...codexReq, stream: false }, {} as any);
    const dev = (out.body.messages as any[]).find((m) => m.content === "<dev instructions>");
    expect(dev).toBeDefined();
    // user message preserved with string content
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
```

- [ ] **Step 2: Run — verify fail**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: all new tests FAIL (module not found / function undefined).

- [ ] **Step 3: Implement the transformer**

Create `packages/cli/src/proxy/transform/request/openai-responses-to-openai-chat.ts`:

```ts
import type { TransformContext, TransformedRequest } from "../types.js";

/**
 * Convert an OpenAI Responses (Codex) request body into an OpenAI Chat
 * Completions request body. See plan field-map table for the source of each
 * mapping (captured from Codex 0.137.0).
 */
export function openaiResponsesToOpenAIChatRequest(
  body: unknown,
  _ctx: TransformContext
): TransformedRequest {
  const r = body as Record<string, any>;
  const chatBody: Record<string, unknown> = { model: r.model };

  const messages: Record<string, unknown>[] = [];

  if (typeof r.instructions === "string" && r.instructions.length > 0) {
    messages.push({ role: "system", content: r.instructions });
  }

  if (Array.isArray(r.input)) {
    for (const item of r.input) {
      const converted = convertInputItem(item);
      if (Array.isArray(converted)) messages.push(...converted);
      else if (converted) messages.push(converted);
    }
  }
  chatBody.messages = messages;

  if (r.max_output_tokens !== undefined) chatBody.max_tokens = r.max_output_tokens;
  if (r.temperature !== undefined) chatBody.temperature = r.temperature;
  if (r.top_p !== undefined) chatBody.top_p = r.top_p;
  if (r.stream !== undefined) chatBody.stream = r.stream;
  if (r.parallel_tool_calls !== undefined) chatBody.parallel_tool_calls = r.parallel_tool_calls;

  if (Array.isArray(r.tools)) {
    chatBody.tools = r.tools.map((t: Record<string, unknown>) => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  if (r.tool_choice !== undefined) chatBody.tool_choice = convertToolChoice(r.tool_choice);

  const effort = (r.reasoning as Record<string, unknown> | undefined)?.effort;
  if (typeof effort === "string") chatBody.reasoning_effort = effort;

  return { body: chatBody, targetEndpoint: "/v1/chat/completions" };
}

function convertInputItem(item: Record<string, any>): Record<string, unknown>[] | Record<string, unknown> | null {
  switch (item.type) {
    case "message": {
      const role = item.role === "developer" ? "system" : item.role;
      return { role, content: flattenText(item.content) };
    }
    case "function_call": {
      return {
        role: "assistant",
        content: null,
        tool_calls: [{ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments ?? "" } }],
      };
    }
    case "function_call_output": {
      return {
        role: "tool",
        tool_call_id: item.call_id,
        content: typeof item.output === "string" ? item.output : JSON.stringify(item.output ?? ""),
      };
    }
    default:
      return null;
  }
}

function flattenText(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content;
  const parts: Record<string, unknown>[] = [];
  for (const part of content) {
    if (part.type === "input_text" || part.type === "output_text" || part.type === "text") {
      parts.push({ type: "text", text: part.text });
    } else {
      throw new Error(`openai_responses→openai_chat: unsupported content part type "${part.type}"`);
    }
  }
  return parts;
}

function convertToolChoice(tc: unknown): unknown {
  if (typeof tc === "string") return tc; // auto | none | required
  if (tc && typeof tc === "object") {
    const t = tc as Record<string, unknown>;
    if (t.type === "function" && t.name) {
      return { type: "function", function: { name: t.name } };
    }
  }
  return tc;
}
```

- [ ] **Step 4: Run — verify pass**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/proxy/transform/request/openai-responses-to-openai-chat.ts packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts
git commit -m "feat(proxy): openai_responses → openai_chat request transformer"
```

---

### Task 4: Non-streaming response transformer `openai_chat → openai_responses`

**Why:** Kimi's non-streaming chat response must become a Responses `response` object. Smaller and lower-risk than streaming; do it first to lock the output shape.

**Files:**
- Create: `packages/cli/src/proxy/transform/response/openai-chat-to-openai-responses.ts`
- Test: append to `packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts`

Output shape (validated against Codex 0.137.0):

```jsonc
{
  "id": "resp_<chat.id or gen>",
  "object": "response",
  "status": "completed",
  "model": "<chat.model>",
  "output": [
    // zero or one assistant message item with output_text content, AND/OR
    // one function_call item per chat tool_call
  ],
  "usage": { "input_tokens": N, "output_tokens": N, "total_tokens": N }
}
```

Rules:
- If `choices[0].message.content` is non-empty text → push `{type:"message", id:"msg_0", status:"completed", role:"assistant", content:[{type:"output_text", text, annotations:[]}]}`.
- For each `tool_call` in `choices[0].message.tool_calls` → push `{type:"function_call", id:"fc_<i>", call_id: tool_call.id, name: tool_call.function.name, arguments: tool_call.function.arguments ?? "", status:"completed"}`.
- `status`: `"completed"` for finish_reason `stop`/`tool_calls`/`function_call`; `"incomplete"` for `length`; `"completed"` otherwise.
- usage: `input_tokens = prompt_tokens`, `output_tokens = completion_tokens`, `total_tokens = total_tokens` (or sum).

- [ ] **Step 1: Write failing tests**

Append:

```ts
import { openAIChatToOpenAIResponsesResponse } from "../../../src/proxy/transform/response/openai-chat-to-openai-responses.js";

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
```

- [ ] **Step 2: Run — verify fail**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: new tests FAIL (module not found).

- [ ] **Step 3: Implement**

Create `packages/cli/src/proxy/transform/response/openai-chat-to-openai-responses.ts`:

```ts
import type { TransformContext } from "../types.js";

/** OpenAI Chat Completions response → OpenAI Responses response object. */
export function openAIChatToOpenAIResponsesResponse(body: unknown, _ctx: TransformContext): unknown {
  const chat = body as Record<string, any>;
  const choices = chat.choices as Array<Record<string, any>> | undefined;
  const choice = choices?.[0];
  const message = choice?.message as Record<string, any> | undefined;

  const output: Record<string, unknown>[] = [];

  if (message) {
    if (typeof message.content === "string" && message.content.length > 0) {
      output.push({
        type: "message", id: "msg_0", status: "completed", role: "assistant",
        content: [{ type: "output_text", text: message.content, annotations: [] }],
      });
    }
    if (Array.isArray(message.tool_calls)) {
      message.tool_calls.forEach((tc: Record<string, any>, i: number) => {
        const fn = tc.function || {};
        output.push({
          type: "function_call",
          id: `fc_${i}`,
          call_id: tc.id,
          name: fn.name,
          arguments: typeof fn.arguments === "string" ? fn.arguments : JSON.stringify(fn.arguments ?? ""),
          status: "completed",
        });
      });
    }
  }

  const usage = chat.usage as Record<string, number> | undefined;
  const inputTokens = usage?.prompt_tokens ?? 0;
  const outputTokens = usage?.completion_tokens ?? 0;

  return {
    id: `resp_${chat.id ?? ""}`.replace(/^resp_$/, "resp_" + Date.now()),
    object: "response",
    status: mapStatus(choice?.finish_reason),
    model: chat.model ?? "unknown",
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: usage?.total_tokens ?? inputTokens + outputTokens,
    },
  };
}

function mapStatus(finishReason: string | undefined): string {
  if (finishReason === "length") return "incomplete";
  return "completed";
}
```

- [ ] **Step 4: Run — verify pass**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/proxy/transform/response/openai-chat-to-openai-responses.ts packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts
git commit -m "feat(proxy): openai_chat → openai_responses response transformer"
```

---

### Task 5: Streaming transformer + register the pair

**Why:** Codex runs with `stream:true`. This is the hard part — convert kimi's chat SSE deltas into the Codex-accepted Responses event sequence, correctly handling tool calls (`call_id` lifecycle). It also owns `registerTransformer` for the `openai_responses ↔ openai_chat` pair (mirroring how `streaming/openai-chat-to-anthropic.ts` owns its registration).

**Files:**
- Create: `packages/cli/src/proxy/transform/streaming/openai-chat-to-openai-responses.ts`
- Modify: `packages/cli/src/proxy/handler.ts:5` (add import for self-registration)
- Test: append to `packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts`

Event sequence to emit (validated end-to-end against Codex 0.137.0):

**Text path** (kimi `delta.content`):
1. (once) `response.created` — `{type, response:{id, object:"response", status:"in_progress", model, output:[]}}`
2. (once, when first text seen) `response.output_item.added` — `{output_index:0, item:{type:"message", id:"msg_0", status:"in_progress", role:"assistant", content:[]}}`
3. (once) `response.content_part.added` — `{item_id:"msg_0", output_index:0, content_index:0, part:{type:"output_text", text:"", annotations:[]}}`
4. (per delta) `response.output_text.delta` — `{item_id:"msg_0", output_index:0, content_index:0, delta:<text>}`
5. (at finish) `response.output_text.done` — `{..., text:<accumulated>}`
6. `response.content_part.done` — `{..., part:{type:"output_text", text, annotations:[]}}`
7. `response.output_item.done` — `{output_index:0, item:{...completed message...}}`

**Tool-call path** (kimi `delta.tool_calls[]`, fields: `index`, `id`, `function.name`, `function.arguments`):
- On first sighting of tool_call index `i`: emit `response.output_item.added` with `{output_index:N, item:{type:"function_call", id:"fc_<i>", call_id: tool_call.id, name: function.name, arguments:"", status:"in_progress"}}` (record mapping `chat-index → {outputIndex, callId, name, argsBuf}`).
- On each `function.arguments` delta for index `i`: append to `argsBuf`, emit `response.function_call_arguments.delta` — `{item_id:"fc_<i>", output_index:N, delta:<chunk>}`.
- At finish, for each tool: `response.function_call_arguments.done` — `{item_id, output_index, arguments: argsBuf}`, then `response.output_item.done` — `{output_index:N, item:{...function_call, status:"completed"}}`.

**Finish** (kimi `finish_reason` present or `[DONE]`):
- Close any open text block (steps 5-7) if text was emitted.
- Close all open tool blocks.
- Emit `response.completed` — `{type:"response.completed", response:{id, object:"response", status:"completed", model, output:[...all completed output items...], usage:{...}}}`.

**call_id lifecycle (critical):** Codex later sends back `function_call_output` items keyed by `call_id`. We pass kimi's `tool_call.id` through verbatim as `call_id`. Do **not** invent ids; if kimi omits `id` on the delta, fall back to `call_<i>` and keep it stable.

- [ ] **Step 1: Read the base class + existing streaming transformer for the exact pattern**

```bash
sed -n '1,80p' packages/cli/src/proxy/transform/streaming/base.ts
```
Confirm: `SSEStreamTransformer` base class with abstract `convertEvent(event: SSEEvent)`, and `createSSETransformStream(transformer)` factory. `SSEEvent` is `{event?: string, data: any}`. The existing `openai-chat-to-anthropic.ts` is the reference — read it fully before coding.

- [ ] **Step 2: Write failing tests**

Append (these feed captured kimi SSE bytes through the stream and assert the produced Codex events):

```ts
import { createOpenAIChatToOpenAIResponsesStream } from "../../../src/proxy/transform/streaming/openai-chat-to-openai-responses.js";
import { readFileSync } from "node:fs";

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
const ctx = { endpoint: "/v1/responses", clientFormat: "openai_responses", targetFormat: "openai_chat", profile: {} as any, preset: {} as any, stream: true } as any;

describe("openAIChatToOpenAIResponsesStream", () => {
  test("text deltas emit created→added→delta→done→completed", async () => {
    const chunks = sseBytes([
      { id: "c1", model: "kimi", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] },
      { id: "c1", model: "kimi", choices: [{ index: 0, delta: { content: " world" }, finish_reason: "stop" }] },
    ]);
    const events = await drain(createOpenAIChatToOpenAIResponsesStream(chunks, ctx));
    const types = events.map((e) => e.replace(/^event: |\ndata:.*$/g, "").trim ? e : e).map((raw) => {
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
    const events = await drain(createOpenAIChatToOpenAIResponsesStream(chunks, ctx));
    const joined = events.join("\n");
    expect(joined).toContain('"call_id":"call_9"');
    expect(joined).toContain("response.function_call_arguments.delta");
    expect(joined).toContain('{"cmd":"ls"}');          // in arguments.done
    expect(joined).toContain("response.completed");
  });

  test("regression: real kimi fixture parses without throwing", async () => {
    const raw = readFileSync(join(fixtureDir, "kimi-chat-stream.txt"), "utf-8");
    const stream = createOpenAIChatToOpenAIResponsesStream(new TextEncoder().encode(raw), ctx);
    const events = await drain(stream);
    expect(events.some((e) => e.includes("response.completed"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run — verify fail**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: streaming tests FAIL (module not found).

- [ ] **Step 4: Implement the streaming transformer**

Create `packages/cli/src/proxy/transform/streaming/openai-chat-to-openai-responses.ts`:

```ts
import type { TransformContext } from "../types.js";
import type { SSEEvent } from "../utils.js";
import { SSEStreamTransformer, createSSETransformStream } from "./base.js";
import { registerTransformer } from "../index.js";
import { openaiResponsesToOpenAIChatRequest } from "../request/openai-responses-to-openai-chat.js";
import { openAIChatToOpenAIResponsesResponse } from "../response/openai-chat-to-openai-responses.js";

interface ToolState {
  outputIndex: number;
  itemId: string;        // fc_<chatIndex>
  callId: string;        // kimi tool_call.id, passed through verbatim
  name: string;
  argsBuf: string;
  announced: boolean;
}

/** Chat Completions SSE → OpenAI Responses SSE for Codex. */
export class OpenAIChatToOpenAIResponsesStreamTransformer extends SSEStreamTransformer {
  private responseId = "";
  private model = "";
  private created = false;
  private textOutputIndex = -1;
  private textStarted = false;
  private textBuf = "";
  private tools = new Map<number, ToolState>();
  private nextOutputIndex = 0;
  private usage: Record<string, number> | null = null;

  protected convertEvent(event: SSEEvent): SSEEvent[] | null {
    if (event.data === "[DONE]") return null;
    const data = event.data as Record<string, any>;
    const choices = data.choices as Array<Record<string, any>> | undefined;
    if (data.id) this.responseId = `resp_${data.id}`;
    if (data.model) this.model = data.model;
    if (data.usage) this.usage = data.usage;

    const out: SSEEvent[] = [];
    if (!this.created) {
      this.created = true;
      out.push({ event: "response.created", data: { type: "response.created", response: this.responseShell("in_progress") } });
    }

    const choice = choices?.[0];
    const delta = choice?.delta as Record<string, any> | undefined;
    if (delta?.content && typeof delta.content === "string") {
      out.push(...this.handleText(delta.content));
    }
    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) out.push(...this.handleTool(tc));
    }

    const finish = choice?.finish_reason;
    if (finish) {
      out.push(...this.finish());
    }
    return out;
  }

  private responseShell(status: string): Record<string, unknown> {
    return { id: this.responseId, object: "response", status, model: this.model, output: [] };
  }

  private handleText(text: string): SSEEvent[] {
    this.textBuf += text;
    const out: SSEEvent[] = [];
    if (this.textOutputIndex < 0) this.textOutputIndex = this.nextOutputIndex++;
    if (!this.textStarted) {
      this.textStarted = true;
      out.push({ event: "response.output_item.added", data: { type: "response.output_item.added", output_index: this.textOutputIndex, item: { type: "message", id: "msg_0", status: "in_progress", role: "assistant", content: [] } } });
      out.push({ event: "response.content_part.added", data: { type: "response.content_part.added", item_id: "msg_0", output_index: this.textOutputIndex, content_index: 0, part: { type: "output_text", text: "", annotations: [] } } });
    }
    out.push({ event: "response.output_text.delta", data: { type: "response.output_text.delta", item_id: "msg_0", output_index: this.textOutputIndex, content_index: 0, delta: text } });
    return out;
  }

  private handleTool(tc: Record<string, any>): SSEEvent[] {
    const idx = tc.index ?? 0;
    let st = this.tools.get(idx);
    if (!st) {
      st = { outputIndex: this.nextOutputIndex++, itemId: `fc_${idx}`, callId: tc.id ?? `call_${idx}`, name: tc.function?.name ?? "", argsBuf: "", announced: false };
      this.tools.set(idx, st);
    }
    if (tc.id) st.callId = tc.id;
    if (tc.function?.name) st.name = tc.function.name;
    const out: SSEEvent[] = [];
    if (!st.announced && st.name) {
      st.announced = true;
      out.push({ event: "response.output_item.added", data: { type: "response.output_item.added", output_index: st.outputIndex, item: { type: "function_call", id: st.itemId, call_id: st.callId, name: st.name, arguments: "", status: "in_progress" } } });
    }
    if (tc.function?.arguments) {
      st.argsBuf += tc.function.arguments;
      if (st.announced) {
        out.push({ event: "response.function_call_arguments.delta", data: { type: "response.function_call_arguments.delta", item_id: st.itemId, output_index: st.outputIndex, delta: tc.function.arguments } });
      }
    }
    return out;
  }

  private finish(): SSEEvent[] {
    const out: SSEEvent[] = [];
    if (this.textStarted) {
      out.push({ event: "response.output_text.done", data: { type: "response.output_text.done", item_id: "msg_0", output_index: this.textOutputIndex, content_index: 0, text: this.textBuf } });
      out.push({ event: "response.content_part.done", data: { type: "response.content_part.done", item_id: "msg_0", output_index: this.textOutputIndex, content_index: 0, part: { type: "output_text", text: this.textBuf, annotations: [] } } });
      out.push({ event: "response.output_item.done", data: { type: "response.output_item.done", output_index: this.textOutputIndex, item: { type: "message", id: "msg_0", status: "completed", role: "assistant", content: [{ type: "output_text", text: this.textBuf, annotations: [] }] } } });
    }
    for (const st of this.tools.values()) {
      if (!st.announced) continue;
      out.push({ event: "response.function_call_arguments.done", data: { type: "response.function_call_arguments.done", item_id: st.itemId, output_index: st.outputIndex, arguments: st.argsBuf } });
      out.push({ event: "response.output_item.done", data: { type: "response.output_item.done", output_index: st.outputIndex, item: { type: "function_call", id: st.itemId, call_id: st.callId, name: st.name, arguments: st.argsBuf, status: "completed" } } });
    }
    const outputItems: Record<string, unknown>[] = [];
    if (this.textStarted) outputItems.push({ type: "message", id: "msg_0", status: "completed", role: "assistant", content: [{ type: "output_text", text: this.textBuf, annotations: [] }] });
    for (const st of this.tools.values()) {
      if (st.announced) outputItems.push({ type: "function_call", id: st.itemId, call_id: st.callId, name: st.name, arguments: st.argsBuf, status: "completed" });
    }
    const u = this.usage ?? {};
    out.push({
      event: "response.completed",
      data: {
        type: "response.completed",
        response: {
          id: this.responseId, object: "response", status: "completed", model: this.model, output: outputItems,
          usage: { input_tokens: u.prompt_tokens ?? 0, output_tokens: u.completion_tokens ?? 0, total_tokens: u.total_tokens ?? ((u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0)) },
        },
      },
    });
    return out;
  }
}

export function createOpenAIChatToOpenAIResponsesStream(source: ReadableStream<Uint8Array>, ctx: TransformContext): ReadableStream<Uint8Array> {
  return source.pipeThrough(createSSETransformStream(new OpenAIChatToOpenAIResponsesStreamTransformer(ctx)));
}

// Self-register the openai_responses ↔ openai_chat pair.
registerTransformer({
  clientFormat: "openai_responses",
  targetFormat: "openai_chat",
  requestTransform: openaiResponsesToOpenAIChatRequest,
  responseTransform: openAIChatToOpenAIResponsesResponse,
  streamTransform: (stream, ctx) => createOpenAIChatToOpenAIResponsesStream(stream, ctx),
});
```

- [ ] **Step 5: Wire self-registration into the handler**

In `packages/cli/src/proxy/handler.ts`, add a line next to the existing streaming import (after line 5):

```ts
import "./transform/streaming/openai-chat-to-openai-responses.js";
```

- [ ] **Step 6: Run — verify pass**

```bash
cd packages/cli && bun test tests/proxy/transform/openai-responses-bridge.test.ts
```
Expected: ALL tests pass (inference, request, response, streaming, kimi-fixture regression).

- [ ] **Step 7: Run the whole proxy test suite — verify nothing else broke**

```bash
cd packages/cli && bun test tests/proxy/
```
Expected: all green. (The anthropic-pair tests must still pass — we only added a pair, didn't change theirs. The `inferClientFormat` change only affects `/v1/responses`, which no existing test asserts as `anthropic_responses`; if one does, update it to `openai_responses` with a comment.)

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/proxy/transform/streaming/openai-chat-to-openai-responses.ts packages/cli/src/proxy/handler.ts packages/cli/tests/proxy/transform/openai-responses-bridge.test.ts
git commit -m "feat(proxy): openai_chat→openai_responses streaming transformer + register pair"
```

**Phase 1 exit criterion:** a registered `openai_responses ↔ openai_chat` transformer exists, is unit-tested against captured fixtures, and is loaded by the proxy. Manually pointing Codex at the proxy (Task 7's e2e) should already work once the proxy is running with a kimi profile.

---

## Phase 2 — Integration (apply flow + end-to-end)

### Task 6: Route chat-only Codex profiles through the local proxy on apply

**Why:** With the transformer registered, the proxy can serve Codex — but only if Codex's provider `base_url` points at `http://localhost:<port>` and the proxy is running. Currently `swixter codex apply` writes kimi's real `base_url`. We add: when the active profile's **target** format is `openai_chat` (i.e. a chat-only provider that Codex can't talk to natively), rewrite the applied `base_url` to the swixter proxy and ensure the proxy process is up.

**Files:**
- Modify: `packages/cli/src/adapters/codex.ts` — `createProviderTable` (the `base_url` it writes) and add proxy-ensure call in `apply`.
- Modify: `packages/cli/src/cli/codex.ts` — `cmdApply` messaging (tell user the proxy is in use + how to run codex).

**Design decision (locked):** The proxy already supports single-profile mode via `ProxyHandler(timeoutMs, instanceId, groupName, profileName)` (`handler.ts:38`). The apply flow will start one proxy instance bound to a fixed localhost port, scoped to the active profile. Codex's provider `base_url` is set to `http://127.0.0.1:<port>/v1` with `env_key` pointed at the proxy's own auth token (`SWIXTER_PROXY_AUTH_TOKEN`) — NOT the real kimi key — because the proxy authenticates inbound requests with that token and injects the real key when forwarding.

**Sub-step A: discover proxy server entry point + port + auth token**

- [ ] Read `packages/cli/src/proxy/server.ts` and `packages/cli/src/constants/proxy.ts`. Identify: the port (fixed? env?), `SWIXTER_PROXY_AUTH_TOKEN` (how it's generated/stored), and the function that starts the server (e.g., `startProxy(port, profileName)`). Record exact signatures in a code comment on the change. (If no single-profile start helper exists, this task grows — surface it before coding rather than guessing.)

**Sub-step B: write the wiring test**

This is an integration concern; unit-test the decision function in isolation:

- [ ] Create test additions in `tests/adapters/codex.test.ts`:
  - `createProviderTable` for a chat-only provider (preset `wire_api:"chat"` / `defaultApiFormat:"openai_chat"`) yields `base_url` = proxy URL and `env_key` = the proxy auth token, when proxy-bridge mode is selected.
  - For a provider that natively supports responses (`defaultApiFormat:"openai_responses"`), `base_url` stays the real URL and no proxy bridge is used.

(Exact assertions depend on Sub-step A's findings; fill the proxy URL + token accessor names from what server.ts/constants reveal. Do not guess.)

**Sub-step C: implement**

- [ ] In `codex.ts createProviderTable`: after computing `base_url`, if `inferTargetApiFormat(profile, preset) === "openai_chat"`, override `base_url` to the proxy URL and set `providerTable.env_key` to the proxy auth token name (so Codex sends the proxy token as its bearer). Keep `requires_openai_auth` unset (already removed).
- [ ] In `apply()`: before writing config, ensure the proxy is running in single-profile mode for this profile (idempotent start — reuse existing instance if alive, e.g., pid file + health-check `GET /health`).
- [ ] In `cli/codex.ts cmdApply`: if bridged, print: "Bridged through swixter proxy (provider speaks chat-completions). Run: swixter codex run" instead of the env-var export hint.

**Sub-step D: verify**

- [ ] `bun test tests/adapters/codex.test.ts` — adapter unit tests still green (update the two `base_url` assertions from Task-set earlier to reflect proxy URL when chat-only).
- [ ] Commit:

```bash
git add -A && git commit -m "feat(codex): bridge chat-only providers through swixter proxy on apply"
```

> **Stop-gate:** If Sub-step A reveals the proxy has no single-profile start path, or the auth-token model is incompatible with per-request forwarding, STOP and re-plan Task 6 — do not bolt a half-working integration onto the transformer. The transformers (Phase 1) remain valuable and committable on their own.

---

### Task 7: End-to-end verification against real Kimi via `codex exec`

**Why:** Unit tests prove the transformer logic; only a real Codex round-trip proves the whole bridge, including the `call_id` lifecycle across a multi-turn tool loop.

**Files:** none (verification only); document the result in the commit message.

- [ ] **Step 1: Apply the kimi profile**

```bash
swixter codex apply    # should now write base_url = proxy, and start the proxy
```

- [ ] **Step 2: Run a non-tool turn**

```bash
cd <trusted git repo>
codex exec --skip-git-repo-check -c approval_policy=never -c sandbox_mode=danger-full-access "Reply with exactly: pong"
```
Expected: prints `pong`. If it prints a provider error, inspect proxy logs — the transformer is misshaping something; do NOT declare done.

- [ ] **Step 3: Run a tool-using turn (the real test)**

```bash
codex exec --skip-git-repo-check -c approval_policy=never -c sandbox_mode=danger-full-access "Create a file named /tmp/bridge-marker.txt containing 'ok', then confirm it exists"
```
Expected: Codex invokes `exec_command` (a real tool call), the proxy translates it, Kimi responds with a tool_call, Codex executes and sends `function_call_output` back, the loop completes, file is created. If the loop hangs or errors after the first tool call, the `call_id` mapping is broken — re-check `handleTool`/`finish`.

- [ ] **Step 4: Run the full test suite once more**

```bash
cd packages/cli && bun test
```
Expected: all green.

- [ ] **Step 5: Commit verification note**

```bash
git commit --allow-empty -m "chore: verify codex↔kimi bridge end-to-end (text + tool turn)"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Codex request shape (captured) → Task 3 ✓
- Codex accepted response sequence (validated) → Tasks 4 & 5 ✓
- `inferClientFormat` bug → Task 2 ✓
- tool-call / call_id lifecycle → Task 5 (handleTool/finish) + Task 7 Step 3 ✓
- apply-flow wiring → Task 6 ✓
- end-to-end → Task 7 ✓

**Placeholder scan:** Task 6 Sub-steps intentionally defer exact symbol names to a read of `server.ts`/`constants/proxy.ts` rather than invent them — this is a *read-then-fill* gate, not a TBD; the stop-gate explicitly forbids guessing. No other TODO/TBD/"add error handling"/"similar to" present. Every code step contains full code.

**Type/name consistency:** transformer exported names are consistent across tasks: `openaiResponsesToOpenAIChatRequest` (Task 3), `openAIChatToOpenAIResponsesResponse` (Task 4), `createOpenAIChatToOpenAIResponsesStream` + `OpenAIChatToOpenAIResponsesStreamTransformer` (Task 5). `ApiFormat` literal `"openai_responses"` used consistently. `ToolState.itemId`/`callId` used consistently within Task 5.

**Risk note carried into the plan:** Task 6's integration may surface that the proxy's single-profile/auth model needs work; the stop-gate keeps Phase 1 independently shippable.
