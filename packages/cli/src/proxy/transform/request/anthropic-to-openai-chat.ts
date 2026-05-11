import type { TransformContext, TransformedRequest } from "../types.js";
import {
  convertAnthropicImageToOpenAI,
  convertAnthropicToolUseToOpenAI,
  mergeSystemBlocks,
} from "../utils.js";
import { registerTransformer } from "../index.js";

export function anthropicToOpenAIChatRequest(
  body: unknown,
  _ctx: TransformContext
): TransformedRequest {
  const anthropic = body as Record<string, unknown>;
  const openaiBody: Record<string, unknown> = {
    model: anthropic.model,
    messages: convertMessages(anthropic.messages as Array<Record<string, unknown>> | undefined),
  };

  if (anthropic.system !== undefined) {
    const systemText = mergeSystemBlocks(anthropic.system);
    if (systemText) {
      const messages = openaiBody.messages as Array<Record<string, unknown>>;
      messages.unshift({ role: "system", content: systemText });
    }
  }

  if (anthropic.max_tokens !== undefined) {
    openaiBody.max_tokens = anthropic.max_tokens;
  }
  if (anthropic.temperature !== undefined) {
    openaiBody.temperature = anthropic.temperature;
  }
  if (anthropic.top_p !== undefined) {
    openaiBody.top_p = anthropic.top_p;
  }
  if (anthropic.stream !== undefined) {
    openaiBody.stream = anthropic.stream;
  }
  if (anthropic.stop_sequences !== undefined) {
    openaiBody.stop = anthropic.stop_sequences;
  }

  if (anthropic.tools !== undefined) {
    const tools = anthropic.tools as Array<Record<string, unknown>>;
    openaiBody.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      },
    }));
  }

  if (anthropic.tool_choice !== undefined) {
    openaiBody.tool_choice = convertToolChoice(anthropic.tool_choice);
  }

  if (anthropic.thinking !== undefined) {
    const thinking = anthropic.thinking as Record<string, unknown>;
    if (thinking.budget_tokens !== undefined) {
      openaiBody.reasoning_effort = mapThinkingBudgetToEffort(Number(thinking.budget_tokens));
    }
  }

  return {
    body: openaiBody,
    targetEndpoint: "/v1/chat/completions",
  };
}

function convertMessages(
  messages: Array<Record<string, unknown>> | undefined
): Array<Record<string, unknown>> {
  if (!messages) return [];

  return messages
    .map((msg) => {
      const role = msg.role as string;
      const content = msg.content;

      if (Array.isArray(content)) {
        const convertedContent = content
          .map((block: Record<string, unknown>) => {
            switch (block.type) {
              case "text":
                return { type: "text", text: block.text };
              case "image":
                return convertAnthropicImageToOpenAI(block);
              case "tool_use":
                return null;
              case "tool_result":
                return null;
              default:
                return block;
            }
          })
          .filter(Boolean);

        const toolUses = content.filter((b: Record<string, unknown>) => b.type === "tool_use");
        if (toolUses.length > 0 && role === "assistant") {
          return {
            role: "assistant",
            content: convertedContent.length > 0 ? convertedContent : null,
            tool_calls: convertAnthropicToolUseToOpenAI(toolUses),
          };
        }

        const toolResults = content.filter((b: Record<string, unknown>) => b.type === "tool_result");
        if (toolResults.length > 0 && role === "user") {
          return toolResults.map((tr: Record<string, unknown>) => ({
            role: "tool",
            tool_call_id: tr.tool_use_id,
            content: typeof tr.content === "string" ? tr.content : JSON.stringify(tr.content),
          }));
        }

        return { role, content: convertedContent };
      }

      return { role, content };
    })
    .flat();
}

function convertToolChoice(toolChoice: unknown): unknown {
  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "any":
        return "required";
      case "none":
        return "none";
      case "auto":
      default:
        return "auto";
    }
  }
  if (typeof toolChoice === "object" && toolChoice !== null) {
    const tc = toolChoice as Record<string, unknown>;
    if (tc.type === "tool") {
      return {
        type: "function",
        function: { name: tc.name },
      };
    }
  }
  return toolChoice;
}

function mapThinkingBudgetToEffort(budgetTokens: number): string {
  if (budgetTokens >= 32000) return "high";
  if (budgetTokens >= 16000) return "medium";
  return "low";
}

// Self-register
registerTransformer({
  clientFormat: "anthropic_messages",
  targetFormat: "openai_chat",
  requestTransform: anthropicToOpenAIChatRequest,
  responseTransform: (body) => body,
  streamTransform: (stream) => stream,
});
