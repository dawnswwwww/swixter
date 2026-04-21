/**
 * Bun HTTP Bridge
 * Bridges Bun.serve Web API Request/Response to Node-style req/res for
 * existing Router / middleware / API handlers.
 */

import type { Router } from "./router.js";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * Convert a Bun Request into a Node-style IncomingMessage + ServerResponse pair,
 * run it through the router, and return a Web API Response.
 */
export async function handleApiRequest(request: Request, router: Router): Promise<Response> {
  const url = new URL(request.url);

  // Build headers record
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  // Read body for POST/PUT/PATCH so middleware can parse it
  let rawBody: Buffer | undefined;
  if (request.method && ["POST", "PUT", "PATCH"].includes(request.method.toUpperCase())) {
    const arrayBuf = await request.arrayBuffer();
    if (arrayBuf.byteLength > 0) {
      rawBody = Buffer.from(arrayBuf);
    }
  }

  let resolveResponse: ((response: Response) => void) | null = null;
  const responsePromise = new Promise<Response>((resolve) => {
    resolveResponse = resolve;
  });

  const nodeRes = new NodeResShim((res) => {
    if (resolveResponse) {
      resolveResponse(buildResponse(res));
      resolveResponse = null;
    }
  });

  const nodeReq = new NodeReqShim(
    request.method || "GET",
    url.pathname + url.search,
    headers,
  );

  // Start the router. It runs middleware chain (callbacks) and eventually
  // the matched route handler, which calls res.end() → resolves responsePromise.
  // router.handle() returns a promise that resolves after the full chain completes,
  // but the actual response data is resolved via responsePromise when res.end() fires.
  // Start the router. It runs middleware chain (via callbacks) and the matched
  // route handler, which calls res.end() → resolves responsePromise.
  // For no-match routes, notFoundHandler inside the router calls res.end() too.
  router.handle(
    nodeReq as unknown as IncomingMessage,
    nodeRes as unknown as ServerResponse,
  );

  // Emit body data/end events after synchronous middleware setup.
  queueMicrotask(() => {
    if (rawBody) {
      nodeReq.emit("data", rawBody);
    }
    nodeReq.emit("end");
  });

  // responsePromise resolves when res.end() is called by the handler
  // (or by notFoundHandler when no route matches, handled inside the router).
  return responsePromise;
}

function buildResponse(res: NodeResShim): Response {
  const body = Buffer.concat(res.chunks);
  const headers: Record<string, string> = {};
  for (const [key, value] of res.headers) {
    headers[key] = value;
  }
  return new Response(body, {
    status: res.statusCode,
    headers,
  });
}

// ---------------------------------------------------------------------------
// Minimal Node IncomingMessage shim
// ---------------------------------------------------------------------------

class NodeReqShim {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
  private cbs = new Map<string, Array<(...a: any[]) => void>>();

  constructor(method: string, url: string, headers: Record<string, string>) {
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.body = undefined;
  }

  on(event: string, cb: (...a: any[]) => void): this {
    let arr = this.cbs.get(event);
    if (!arr) { arr = []; this.cbs.set(event, arr); }
    arr.push(cb);
    return this;
  }

  emit(event: string, ...args: any[]): void {
    for (const cb of this.cbs.get(event) ?? []) cb(...args);
  }
}

// ---------------------------------------------------------------------------
// Minimal Node ServerResponse shim
// ---------------------------------------------------------------------------

class NodeResShim {
  statusCode = 200;
  headers = new Map<string, string>();
  chunks: Buffer[] = [];
  writableEnded = false;
  private onFinalize: (res: NodeResShim) => void;

  constructor(onFinalize: (res: NodeResShim) => void) {
    this.onFinalize = onFinalize;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  write(chunk: Buffer | string): void {
    if (typeof chunk === "string") {
      this.chunks.push(Buffer.from(chunk, "utf-8"));
    } else {
      this.chunks.push(chunk);
    }
  }

  end(data?: Buffer | string): this {
    if (data !== undefined) {
      if (typeof data === "string") {
        this.chunks.push(Buffer.from(data, "utf-8"));
      } else {
        this.chunks.push(data);
      }
    }
    this.writableEnded = true;
    this.onFinalize(this);
    return this;
  }
}
