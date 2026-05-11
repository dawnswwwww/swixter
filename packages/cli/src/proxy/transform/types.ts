import type { ClaudeCodeProfile, ProviderPreset } from '../../types.js'

/** Supported API formats for conversion */
export type ApiFormat =
  | 'anthropic_messages'
  | 'anthropic_responses'
  | 'openai_chat'
  | 'openai_responses'
  | 'gemini_native'

/** Conversion context passed to all transformers */
export interface TransformContext {
  /** Original request endpoint */
  endpoint: string
  /** Format the client is sending */
  clientFormat: ApiFormat
  /** Format the upstream provider expects */
  targetFormat: ApiFormat
  /** Active profile */
  profile: ClaudeCodeProfile
  /** Provider preset */
  preset: ProviderPreset
  /** Whether the request uses streaming */
  stream: boolean
}

/** Result of request transformation — body may change and endpoint may be remapped */
export interface TransformedRequest {
  /** Transformed request body — typically a JSON-serializable object or array */
  body: unknown
  /** Remapped target endpoint if conversion requires URL changes (e.g., /v1/messages → /v1/chat/completions) */
  targetEndpoint?: string
}

/** Request transformer: converts client request body to target format */
export type RequestTransformer = (
  body: unknown,
  ctx: TransformContext
) => TransformedRequest

/** Response transformer: converts provider response body back to client format */
export type ResponseTransformer = (
  body: unknown,
  ctx: TransformContext
) => unknown

/**
 * Stream transformer: converts SSE stream from provider format to client format.
 * Implementations must handle their own TextEncoder/TextDecoder logic.
 */
export type StreamTransformer = (
  sourceStream: ReadableStream<Uint8Array>,
  ctx: TransformContext
) => ReadableStream<Uint8Array>

/** Registered transformer entry */
export interface TransformerEntry {
  /** Format of the incoming client request (e.g., 'anthropic_messages') */
  clientFormat: ApiFormat
  /** Format expected by the upstream provider (e.g., 'openai_chat') */
  targetFormat: ApiFormat
  /** Converts client request body to target format */
  requestTransform: RequestTransformer
  /** Converts provider response body back to client format */
  responseTransform: ResponseTransformer
  /** Converts provider SSE stream to client format */
  streamTransform: StreamTransformer
}
