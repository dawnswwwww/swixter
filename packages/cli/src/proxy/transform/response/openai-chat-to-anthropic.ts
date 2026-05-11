import type { TransformContext } from "../types.js";
import { convertOpenAIToolCallsToAnthropic } from "../utils.js";

export function openAIChatToAnthropicResponse(
  body: unknown,
  _ctx: TransformContext
): unknown {
  const openai = body as Record<string, unknown>;
  const choices = openai.choices as Array<Record<string, unknown>> | undefined;

  if (!choices || choices.length === 0) {
    return body;
  }

  const choice = choices[0];
  const message = choice.message as Record<string, unknown> | undefined;

  if (!message) {
    return body;
  }

  const content: Array<Record<string, unknown>> = [];

  if (message.reasoning_content) {
    content.push({
      type: "thinking",
      thinking: message.reasoning_content,
    });
  }

  if (message.tool_calls) {
    const toolCalls = message.tool_calls as Array<Record<string, unknown>>;
    content.push(...convertOpenAIToolCallsToAnthropic(toolCalls));
  }

  if (message.content && message.content !== null) {
    const textContent = message.content as string;
    if (textContent.length > 0) {
      content.push({ type: "text", text: textContent });
    }
  }

  const usage = openai.usage as Record<string, number> | undefined;
  const anthropicUsage: Record<string, number> = {};
  if (usage) {
    anthropicUsage.input_tokens = usage.prompt_tokens || 0;
    anthropicUsage.output_tokens = usage.completion_tokens || 0;
    if (usage.prompt_tokens_details) {
      const details = usage.prompt_tokens_details as Record<string, number>;
      if (details.cached_tokens) {
        anthropicUsage.cache_read_input_tokens = details.cached_tokens;
      }
    }
  }

  return {
    id: openai.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: openai.model || "unknown",
    content,
    stop_reason: mapFinishReason(choice.finish_reason as string | null),
    stop_sequence: null,
    usage: anthropicUsage,
  };
}

function mapFinishReason(finishReason: string | null): string | null {
  if (!finishReason) return null;
  switch (finishReason) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "function_call":
      return "tool_use";
    case "content_filter":
      return "end_turn";
    default:
      return finishReason;
  }
}
