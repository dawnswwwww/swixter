/**
 * HTTP Server Middleware
 * Provides CORS, JSON parsing, and error handling
 */

import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Middleware function type
 */
export type MiddlewareFunction = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: Error) => void
) => void | Promise<void>;

/**
 * CORS middleware - allows only localhost origins
 */
export function corsMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: Error) => void
): void {
  const origin = req.headers.origin;

  // Allow localhost origins only
  if (origin && (origin.startsWith("http://127.0.0.1:") || origin.startsWith("http://localhost:"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  // Handle preflight requests
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.statusCode = 204;
    res.end();
    return;
  }

  next();
}

/**
 * JSON body parsing middleware
 */
export function jsonBodyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: (error?: Error) => void
): void {
  // Only parse POST/PUT/PATCH requests with JSON content type
  if (
    !["POST", "PUT", "PATCH"].includes(req.method || "")
  ) {
    next();
    return;
  }

  const contentType = req.headers["content-type"];
  if (!contentType?.includes("application/json")) {
    next();
    return;
  }

  const chunks: Buffer[] = [];

  req.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
  });

  req.on("end", () => {
    try {
      if (chunks.length === 0) {
        next();
        return;
      }

      const body = Buffer.concat(chunks).toString("utf-8");
      (req as any).body = JSON.parse(body);
      next();
    } catch (error) {
      next(new Error("Invalid JSON body"));
    }
  });

  req.on("error", (error) => {
    next(error);
  });
}

/**
 * Error response helper
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function sendError(res: ServerResponse, error: ApiError | Error, statusCode = 400): void {
  res.setHeader("Content-Type", "application/json");

  if (error instanceof Error) {
    res.statusCode = statusCode;
    res.end(JSON.stringify({
      error: {
        code: "UNKNOWN_ERROR",
        message: error.message,
      },
    }));
    return;
  }

  res.statusCode = statusCode;
  res.end(JSON.stringify({
    error,
  }));
}

/**
 * JSON response helper
 */
export function sendJson(res: ServerResponse, data: unknown, statusCode = 200): void {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = statusCode;
  res.end(JSON.stringify(data));
}

/**
 * Not found handler
 */
export function notFoundHandler(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader("Content-Type", "application/json");
  res.statusCode = 404;
  res.end(JSON.stringify({
    error: {
      code: "NOT_FOUND",
      message: `Path ${req.url} not found`,
    },
  }));
}
