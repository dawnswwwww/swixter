// src/proxy/handler.ts
import type { ClaudeCodeProfile } from "../types.js";
import { SWIXTER_PROXY_AUTH_TOKEN } from "../constants/proxy.js";
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

export class ProxyHandler {
  private router: ProxyRouter;
  private forwarder: ProxyForwarder;
  private circuitBreaker: CircuitBreaker;
  private timeoutMs?: number;
  private instanceId: string;
  private groupName?: string;
  private logger: ProxyLogger;

  constructor(timeoutMs?: number, instanceId?: string, groupName?: string) {
    this.router = new ProxyRouter();
    this.forwarder = new ProxyForwarder();
    this.circuitBreaker = new CircuitBreaker();
    this.timeoutMs = timeoutMs;
    this.instanceId = instanceId || "default";
    this.groupName = groupName;
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

  private async forwardToProvider(request: Request, format: "chat" | "anthropic"): Promise<Response> {
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

      // wire_api filtering: chat endpoints skip responses-only providers
      if (format === "chat" && preset?.wire_api === "responses") {
        this.logger.info("Skipping responses-only provider for chat endpoint", { profileId, wire_api: preset.wire_api });
        continue;
      }

      try {
        const rewrittenBody = this.rewriteRequestBodyForProfile(bodyBuffer, profile);
        const clonedRequest = {
          method: request.method,
          path: new URL(request.url).pathname + new URL(request.url).search,
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
