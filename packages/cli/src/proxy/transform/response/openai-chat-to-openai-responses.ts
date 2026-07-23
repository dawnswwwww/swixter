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

  const base = chat.id ? `resp_${chat.id}` : "";
  const id = base && base !== "resp_" ? base : `resp_${Date.now()}`;

  return {
    id,
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
