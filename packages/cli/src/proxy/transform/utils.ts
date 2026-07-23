/** Parsed SSE event */
export interface SSEEvent {
  event: string;
  data: unknown;
}

/**
 * Parse SSE text chunks into structured events.
 * Handles partial chunks gracefully — incomplete events are discarded.
 *
 * Per the SSE spec, the colon may be followed by an optional single space,
 * i.e. both `data: {...}` and `data:{...}` are valid field lines. Some
 * providers (e.g. kimi) emit `data:` without the space, so we strip one
 * leading space if present after the colon.
 */
export function parseSSEEvents(chunk: string): SSEEvent[] {
  const events: SSEEvent[] = [];
  const lines = chunk.split("\n");

  let currentEvent = "";
  let currentDataLines: string[] = [];

  function flushEvent(): void {
    if (currentDataLines.length > 0) {
      const dataStr = currentDataLines.join("\n");
      // kimi (and others) terminate streams with the literal `data: [DONE]`,
      // which is not JSON — preserve it as a raw string sentinel.
      if (dataStr === "[DONE]") {
        events.push({ event: currentEvent, data: "[DONE]" });
      } else {
        try {
          const data = JSON.parse(dataStr);
          events.push({ event: currentEvent, data });
        } catch {
          // Incomplete JSON — discard this event
        }
      }
    }
    currentEvent = "";
    currentDataLines = [];
  }

  for (const line of lines) {
    if (line.startsWith("event:")) {
      currentEvent = line.slice("event:".length).replace(/^ /, "");
    } else if (line.startsWith("data:")) {
      currentDataLines.push(line.slice("data:".length).replace(/^ /, ""));
    } else if (line === "") {
      flushEvent();
    }
  }

  return events;
}

/**
 * Serialize a structured event into SSE wire format.
 */
export function serializeSSEEvent(eventName: string, data: unknown): string {
  const dataStr = typeof data === "string" ? data : JSON.stringify(data);
  if (eventName) {
    return `event: ${eventName}\ndata: ${dataStr}\n\n`;
  }
  return `data: ${dataStr}\n\n`;
}

/**
 * Extract content blocks from Anthropic message content.
 */
export function extractContentBlocks(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content as Array<Record<string, unknown>>;
  }
  return [];
}

/**
 * Convert Anthropic image block to OpenAI Chat Completions image_url format.
 */
export function convertAnthropicImageToOpenAI(
  imageBlock: Record<string, unknown>
): Record<string, unknown> {
  const source = imageBlock.source as Record<string, string> | undefined;
  if (!source) {
    return { type: "image_url", image_url: { url: "" } };
  }
  const mediaType = source.media_type || "image/png";
  const data = source.data || "";
  return {
    type: "image_url",
    image_url: {
      url: `data:${mediaType};base64,${data}`,
    },
  };
}

/**
 * Convert OpenAI tool_calls to Anthropic tool_use blocks.
 */
export function convertOpenAIToolCallsToAnthropic(
  toolCalls: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return toolCalls.map((tc) => {
    const func = tc.function as Record<string, string> | undefined;
    return {
      type: "tool_use",
      id: tc.id,
      name: func?.name || "",
      input: func?.arguments ? JSON.parse(func.arguments) : {},
    };
  });
}

/**
 * Convert Anthropic tool_use blocks to OpenAI tool_calls.
 */
export function convertAnthropicToolUseToOpenAI(
  toolUses: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  return toolUses.map((tu) => ({
    id: tu.id,
    type: "function",
    function: {
      name: tu.name,
      arguments: JSON.stringify(tu.input || {}),
    },
  }));
}

/**
 * Merge multiple system text blocks into a single string.
 */
export function mergeSystemBlocks(system: unknown): string {
  if (typeof system === "string") {
    return system;
  }
  if (Array.isArray(system)) {
    return system
      .filter((s) => (s as Record<string, unknown>).type === "text")
      .map((s) => (s as Record<string, unknown>).text)
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
