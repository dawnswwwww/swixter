// src/proxy/handler.ts
import type { ClaudeCodeProfile } from "../types.js";
import { SWIXTER_PROXY_AUTH_TOKEN } from "../constants/proxy.js";
// Load transformer registrations (side-effect: populates TRANSFORMER_REGISTRY)
import "./transform/streaming/openai-chat-to-anthropic.js";
import {
  getGeneralProxyModel,
  isSwixterClaudeProxyMarker,
  resolveSwixterClaudeProxyMarker,
} from "../utils/model-helper.js";
import { ProxyRouter } from "./router.js";
import { ProxyForwarder } from "./forwarder.js";
import { CircuitBreaker } from "./circuit-breaker.js";
import { getGroup, getActiveGroup } from "../groups/manager.js";
import { getProfile } from "../config/manager.js";
import { createProxyLogger, type ProxyLogger } from "./logger.js";
import { getPresetById } from "../providers/presets.js";
import {
  inferClientFormat,
  inferTargetApiFormat,
  getTransformer,
  transformRequest,
  transformResponse,
  transformStream,
} from "./transform/index.js";
import type { TransformContext } from "./transform/types.js";

export class ProxyHandler {
  private router: ProxyRouter;
  private forwarder: ProxyForwarder;
  private circuitBreaker: CircuitBreaker;
  private timeoutMs?: number;
  private instanceId: string;
  private groupName?: string;
  private profileName?: string;
  private logger: ProxyLogger;

  constructor(timeoutMs?: number, instanceId?: string, groupName?: string, profileName?: string) {
    this.router = new ProxyRouter();
    this.forwarder = new ProxyForwarder();
    this.circuitBreaker = new CircuitBreaker();
    this.timeoutMs = timeoutMs;
    this.instanceId = instanceId || "default";
    this.groupName = groupName;
    this.profileName = profileName;
    this.logger = createProxyLogger(this.instanceId);
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // OpenAI Chat format
    this.router.register("/v1/chat/completions", this.handleChatCompletions.bind(this));

    // Anthropic Messages format
    this.router.register("/v1/messages", this.handleMessages.bind(this));

    // Anthropic Responses format
    this.router.register("/v1/responses", this.handleResponses.bind(this));

    // Anthropic compatible
    this.router.register("/anthropic/*", this.handleAnthropic.bind(this));

    // Health check
    this.router.register("/health", this.handleHealth.bind(this));
  }

  async handleRequest(request: Request): Promise<Response> {
    const start = Date.now();
    this.logger.info("Incoming request", { method: request.method, path: new URL(request.url).pathname });

    try {
      const authResponse = this.authenticateProxyRequest(request);
      if (authResponse) {
        this.logger.request(request.method, new URL(request.url).pathname, authResponse.status, Date.now() - start);
        return authResponse;
      }

      const response = await this.router.handle(request);
      this.logger.request(request.method, new URL(request.url).pathname, response.status, Date.now() - start);
      return response;
    } catch (error) {
      this.logger.error("Request handling failed", error as Error);
      this.logger.request(request.method, new URL(request.url).pathname, 500, Date.now() - start);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  private isHealthRequest(request: Request): boolean {
    return new URL(request.url).pathname === "/health";
  }

  private getBearerToken(request: Request): string | null {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return null;
    }

    return authHeader.slice("Bearer ".length);
  }

  private authenticateProxyRequest(request: Request): Response | null {
    if (this.isHealthRequest(request)) {
      return null;
    }

    const token = this.getBearerToken(request);
    if (token === SWIXTER_PROXY_AUTH_TOKEN) {
      return null;
    }

    return new Response(JSON.stringify({ error: "Invalid or missing proxy authentication" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleChatCompletions(request: Request): Promise<Response> {
    return this.forwardToProvider(request, "chat");
  }

  private async handleMessages(request: Request): Promise<Response> {
    return this.forwardToProvider(request, "anthropic");
  }

  private async handleResponses(request: Request): Promise<Response> {
    return this.forwardToProvider(request, "anthropic");
  }

  private async handleAnthropic(request: Request): Promise<Response> {
    return this.forwardToProvider(request, "anthropic");
  }

  private handleHealth(): Response {
    return new Response(JSON.stringify({
      status: "ok",
      instanceId: this.instanceId,
      groupName: this.groupName || null,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private rewriteRequestBodyForProfile(bodyBuffer: ArrayBuffer, profile: ClaudeCodeProfile): Uint8Array {
    try {
      const bodyText = Buffer.from(bodyBuffer).toString("utf-8");
      const parsed = JSON.parse(bodyText);

      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return new Uint8Array(bodyBuffer);
      }

      const currentModel = typeof parsed.model === "string" ? parsed.model : undefined;

      if (isSwixterClaudeProxyMarker(currentModel)) {
        const resolvedModel = resolveSwixterClaudeProxyMarker(currentModel, profile);
        if (resolvedModel) {
          parsed.model = resolvedModel;
          return Buffer.from(JSON.stringify(parsed));
        }
        return new Uint8Array(bodyBuffer);
      }

      const generalModel = getGeneralProxyModel(profile);
      if (generalModel) {
        parsed.model = generalModel;
        return Buffer.from(JSON.stringify(parsed));
      }

      return new Uint8Array(bodyBuffer);
    } catch (error) {
      if (error instanceof Error && error.message.includes("cannot resolve requested proxy model marker")) {
        throw error;
      }
      return new Uint8Array(bodyBuffer);
    }
  }

  private async forwardSingleProfile(request: Request, profileName: string, _format: "chat" | "anthropic"): Promise<Response> {
    const profile = await getProfile(profileName);
    if (!profile) {
      this.logger.warn("Profile not found", { profileName });
      return new Response(JSON.stringify({ error: `Profile not found: ${profileName}` }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Read body once as ArrayBuffer
    let bodyBuffer: ArrayBuffer;
    try {
      bodyBuffer = await request.arrayBuffer();
    } catch (error) {
      this.logger.error("Failed to read request body", error as Error);
      return new Response(JSON.stringify({ error: "Failed to read request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const preset = getPresetById(profile.providerId);
    const endpoint = new URL(request.url).pathname + new URL(request.url).search;
    const clientFormat = inferClientFormat(endpoint);
    const targetFormat = inferTargetApiFormat(profile, preset || {} as NonNullable<typeof preset>);

    let transformedBodyBuffer = bodyBuffer;
    let targetEndpoint = endpoint;
    let ctx: TransformContext | null = null;

    if (clientFormat !== targetFormat) {
      try {
        const bodyText = Buffer.from(bodyBuffer).toString("utf-8");
        const parsedBody = bodyText ? JSON.parse(bodyText) : {};

        ctx = {
          endpoint,
          clientFormat,
          targetFormat,
          profile,
          preset: preset || {} as NonNullable<typeof preset>,
          stream: parsedBody.stream === true,
        };

        const transformed = transformRequest(parsedBody, ctx);
        transformedBodyBuffer = Buffer.from(JSON.stringify(transformed.body));
        targetEndpoint = transformed.targetEndpoint || endpoint;
      } catch (error) {
        this.logger.error("Request transform failed, falling back to passthrough", error as Error);
        // Fall back to passthrough — keep original body and endpoint
      }
    }

    const rewrittenBody = this.rewriteRequestBodyForProfile(transformedBodyBuffer, profile);
    const clonedRequest = {
      method: request.method,
      path: targetEndpoint,
      headers: Object.fromEntries(request.headers.entries()),
      body: rewrittenBody,
    };

    try {
      const forwardResponse = await this.forwarder.forward(clonedRequest, profile, this.timeoutMs);
      const isSuccess = forwardResponse.status >= 200 && forwardResponse.status < 300;

      if (!isSuccess) {
        this.logger.warn("Provider returned upstream status", {
          profileName,
          status: forwardResponse.status,
        });
        return new Response(forwardResponse.body, {
          status: forwardResponse.status,
          headers: forwardResponse.headers,
        });
      }

      // Transform response back to client format
      if (ctx && clientFormat !== targetFormat) {
        if (forwardResponse.isStream && forwardResponse.body) {
          const transformedStream = transformStream(forwardResponse.body as ReadableStream<Uint8Array>, ctx);
          return new Response(transformedStream, {
            status: forwardResponse.status,
            headers: forwardResponse.headers,
          });
        }

        try {
          const responseText = forwardResponse.body as string;
          const responseParsed = responseText ? JSON.parse(responseText) : {};
          const transformedResponse = transformResponse(responseParsed, ctx);
          return new Response(JSON.stringify(transformedResponse), {
            status: forwardResponse.status,
            headers: forwardResponse.headers,
          });
        } catch (error) {
          this.logger.error("Response transform failed, returning raw response", error as Error);
          return new Response(forwardResponse.body, {
            status: forwardResponse.status,
            headers: forwardResponse.headers,
          });
        }
      }

      // No transform needed — return directly
      if (forwardResponse.isStream) {
        return new Response(forwardResponse.body as ReadableStream, {
          status: forwardResponse.status,
          headers: forwardResponse.headers,
        });
      }

      return new Response(forwardResponse.body, {
        status: forwardResponse.status,
        headers: forwardResponse.headers,
      });
    } catch (error) {
      this.logger.error("Provider request failed", error as Error, { profileName });
      return new Response(JSON.stringify({ error: (error as Error).message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  private async forwardToProvider(request: Request, format: "chat" | "anthropic"): Promise<Response> {
    if (this.profileName) {
      return this.forwardSingleProfile(request, this.profileName, format);
    }

    const group = this.groupName
      ? await getGroup(this.groupName)
      : await getActiveGroup();

    if (!group || group.profiles.length === 0) {
      this.logger.warn("No active group or profiles");
      return new Response(JSON.stringify({ error: "No active group or profiles" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Read body once as ArrayBuffer for multiple provider attempts
    let bodyBuffer: ArrayBuffer;
    try {
      bodyBuffer = await request.arrayBuffer();
    } catch (error) {
      this.logger.error("Failed to read request body", error as Error);
      return new Response(JSON.stringify({ error: "Failed to read request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const errors: string[] = [];
    let lastFailureResponse: Response | null = null;

    for (const profileId of group.profiles) {
      if (!this.circuitBreaker.isAvailable(profileId)) {
        this.logger.info("Skipping unavailable provider", { profileId });
        continue;
      }

      const profile = await getProfile(profileId);
      if (!profile) {
        this.logger.warn("Profile not found", { profileId });
        continue;
      }

      const preset = getPresetById(profile.providerId);

      const endpoint = new URL(request.url).pathname + new URL(request.url).search;
      const clientFormat = inferClientFormat(endpoint);
      const targetFormat = inferTargetApiFormat(profile, preset || {} as NonNullable<typeof preset>);

      // Skip provider if formats don't match and no transformer is available
      if (clientFormat !== targetFormat) {
        if (!getTransformer(clientFormat, targetFormat)) {
          this.logger.info("Skipping provider: no transformer for format pair", { profileId, clientFormat, targetFormat });
          continue;
        }
      }

      let transformedBodyBuffer = bodyBuffer;
      let targetEndpoint = endpoint;
      let ctx: TransformContext | null = null;

      if (clientFormat !== targetFormat) {
        try {
          const bodyText = Buffer.from(bodyBuffer).toString("utf-8");
          const parsedBody = bodyText ? JSON.parse(bodyText) : {};

          ctx = {
            endpoint,
            clientFormat,
            targetFormat,
            profile,
            preset: preset || {} as NonNullable<typeof preset>,
            stream: parsedBody.stream === true,
          };

          const transformed = transformRequest(parsedBody, ctx);
          transformedBodyBuffer = Buffer.from(JSON.stringify(transformed.body));
          targetEndpoint = transformed.targetEndpoint || endpoint;
        } catch (error) {
          this.logger.error("Request transform failed, falling back to passthrough", error as Error);
          // Fall back to passthrough — keep original body and endpoint
        }
      }

      try {
        const rewrittenBody = this.rewriteRequestBodyForProfile(transformedBodyBuffer, profile);
        const clonedRequest = {
          method: request.method,
          path: targetEndpoint,
          headers: Object.fromEntries(request.headers.entries()),
          body: rewrittenBody,
        };

        const forwardResponse = await this.forwarder.forward(clonedRequest, profile, this.timeoutMs);
        const isSuccess = forwardResponse.status >= 200 && forwardResponse.status < 300;
        const shouldTripCircuit = forwardResponse.status >= 500 || forwardResponse.status === 429;

        if (!isSuccess) {
          if (shouldTripCircuit) {
            this.circuitBreaker.recordFailure(profileId);
          }

          errors.push(`${profileId}: upstream returned ${forwardResponse.status}`);
          this.logger.warn("Provider returned upstream status", {
            profileId,
            status: forwardResponse.status,
            fallback: true,
          });

          lastFailureResponse = new Response(forwardResponse.body, {
            status: forwardResponse.status,
            headers: forwardResponse.headers,
          });
          continue;
        }

        this.circuitBreaker.recordSuccess(profileId);

        // Transform response back to client format if needed
        if (ctx && clientFormat !== targetFormat) {
          if (forwardResponse.isStream && forwardResponse.body) {
            const transformedStream = transformStream(forwardResponse.body as ReadableStream<Uint8Array>, ctx);
            return new Response(transformedStream, {
              status: forwardResponse.status,
              headers: forwardResponse.headers,
            });
          }

          try {
            const responseText = forwardResponse.body as string;
            const responseParsed = responseText ? JSON.parse(responseText) : {};
            const transformedResponse = transformResponse(responseParsed, ctx);
            return new Response(JSON.stringify(transformedResponse), {
              status: forwardResponse.status,
              headers: forwardResponse.headers,
            });
          } catch (error) {
            this.logger.error("Response transform failed, returning raw response", error as Error);
            return new Response(forwardResponse.body, {
              status: forwardResponse.status,
              headers: forwardResponse.headers,
            });
          }
        }

        // Return streaming response directly
        if (forwardResponse.isStream) {
          return new Response(forwardResponse.body as ReadableStream, {
            status: forwardResponse.status,
            headers: forwardResponse.headers,
          });
        }

        return new Response(forwardResponse.body, {
          status: forwardResponse.status,
          headers: forwardResponse.headers,
        });
      } catch (error) {
        this.circuitBreaker.recordFailure(profileId);
        errors.push(`${profileId}: ${(error as Error).message}`);
        this.logger.error("Provider request failed", error as Error, { profileId });
        continue;
      }
    }

    this.logger.error("All providers failed", undefined, { errors });
    if (lastFailureResponse) {
      return lastFailureResponse;
    }
    return new Response(JSON.stringify({ error: "All providers failed", details: errors }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  getCircuitBreaker(): CircuitBreaker {
    return this.circuitBreaker;
  }
}
