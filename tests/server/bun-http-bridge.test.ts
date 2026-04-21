import { describe, expect, test } from "bun:test";
import { Router } from "../../src/server/router.js";
import { handleApiRequest } from "../../src/server/bun-http-bridge.js";
import { sendJson, sendError, corsMiddleware, jsonBodyMiddleware } from "../../src/server/middleware.js";

function createRouter(): Router {
  const router = new Router();

  router.use(corsMiddleware);
  router.use(jsonBodyMiddleware);

  router.get("/api/test", (_req, res) => {
    sendJson(res, { ok: true });
  });

  router.get("/api/test/:id", (_req, res, params) => {
    sendJson(res, { id: params.id });
  });

  router.post("/api/test", (req: any, res) => {
    sendJson(res, { received: req.body }, 201);
  });

  router.put("/api/test", (req: any, res) => {
    sendJson(res, { updated: req.body });
  });

  router.get("/api/error", (_req, res) => {
    sendError(res, { code: "TEST_ERROR", message: "Something went wrong" }, 400);
  });

  return router;
}

describe("bun-http-bridge", () => {
  const router = createRouter();

  test("GET API route returns JSON", async () => {
    const request = new Request("http://localhost/api/test");
    const response = await handleApiRequest(request, router);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ ok: true });
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  test("GET API route with params extracts correctly", async () => {
    const request = new Request("http://localhost/api/test/hello-42");
    const response = await handleApiRequest(request, router);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ id: "hello-42" });
  });

  test("JSON POST body is parsed by middleware", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "test" }),
    });

    const response = await handleApiRequest(request, router);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({ received: { name: "test" } });
  });

  test("JSON PUT body is parsed by middleware", async () => {
    const request = new Request("http://localhost/api/test", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ field: "value" }),
    });

    const response = await handleApiRequest(request, router);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ updated: { field: "value" } });
  });

  test("handler statusCode and error body pass through", async () => {
    const request = new Request("http://localhost/api/error");
    const response = await handleApiRequest(request, router);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({
      error: { code: "TEST_ERROR", message: "Something went wrong" },
    });
  });

  test("unmatched route returns 404 JSON", async () => {
    const request = new Request("http://localhost/api/nonexistent");
    const response = await handleApiRequest(request, router);

    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
