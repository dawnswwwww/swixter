/**
 * Router tests
 */

import { describe, it, expect } from "bun:test";
import { Router, extractParams } from "../../src/server/router.js";
import type { IncomingMessage, ServerResponse } from "node:http";

describe("Router", () => {
  describe("extractParams", () => {
    it("should extract params from simple pattern", () => {
      const params = extractParams("/api/profiles/:name", "/api/profiles/test-profile");
      expect(params).toEqual({ name: "test-profile" });
    });

    it("should extract multiple params", () => {
      const params = extractParams("/api/:coder/:action", "/api/claude/apply");
      expect(params).toEqual({ coder: "claude", action: "apply" });
    });

    it("should return null for mismatched path length", () => {
      const params = extractParams("/api/profiles/:name", "/api/profiles");
      expect(params).toBeNull();
    });

    it("should return null for mismatched path segments", () => {
      const params = extractParams("/api/profiles/:name", "/api/providers/test");
      expect(params).toBeNull();
    });

    it("should handle trailing slashes", () => {
      const params1 = extractParams("/api/profiles/:name/", "/api/profiles/test/");
      expect(params1).toEqual({ name: "test" });

      const params2 = extractParams("/api/profiles/:name", "/api/profiles/test/");
      expect(params2).toEqual({ name: "test" });
    });

    it("should handle empty segments", () => {
      const params = extractParams("/", "/");
      expect(params).toEqual({});
    });
  });

  describe("Router class", () => {
    it("should register and match GET routes", async () => {
      const router = new Router();
      let called = false;
      let receivedParams: Record<string, string> = {};

      router.get("/test/:id", (req, res, params) => {
        called = true;
        receivedParams = params;
      });

      // Create mock request and response
      const mockReq = {
        method: "GET",
        url: "/test/123",
        headers: {},
      } as IncomingMessage;

      const mockRes = {
        writableEnded: false,
        statusCode: 200,
        setHeader: () => {},
        end: () => {},
      } as unknown as ServerResponse;

      await router.handle(mockReq, mockRes);

      expect(called).toBe(true);
      expect(receivedParams).toEqual({ id: "123" });
    });

    it("should not match routes with different methods", async () => {
      const router = new Router();
      let called = false;

      router.post("/test", () => {
        called = true;
      });

      const mockReq = {
        method: "GET",
        url: "/test",
        headers: {},
      } as IncomingMessage;

      const mockRes = {
        writableEnded: false,
        statusCode: 200,
        setHeader: () => {},
        end: () => {},
      } as unknown as ServerResponse;

      await router.handle(mockReq, mockRes);

      expect(called).toBe(false);
    });

    it("should match routes with same path but different methods", async () => {
      const router = new Router();
      let getCalled = false;
      let postCalled = false;

      router.get("/test", () => {
        getCalled = true;
      });

      router.post("/test", () => {
        postCalled = true;
      });

      const mockReqGet = {
        method: "GET",
        url: "/test",
        headers: {},
      } as IncomingMessage;

      const mockRes = {
        writableEnded: false,
        statusCode: 200,
        setHeader: () => {},
        end: () => {},
      } as unknown as ServerResponse;

      await router.handle(mockReqGet, mockRes);
      expect(getCalled).toBe(true);
      expect(postCalled).toBe(false);

      // Reset
      getCalled = false;
      postCalled = false;

      const mockReqPost = {
        method: "POST",
        url: "/test",
        headers: {},
        body: "{}",
      } as IncomingMessage;

      await router.handle(mockReqPost, mockRes);
      expect(getCalled).toBe(false);
      expect(postCalled).toBe(true);
    });

    it("should execute middleware in order", async () => {
      const router = new Router();
      const order: string[] = [];

      router.use((req, res, next) => {
        order.push("middleware-1");
        next();
      });

      router.use((req, res, next) => {
        order.push("middleware-2");
        next();
      });

      router.get("/test", () => {
        order.push("handler");
      });

      const mockReq = {
        method: "GET",
        url: "/test",
        headers: {},
      } as IncomingMessage;

      const mockRes = {
        writableEnded: false,
        statusCode: 200,
        setHeader: () => {},
        end: () => {},
      } as unknown as ServerResponse;

      await router.handle(mockReq, mockRes);

      expect(order).toEqual(["middleware-1", "middleware-2", "handler"]);
    });
  });
});
