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

/** Infer the target API format from profile configuration */
export function inferTargetApiFormat(
  profile: ClaudeCodeProfile,
  preset: ProviderPreset
): ApiFormat {
  // Temporary type assertion until Task 8 adds apiFormat to ClaudeCodeProfile
  const profileWithApiFormat = profile as ClaudeCodeProfile & { apiFormat?: ApiFormat };
  if (profileWithApiFormat.apiFormat) {
    return profileWithApiFormat.apiFormat;
  }
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
