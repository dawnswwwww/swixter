import type { TransformContext } from "../types.js";
import type { SSEEvent } from "../utils.js";
import { SSEStreamTransformer, createSSETransformStream } from "./base.js";
import { registerTransformer } from "../index.js";
import { anthropicToOpenAIChatRequest } from "../request/anthropic-to-openai-chat.js";
import { openAIChatToAnthropicResponse } from "../response/openai-chat-to-anthropic.js";

export class OpenAIChatToAnthropicStreamTransformer extends SSEStreamTransformer {
  private messageId: string = "";
  private currentModel: string = "";
  private hasSentMessageStart: boolean = false;
  private contentBlockIndex: number = 0;
  private currentTextBlockIndex: number = -1;
  private currentThinkingBlockIndex: number = -1;
  private hasStartedTextBlock: boolean = false;
  private hasStartedThinkingBlock: boolean = false;
  private toolBlockIndexMap: Map<number, number> = new Map();
  private openToolBlockIndices: Set<number> = new Set();
  private pendingToolData: Map<number, { id: string; name: string; args: string }> = new Map();
  private lastEmittedArgsLength: Map<number, number> = new Map();
  private hasEmittedMessageDelta: boolean = false;

  protected convertEvent(event: SSEEvent): SSEEvent | SSEEvent[] | null {
    if (event.data === "[DONE]") {
      return null;
    }

    const data = event.data as Record<string, unknown>;
    const choices = data.choices as Array<Record<string, unknown>> | undefined;

    if (!choices || choices.length === 0) {
      return null;
    }

    const choice = choices[0]!;
    const delta = choice.delta as Record<string, unknown> | undefined;
    const finishReason = choice.finish_reason as string | null;

    if (!this.hasSentMessageStart && data.id) {
      this.messageId = data.id as string;
      this.currentModel = (data.model as string) || "unknown";
    }

    const events: SSEEvent[] = [];

    if (!this.hasSentMessageStart) {
      this.hasSentMessageStart = true;
      events.push({
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            id: this.messageId || `msg_${Date.now()}`,
            type: "message",
            role: "assistant",
            model: this.currentModel,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        },
      });
    }

    if (delta) {
      if (typeof delta.content === "string" && delta.content.length > 0) {
        const textBlockIndex = this.ensureTextBlock();
        if (!this.hasStartedTextBlock) {
          this.hasStartedTextBlock = true;
          events.push({
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: textBlockIndex,
              content_block: { type: "text" },
            },
          });
        }
        events.push({
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: textBlockIndex,
            delta: { type: "text_delta", text: delta.content },
          },
        });
      }

      if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
        const thinkingBlockIndex = this.ensureThinkingBlock();
        if (!this.hasStartedThinkingBlock) {
          this.hasStartedThinkingBlock = true;
          events.push({
            event: "content_block_start",
            data: {
              type: "content_block_start",
              index: thinkingBlockIndex,
              content_block: { type: "thinking" },
            },
          });
        }
        events.push({
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: thinkingBlockIndex,
            delta: { type: "thinking_delta", thinking: delta.reasoning_content },
          },
        });
      }

      if (delta.tool_calls) {
        const toolCalls = delta.tool_calls as Array<Record<string, unknown>>;
        for (const tc of toolCalls) {
          const toolEvents = this.handleToolCallDelta(tc);
          events.push(...toolEvents);
        }
      }
    }

    if (finishReason && !this.hasEmittedMessageDelta) {
      this.hasEmittedMessageDelta = true;

      for (const idx of this.openToolBlockIndices) {
        events.push({
          event: "content_block_stop",
          data: { type: "content_block_stop", index: idx },
        });
      }
      this.openToolBlockIndices.clear();

      if (this.currentTextBlockIndex >= 0) {
        events.push({
          event: "content_block_stop",
          data: { type: "content_block_stop", index: this.currentTextBlockIndex },
        });
        this.currentTextBlockIndex = -1;
      }

      if (this.currentThinkingBlockIndex >= 0) {
        events.push({
          event: "content_block_stop",
          data: { type: "content_block_stop", index: this.currentThinkingBlockIndex },
        });
        this.currentThinkingBlockIndex = -1;
      }

      events.push({
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: this.mapStopReason(finishReason), stop_sequence: null },
          usage: { output_tokens: 0 },
        },
      });

      events.push({
        event: "message_stop",
        data: { type: "message_stop" },
      });
    }

    return events;
  }

  private ensureTextBlock(): number {
    if (this.currentTextBlockIndex < 0) {
      this.currentTextBlockIndex = this.contentBlockIndex++;
    }
    return this.currentTextBlockIndex;
  }

  private ensureThinkingBlock(): number {
    if (this.currentThinkingBlockIndex < 0) {
      this.currentThinkingBlockIndex = this.contentBlockIndex++;
    }
    return this.currentThinkingBlockIndex;
  }

  private handleToolCallDelta(tc: Record<string, unknown>): SSEEvent[] {
    const index = tc.index as number;
    const toolIndex = this.getOrCreateToolBlockIndex(index);
    const events: SSEEvent[] = [];

    let pending = this.pendingToolData.get(index);
    if (!pending) {
      pending = { id: "", name: "", args: "" };
      this.pendingToolData.set(index, pending);
    }

    if (tc.id) pending.id = tc.id as string;
    if (tc.function) {
      const func = tc.function as Record<string, string>;
      if (func.name) pending.name = func.name;
      if (func.arguments) pending.args += func.arguments;
    }

    if (pending.id && pending.name && !this.openToolBlockIndices.has(toolIndex)) {
      this.openToolBlockIndices.add(toolIndex);
      events.push({
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: toolIndex,
          content_block: { type: "tool_use", id: pending.id, name: pending.name, input: {} },
        },
      });
    }

    if (this.openToolBlockIndices.has(toolIndex) && pending.args.length > 0) {
      const lastEmitted = this.lastEmittedArgsLength.get(index) || 0;
      if (pending.args.length > lastEmitted) {
        const newArgs = pending.args.slice(lastEmitted);
        this.lastEmittedArgsLength.set(index, pending.args.length);
        events.push({
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: toolIndex,
            delta: { type: "input_json_delta", partial_json: newArgs },
          },
        });
      }
    }

    return events;
  }

  private getOrCreateToolBlockIndex(openaiIndex: number): number {
    let idx = this.toolBlockIndexMap.get(openaiIndex);
    if (idx === undefined) {
      idx = this.contentBlockIndex++;
      this.toolBlockIndexMap.set(openaiIndex, idx);
    }
    return idx;
  }

  private mapStopReason(reason: string): string {
    switch (reason) {
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
        return reason;
    }
  }
}

export function createOpenAIChatToAnthropicStreamTransform(
  ctx: TransformContext
): TransformStream<Uint8Array, Uint8Array> {
  const transformer = new OpenAIChatToAnthropicStreamTransformer(ctx);
  return createSSETransformStream(transformer);
}

// Self-register
registerTransformer({
  clientFormat: "anthropic_messages",
  targetFormat: "openai_chat",
  requestTransform: anthropicToOpenAIChatRequest,
  responseTransform: openAIChatToAnthropicResponse,
  streamTransform: (stream, ctx) => {
    const transform = createOpenAIChatToAnthropicStreamTransform(ctx);
    return stream.pipeThrough(transform);
  },
});
