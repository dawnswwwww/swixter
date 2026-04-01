/**
 * Middleware tests
 */

import { describe, it, expect, vi, beforeEach } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  corsMiddleware,
  jsonBodyMiddleware,
  sendError,
  sendJson,
  notFoundHandler,
} from "../../src/server/middleware.js";

function createMockReq(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    method: "GET",
    url: "/test",
    headers: {},
    ...overrides,
  } as IncomingMessage;
}

function createMockRes(): ServerResponse & {
  statusCode: number;
  headers: Record<string, string>;
  ended: boolean;
  body: string;
} {
  return {
    writableEnded: false,
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(key: string, value: string) {
      this.headers[key] = value;
    },
    end(data?: string) {
      this.ended = true;
      if (data) this.body = data;
    },
    statusCode: 200,
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    ended: boolean;
    body: string;
  };
}

describe("corsMiddleware", () => {
  it("sets CORS header for localhost origin", () => {
    const req = createMockReq({ headers: { origin: "http://localhost:3000" } });
    const res = createMockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(res.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(next).toHaveBeenCalled();
  });

  it("sets CORS header for 127.0.0.1 origin", () => {
    const req = createMockReq({ headers: { origin: "http://127.0.0.1:3000" } });
    const res = createMockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(res.headers["Access-Control-Allow-Origin"]).toBe("http://127.0.0.1:3000");
    expect(next).toHaveBeenCalled();
  });

  it("does not set CORS header for non-localhost origin", () => {
    const req = createMockReq({ headers: { origin: "https://example.com" } });
    const res = createMockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("handles OPTIONS preflight request", () => {
    const req = createMockReq({
      method: "OPTIONS",
      headers: { origin: "http://localhost:3000" },
    });
    const res = createMockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(res.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
    expect(res.headers["Access-Control-Allow-Methods"]).toBe("GET, POST, PUT, DELETE, OPTIONS");
    expect(res.headers["Access-Control-Allow-Headers"]).toBe("Content-Type, Authorization");
    expect(res.headers["Access-Control-Max-Age"]).toBe("86400");
    expect(res.statusCode).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("handles missing origin header", () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = vi.fn();

    corsMiddleware(req, res, next);

    expect(res.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });
});

describe("jsonBodyMiddleware", () => {
  it("skips GET requests without body", () => {
    const req = createMockReq({ method: "GET" });
    const res = createMockRes();
    const next = vi.fn();

    jsonBodyMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as any).body).toBeUndefined();
  });

  it("skips requests without Content-Type header", () => {
    const req = createMockReq({ method: "POST", headers: {} });
    const res = createMockRes();
    const next = vi.fn();

    jsonBodyMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("skips non-JSON content type", () => {
    const req = createMockReq({
      method: "POST",
      headers: { "content-type": "text/plain" },
    });
    const res = createMockRes();
    const next = vi.fn();

    jsonBodyMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it("parses valid JSON body", (done) => {
    const eventEmitter = {
      on(event: string, handler: (data: Buffer) => void) {
        if (event === "data") this._dataHandler = handler;
        if (event === "end") this._endHandler = handler;
        if (event === "error") this._errorHandler = handler;
      },
      _dataHandler: null as ((data: Buffer) => void) | null,
      _endHandler: null as (() => void) | null,
      _errorHandler: null as ((err: Error) => void) | null,
      emit(event: string, data?: Buffer | Error) {
        if (event === "data" && this._dataHandler) this._dataHandler(data as Buffer);
        if (event === "end" && this._endHandler) this._endHandler();
        if (event === "error" && this._errorHandler && data) this._errorHandler(data as Error);
      },
    };

    const req = createMockReq({
      method: "POST",
      headers: { "content-type": "application/json" },
    }) as IncomingMessage & typeof eventEmitter;
    Object.assign(req, eventEmitter);

    const res = createMockRes();
    const next = vi.fn();

    jsonBodyMiddleware(req, res, next);

    // Simulate body data
    const body = JSON.stringify({ name: "test", value: 123 });
    req.emit("data", Buffer.from(body));
    req.emit("end");

    // Need to wait for async processing
    setTimeout(() => {
      expect((req as any).body).toEqual({ name: "test", value: 123 });
      expect(next).toHaveBeenCalled();
      done();
    }, 10);
  });

  it("calls next with error for invalid JSON", (done) => {
    const eventEmitter = {
      on(event: string, handler: (data: Buffer) => void) {
        if (event === "data") this._dataHandler = handler;
        if (event === "end") this._endHandler = handler;
        if (event === "error") this._errorHandler = handler;
      },
      _dataHandler: null as ((data: Buffer) => void) | null,
      _endHandler: null as (() => void) | null,
      _errorHandler: null as ((err: Error) => void) | null,
      emit(event: string, data?: Buffer | Error) {
        if (event === "data" && this._dataHandler) this._dataHandler(data as Buffer);
        if (event === "end" && this._endHandler) this._endHandler();
        if (event === "error" && this._errorHandler && data) this._errorHandler(data as Error);
      },
    };

    const req = createMockReq({
      method: "POST",
      headers: { "content-type": "application/json" },
    }) as IncomingMessage & typeof eventEmitter;
    Object.assign(req, eventEmitter);

    const res = createMockRes();
    const next = vi.fn();

    jsonBodyMiddleware(req, res, next);

    // Simulate invalid body data
    req.emit("data", Buffer.from("not valid json {"));
    req.emit("end");

    setTimeout(() => {
      expect(next).toHaveBeenCalledWith(expect.any(Error));
      done();
    }, 10);
  });

  it("handles empty body", () => {
    const eventEmitter = {
      on(event: string, handler: (data: Buffer) => void) {
        if (event === "data") this._dataHandler = handler;
        if (event === "end") this._endHandler = handler;
      },
      _dataHandler: null as ((data: Buffer) => void) | null,
      _endHandler: null as (() => void) | null,
      emit(event: string, data?: Buffer) {
        if (event === "data" && this._dataHandler) this._dataHandler(data as Buffer);
        if (event === "end" && this._endHandler) this._endHandler();
      },
    };

    const req = createMockReq({
      method: "POST",
      headers: { "content-type": "application/json" },
    }) as IncomingMessage & typeof eventEmitter;
    Object.assign(req, eventEmitter);

    const res = createMockRes();
    const next = vi.fn();

    jsonBodyMiddleware(req, res, next);

    // Simulate empty body
    req.emit("data", Buffer.from(""));
    req.emit("end");

    expect(next).toHaveBeenCalled();
  });
});

describe("sendError", () => {
  it("sends error with Error object", () => {
    const res = createMockRes();
    const error = new Error("Something went wrong");

    sendError(res, error, 500);

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("UNKNOWN_ERROR");
    expect(body.error.message).toBe("Something went wrong");
  });

  it("sends error with ApiError object", () => {
    const res = createMockRes();
    const apiError = { code: "TEST_ERROR", message: "Test error message" };

    sendError(res, apiError, 400);

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toEqual(apiError);
  });

  it("defaults to 400 status code", () => {
    const res = createMockRes();
    const error = new Error("Bad request");

    sendError(res, error);

    expect(res.statusCode).toBe(400);
  });
});

describe("sendJson", () => {
  it("sends JSON response with default status code", () => {
    const res = createMockRes();
    const data = { name: "test", value: 42 };

    sendJson(res, data);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(res.body)).toEqual(data);
  });

  it("sends JSON response with custom status code", () => {
    const res = createMockRes();
    const data = { created: true };

    sendJson(res, data, 201);

    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body)).toEqual(data);
  });

  it("handles array data", () => {
    const res = createMockRes();
    const data = [1, 2, 3];

    sendJson(res, data);

    expect(JSON.parse(res.body)).toEqual([1, 2, 3]);
  });
});

describe("notFoundHandler", () => {
  it("sends 404 response", () => {
    const req = createMockReq({ url: "/unknown/path" });
    const res = createMockRes();

    notFoundHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Path /unknown/path not found");
  });

  it("includes correct path in error message", () => {
    const req = createMockReq({ url: "/api/profiles/missing" });
    const res = createMockRes();

    notFoundHandler(req, res);

    const body = JSON.parse(res.body);
    expect(body.error.message).toBe("Path /api/profiles/missing not found");
  });
});
