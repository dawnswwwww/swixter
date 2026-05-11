/**
 * Lightweight HTTP Router
 * Pattern-based routing with method support
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { MiddlewareFunction } from "./middleware.js";
import { sendError, notFoundHandler } from "./middleware.js";

/**
 * Route parameter extraction
 * Extracts :params from URL patterns
 */
export function extractParams(pattern: string, path: string): Record<string, string> | null {
  // Normalize: remove trailing slashes and split
  const patternParts = pattern.replace(/\/$/, "").split("/").filter(Boolean);
  const pathParts = path.replace(/\/$/, "").split("/").filter(Boolean);

  if (patternParts.length !== pathParts.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith(":")) {
      const paramName = patternPart.slice(1);
      params[paramName] = pathPart;
    } else if (patternPart !== pathPart) {
      return null;
    }
  }

  return params;
}

/**
 * Route handler type
 */
export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Record<string, string>
) => void | Promise<void>;

/**
 * Route definition
 */
interface Route {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

/**
 * Router class
 */
export class Router {
  private routes: Route[] = [];
  private middleware: MiddlewareFunction[] = [];

  /**
   * Add middleware
   */
  use(middleware: MiddlewareFunction): void {
    this.middleware.push(middleware);
  }

  /**
   * Add GET route
   */
  get(pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: "GET", pattern, handler });
  }

  /**
   * Add POST route
   */
  post(pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: "POST", pattern, handler });
  }

  /**
   * Add PUT route
   */
  put(pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: "PUT", pattern, handler });
  }

  /**
   * Add DELETE route
   */
  delete(pattern: string, handler: RouteHandler): void {
    this.routes.push({ method: "DELETE", pattern, handler });
  }

  /**
   * Match request to route
   */
  private matchRoute(req: IncomingMessage): { route: Route; params: Record<string, string> } | null {
    const method = (req.method || "GET").toUpperCase();
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    const path = url.pathname;

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const params = extractParams(route.pattern, path);
      if (params !== null) {
        return { route, params };
      }
    }

    return null;
  }

  /**
   * Handle request
   */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Run middleware first
    let middlewareIndex = 0;

    const runMiddleware = (error?: Error): void => {
      if (error) {
        this.finalize(req, res, error);
        return;
      }

      if (middlewareIndex < this.middleware.length) {
        const middleware = this.middleware[middlewareIndex++];
        Promise.resolve(middleware(req, res, runMiddleware)).catch(runMiddleware);
        return;
      }

      // After middleware, match and execute route
      this.executeRoute(req, res).catch((error) => {
        this.finalize(req, res, error);
      });
    };

    runMiddleware();
  }

  /**
   * Execute matched route
   */
  private async executeRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const match = this.matchRoute(req);

    if (!match) {
      notFoundHandler(req, res);
      return;
    }

    const { route, params } = match;
    await route.handler(req, res, params);
  }

  /**
   * Finalize response (handle errors)
   */
  private finalize(req: IncomingMessage, res: ServerResponse, error?: Error): void {
    if (error) {
      sendError(res, error, 500);
      return;
    }

    // If response not ended and no route matched
    if (!res.writableEnded) {
      notFoundHandler(req, res);
    }
  }
}
