import type { TransformContext } from "../types.js";
import type { SSEEvent } from "../utils.js";
import { SSEStreamTransformer, createSSETransformStream } from "./base.js";
import { registerTransformer } from "../index.js";
import { openaiResponsesToOpenAIChatRequest } from "../request/openai-responses-to-openai-chat.js";
import { openAIChatToOpenAIResponsesResponse } from "../response/openai-chat-to-openai-responses.js";

interface ToolState {
  outputIndex: number;
  itemId: string; // fc_<chatIndex>
  callId: string; // kimi tool_call.id, passed through verbatim
  name: string;
  argsBuf: string;
  announced: boolean;
}

/**
 * Chat Completions SSE → OpenAI Responses SSE for Codex.
 *
 * Emits the response.created → output_item/content_part → delta → done → completed
 * lifecycle that Codex 0.137.0 expects, including function_call items keyed by
 * kimi's tool_call.id so the subsequent function_call_output round-trip matches.
 */
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
  private finished = false;

  protected convertEvent(event: SSEEvent): SSEEvent[] | null {
    if (event.data === "[DONE]") return null;
    const data = event.data as Record<string, any>;
    if (data && data.id) this.responseId = `resp_${data.id}`;
    if (data && data.model) this.model = data.model;
    if (data && data.usage) this.usage = data.usage;

    // choices may be missing (kimi sends a trailing usage-only chunk with choices:[])
    const choices = data?.choices as Array<Record<string, any>> | undefined;
    const choice = choices?.[0];
    if (!choice) return null;

    const out: SSEEvent[] = [];
    if (!this.created) {
      this.created = true;
      out.push({
        event: "response.created",
        data: { type: "response.created", response: this.responseShell("in_progress") },
      });
    }

    const delta = choice.delta as Record<string, any> | undefined;
    if (delta?.content && typeof delta.content === "string") {
      out.push(...this.handleText(delta.content));
    }
    // NOTE: delta.reasoning_content is intentionally ignored (no crash) for this
    // first cut. Mapping kimi's thinking tokens to Codex's reasoning mechanism
    // is out of scope.
    if (Array.isArray(delta?.tool_calls)) {
      for (const tc of delta.tool_calls) out.push(...this.handleTool(tc));
    }

    if (choice.finish_reason && !this.finished) {
      out.push(...this.finish(choice.finish_reason));
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
      out.push({
        event: "response.output_item.added",
        data: {
          type: "response.output_item.added",
          output_index: this.textOutputIndex,
          item: { type: "message", id: "msg_0", status: "in_progress", role: "assistant", content: [] },
        },
      });
      out.push({
        event: "response.content_part.added",
        data: {
          type: "response.content_part.added",
          item_id: "msg_0",
          output_index: this.textOutputIndex,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        },
      });
    }
    out.push({
      event: "response.output_text.delta",
      data: {
        type: "response.output_text.delta",
        item_id: "msg_0",
        output_index: this.textOutputIndex,
        content_index: 0,
        delta: text,
      },
    });
    return out;
  }

  private handleTool(tc: Record<string, any>): SSEEvent[] {
    const idx = tc.index ?? 0;
    let st = this.tools.get(idx);
    if (!st) {
      st = {
        outputIndex: this.nextOutputIndex++,
        itemId: `fc_${idx}`,
        callId: tc.id ?? `call_${idx}`,
        name: "",
        argsBuf: "",
        announced: false,
      };
      this.tools.set(idx, st);
    }
    if (tc.id) st.callId = tc.id;
    if (tc.function?.name) st.name = tc.function.name;
    const out: SSEEvent[] = [];
    if (!st.announced && st.name) {
      st.announced = true;
      out.push({
        event: "response.output_item.added",
        data: {
          type: "response.output_item.added",
          output_index: st.outputIndex,
          item: {
            type: "function_call",
            id: st.itemId,
            call_id: st.callId,
            name: st.name,
            arguments: "",
            status: "in_progress",
          },
        },
      });
    }
    if (tc.function?.arguments) {
      st.argsBuf += tc.function.arguments;
      if (st.announced) {
        out.push({
          event: "response.function_call_arguments.delta",
          data: {
            type: "response.function_call_arguments.delta",
            item_id: st.itemId,
            output_index: st.outputIndex,
            delta: tc.function.arguments,
          },
        });
      }
    }
    return out;
  }

  private finish(_finishReason: string): SSEEvent[] {
    if (this.finished) return [];
    this.finished = true;
    const out: SSEEvent[] = [];
    if (this.textStarted) {
      out.push({
        event: "response.output_text.done",
        data: {
          type: "response.output_text.done",
          item_id: "msg_0",
          output_index: this.textOutputIndex,
          content_index: 0,
          text: this.textBuf,
        },
      });
      out.push({
        event: "response.content_part.done",
        data: {
          type: "response.content_part.done",
          item_id: "msg_0",
          output_index: this.textOutputIndex,
          content_index: 0,
          part: { type: "output_text", text: this.textBuf, annotations: [] },
        },
      });
      out.push({
        event: "response.output_item.done",
        data: {
          type: "response.output_item.done",
          output_index: this.textOutputIndex,
          item: {
            type: "message",
            id: "msg_0",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: this.textBuf, annotations: [] }],
          },
        },
      });
    }
    const outputItems: Record<string, unknown>[] = [];
    if (this.textStarted) {
      outputItems.push({
        type: "message",
        id: "msg_0",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text: this.textBuf, annotations: [] }],
      });
    }
    for (const st of this.tools.values()) {
      if (!st.announced) continue;
      out.push({
        event: "response.function_call_arguments.done",
        data: {
          type: "response.function_call_arguments.done",
          item_id: st.itemId,
          output_index: st.outputIndex,
          arguments: st.argsBuf,
        },
      });
      out.push({
        event: "response.output_item.done",
        data: {
          type: "response.output_item.done",
          output_index: st.outputIndex,
          item: {
            type: "function_call",
            id: st.itemId,
            call_id: st.callId,
            name: st.name,
            arguments: st.argsBuf,
            status: "completed",
          },
        },
      });
      outputItems.push({
        type: "function_call",
        id: st.itemId,
        call_id: st.callId,
        name: st.name,
        arguments: st.argsBuf,
        status: "completed",
      });
    }
    const u = this.usage ?? {};
    const inputTokens = u.prompt_tokens ?? 0;
    const outputTokens = u.completion_tokens ?? 0;
    out.push({
      event: "response.completed",
      data: {
        type: "response.completed",
        response: {
          id: this.responseId,
          object: "response",
          status: "completed",
          model: this.model,
          output: outputItems,
          usage: {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            total_tokens: u.total_tokens ?? inputTokens + outputTokens,
          },
        },
      },
    });
    return out;
  }
}

export function createOpenAIChatToOpenAIResponsesStream(
  source: ReadableStream<Uint8Array> | Uint8Array,
  ctx: TransformContext
): ReadableStream<Uint8Array> {
  const stream: ReadableStream<Uint8Array> =
    source instanceof Uint8Array
      ? new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(source);
            controller.close();
          },
        })
      : source;
  return stream.pipeThrough(createSSETransformStream(new OpenAIChatToOpenAIResponsesStreamTransformer(ctx)));
}

// Self-register the openai_responses ↔ openai_chat pair.
registerTransformer({
  clientFormat: "openai_responses",
  targetFormat: "openai_chat",
  requestTransform: openaiResponsesToOpenAIChatRequest,
  responseTransform: openAIChatToOpenAIResponsesResponse,
  streamTransform: (stream, ctx) => createOpenAIChatToOpenAIResponsesStream(stream, ctx),
});
