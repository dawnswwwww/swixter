import type {
  ApiFormat,
  TransformContext,
  TransformerEntry,
  TransformedRequest,
} from "./types.js";
import type { ClaudeCodeProfile, ProviderPreset } from "../../types.js";

/** Global transformer registry */
const TRANSFORMER_REGISTRY: TransformerEntry[] = [];

/**
 * Register a transformer for a specific client→target format pair.
 * Called by each transformer module on load.
 */
export function registerTransformer(entry: TransformerEntry): void {
  const existingIndex = TRANSFORMER_REGISTRY.findIndex(
    (t) => t.clientFormat === entry.clientFormat && t.targetFormat === entry.targetFormat
  );
  if (existingIndex >= 0) {
    TRANSFORMER_REGISTRY.splice(existingIndex, 1);
  }
  TRANSFORMER_REGISTRY.push(entry);
}

/** Infer the client's API format from the request endpoint */
export function inferClientFormat(endpoint: string): ApiFormat {
  if (endpoint.includes("/v1/chat/completions")) {
    return "openai_chat";
  }
  if (endpoint.includes("/v1/responses")) {
    return "anthropic_responses";
  }
  if (endpoint.includes("/anthropic/") || endpoint.includes("/v1/messages")) {
    return "anthropic_messages";
  }
  return "anthropic_messages";
}

/** Infer API format from a base URL path (e.g. /anthropic → anthropic_messages) */
export function inferApiFormatFromBaseURL(baseURL: string): ApiFormat | null {
  try {
    const url = new URL(baseURL);
    const path = url.pathname.toLowerCase();
    if (path.includes("/anthropic")) return "anthropic_messages";
    if (path.includes("/responses")) return "anthropic_responses";
    if (path.includes("/openai")) return "openai_chat";
    return null;
  } catch {
    return null;
  }
}

/** Infer the target API format from profile configuration */
export function inferTargetApiFormat(
  profile: ClaudeCodeProfile,
  preset: ProviderPreset
): ApiFormat {
  // 1. User explicit override
  if (profile.apiFormat) {
    return profile.apiFormat;
  }

  // 2. Infer from baseURL path
  const baseURL = profile.baseURL || preset?.baseURL || "";
  const fromURL = inferApiFormatFromBaseURL(baseURL);
  if (fromURL) {
    return fromURL;
  }

  // 3. Preset defaultApiFormat (new field)
  if (preset?.defaultApiFormat) {
    return preset.defaultApiFormat;
  }

  // 4. Legacy wire_api fallback
  switch (preset.wire_api) {
    case "chat":
      return "openai_chat";
    case "responses":
      return "anthropic_messages";
    default:
      return "openai_chat";
  }
}

/** Look up a transformer for the given format pair */
export function getTransformer(
  clientFormat: ApiFormat,
  targetFormat: ApiFormat
): TransformerEntry | null {
  if (clientFormat === targetFormat) {
    return null;
  }
  const entry = TRANSFORMER_REGISTRY.find(
    (t) => t.clientFormat === clientFormat && t.targetFormat === targetFormat
  );
  return entry ?? null;
}

/** Transform a request body from client format to target format */
export function transformRequest(
  body: unknown,
  ctx: TransformContext
): TransformedRequest {
  const transformer = getTransformer(ctx.clientFormat, ctx.targetFormat);
  if (!transformer) {
    return { body, targetEndpoint: ctx.endpoint };
  }
  return transformer.requestTransform(body, ctx);
}

/** Transform a response body from target format back to client format */
export function transformResponse(body: unknown, ctx: TransformContext): unknown {
  const transformer = getTransformer(ctx.clientFormat, ctx.targetFormat);
  if (!transformer) {
    return body;
  }
  return transformer.responseTransform(body, ctx);
}

/** Transform a streaming response from target format back to client format */
export function transformStream(
  stream: ReadableStream<Uint8Array>,
  ctx: TransformContext
): ReadableStream<Uint8Array> {
  const transformer = getTransformer(ctx.clientFormat, ctx.targetFormat);
  if (!transformer) {
    return stream;
  }
  return transformer.streamTransform(stream, ctx);
}
