// src/proxy/forwarder.ts
import type { ClaudeCodeProfile } from "../types.js";
import { getPresetByIdAsync } from "../providers/presets.js";
import type { ForwardResponse } from "./types.js";
import { proxyLogger } from "./logger.js";
import { inferTargetApiFormat } from "./transform/index.js";

export interface ForwardRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string | Uint8Array;
}

export class ProxyForwarder {
  private defaultTimeout = 3000000;

  async forward(
    request: ForwardRequest,
    profile: ClaudeCodeProfile,
    timeoutMs?: number
  ): Promise<ForwardResponse> {
    const preset = await getPresetByIdAsync(profile.providerId);
    const baseURL = profile.baseURL || preset?.baseURL || "";
    const url = `${baseURL}${request.path}`;
    const timeout = timeoutMs || this.defaultTimeout;

    // Inject upstream credential based on provider type
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(([key]) => {
        const normalizedKey = key.toLowerCase();
        return normalizedKey !== "authorization" && normalizedKey !== "x-api-key" && normalizedKey !== "content-length" && normalizedKey !== "host";
      })
    );
    const credential = profile.authToken || profile.apiKey || "";

    if (credential) {
      const targetFormat = inferTargetApiFormat(profile, preset || {} as NonNullable<typeof preset>);
      if (targetFormat === "anthropic_messages" || targetFormat === "anthropic_responses") {
        // Anthropic-style API key
        headers["x-api-key"] = credential;
      } else {
        // OpenAI-style Bearer token (also used for gemini_native via adapter)
        headers.authorization = `Bearer ${credential}`;
      }
    }

    // Remove content-length if we're resending (body may have changed)
    delete headers["content-length"];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      proxyLogger.info("Forwarding request", { url, method: request.method });

      const response = await fetch(url, {
        method: request.method,
        headers,
        body: request.body,
        signal: controller.signal,
      });

      clearTimeout(timer);

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      // Detect streaming response
      const contentType = responseHeaders["content-type"] || "";
      const isStream = contentType.includes("text/event-stream") ||
                       contentType.includes("application/x-ndjson");

      if (isStream && response.body) {
        proxyLogger.info("Streaming response detected", { contentType });
        return {
          status: response.status,
          headers: responseHeaders,
          body: response.body,
          isStream: true,
        };
      }

      const body = await response.text();

      return {
        status: response.status,
        headers: responseHeaders,
        body,
        isStream: false,
      };
    } catch (error) {
      clearTimeout(timer);
      proxyLogger.error("Forward failed", error as Error, { url });
      throw error;
    }
  }
}