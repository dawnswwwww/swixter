import type { TransformContext } from "../types.js";
import { parseSSEEvents, serializeSSEEvent, type SSEEvent } from "../utils.js";

/**
 * Base class for SSE stream transformers.
 *
 * Handles:
 * - Partial chunk buffering (SSE events may span multiple TCP chunks)
 * - UTF-8 safe decoding
 * - Event-by-event processing via abstract methods
 */
export abstract class SSEStreamTransformer {
  protected ctx: TransformContext;
  protected encoder = new TextEncoder();
  protected decoder = new TextDecoder("utf-8", { fatal: false });

  // Buffer for incomplete SSE data across chunks
  private buffer = "";

  constructor(ctx: TransformContext) {
    this.ctx = ctx;
  }

  /**
   * Transform a chunk of bytes from the upstream stream.
   * Returns the converted bytes to send to the client.
   */
  transformChunk(chunk: Uint8Array): Uint8Array {
    const text = this.decoder.decode(chunk, { stream: true });
    this.buffer += text;

    // Find the last complete double-newline
    const lastDoubleNewline = this.buffer.lastIndexOf("\n\n");
    if (lastDoubleNewline === -1) {
      return new Uint8Array(0);
    }

    const completeText = this.buffer.slice(0, lastDoubleNewline + 2);
    this.buffer = this.buffer.slice(lastDoubleNewline + 2);

    const events = parseSSEEvents(completeText);
    const outputEvents: SSEEvent[] = [];

    for (const event of events) {
      const converted = this.convertEvent(event);
      if (converted) {
        if (Array.isArray(converted)) {
          outputEvents.push(...converted);
        } else {
          outputEvents.push(converted);
        }
      }
    }

    if (outputEvents.length === 0) {
      return new Uint8Array(0);
    }

    const outputText = outputEvents
      .map((e) => serializeSSEEvent(e.event, e.data))
      .join("");

    return this.encoder.encode(outputText);
  }

  /**
   * Flush any remaining buffered data.
   * Called when the upstream stream ends.
   */
  flush(): Uint8Array {
    if (this.buffer.trim().length > 0) {
      const events = parseSSEEvents(this.buffer + "\n\n");
      const outputEvents: SSEEvent[] = [];

      for (const event of events) {
        const converted = this.convertEvent(event);
        if (converted) {
          if (Array.isArray(converted)) {
            outputEvents.push(...converted);
          } else {
            outputEvents.push(converted);
          }
        }
      }

      this.buffer = "";

      if (outputEvents.length > 0) {
        const outputText = outputEvents
          .map((e) => serializeSSEEvent(e.event, e.data))
          .join("");
        return this.encoder.encode(outputText);
      }
    }

    return new Uint8Array(0);
  }

  /**
   * Convert a single upstream SSE event to one or more client SSE events.
   * Return null to drop the event.
   */
  protected abstract convertEvent(event: SSEEvent): SSEEvent | SSEEvent[] | null;
}

/**
 * Create a TransformStream that wraps an SSEStreamTransformer.
 */
export function createSSETransformStream(
  transformer: SSEStreamTransformer
): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform(chunk, controller) {
      const output = transformer.transformChunk(chunk);
      if (output.length > 0) {
        controller.enqueue(output);
      }
    },
    flush(controller) {
      const output = transformer.flush();
      if (output.length > 0) {
        controller.enqueue(output);
      }
    },
  });
}
