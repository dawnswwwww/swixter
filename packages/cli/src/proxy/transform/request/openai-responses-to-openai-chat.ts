import type { TransformContext, TransformedRequest } from "../types.js";

/**
 * Tool name validation: must start with a letter, contain only letters,
 * digits, underscores, and dashes, be 1-64 characters, AND must not
 * contain consecutive underscores (e.g. `mcp__node_repl`). The consecutive-
 * underscore rule was discovered empirically — kimi and some other openai-
 * compatible upstreams reject names with `__` even though base character
 * validation would allow them. Tools with invalid names are filtered out
 * of the request so the upstream accepts the rest.
 */
const TOOL_NAME_RE = /^(?!.*__)[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;

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
  } else if (typeof r.input === "string" && r.input.length > 0) {
    // Responses API allows a bare string as shorthand for one user message.
    messages.push({ role: "user", content: r.input });
  }
  chatBody.messages = messages;

  if (r.max_output_tokens !== undefined) chatBody.max_tokens = r.max_output_tokens;
  if (r.temperature !== undefined) chatBody.temperature = r.temperature;
  if (r.top_p !== undefined) chatBody.top_p = r.top_p;
  if (r.stream !== undefined) chatBody.stream = r.stream;
  if (r.parallel_tool_calls !== undefined) chatBody.parallel_tool_calls = r.parallel_tool_calls;

  if (Array.isArray(r.tools)) {
    // Filter out tools whose names don't match the openai-compatible upstream's
    // function name rules. Codex emits MCP tool names like `mcp__node_repl` (double
    // underscore) or names with `null` that upstreams like kimi reject. These
    // tools won't be callable through the bridge, but the rest + chat work.
    chatBody.tools = r.tools
      .filter((t: Record<string, unknown>) => {
        const name = t.name;
        if (typeof name !== "string" || name.length === 0) return false;
        return TOOL_NAME_RE.test(name);
      })
      .map((t: Record<string, unknown>) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          // Codex emits some tools (e.g. freeform/custom ones) without a
          // parameters schema; upstreams like MiniMax reject empty params,
          // so default to a permissive empty object schema.
          parameters:
            t.parameters && typeof t.parameters === "object"
              ? t.parameters
              : { type: "object", properties: {} },
        },
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
  // Collapse a single text part to a bare string — matches Codex's single-part
  // message convention and keeps round-trip chat bodies clean.
  if (parts.length === 1 && parts[0].type === "text") {
    return parts[0].text;
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
