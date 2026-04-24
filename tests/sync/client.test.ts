import { describe, test, expect, mock, beforeEach, afterAll } from "bun:test";
import {
  getSyncStatus,
  pullData,
  pushData,
  deleteSyncData,
} from "../../src/sync/client";
import { API_BASE } from "../../src/constants/api";

// Mock fetch globally
const originalFetch = globalThis.fetch;

describe("sync client", () => {
  const mockFetch = mock(() => Promise.resolve(new Response()));

  beforeEach(() => {
    globalThis.fetch = mockFetch;
    mockFetch.mockClear();
  });

  // Restore after all tests
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  function mockResponse(status: number, body: unknown) {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  }

  describe("getSyncStatus", () => {
    test("calls GET /api/sync/status with auth header", async () => {
      mockResponse(200, {
        statuses: [
          { dataKey: "config", dataVersion: 5, updatedAt: "2026-04-22T10:00:00Z" },
        ],
      });

      const result = await getSyncStatus("test-access-token");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_BASE}/api/sync/status`);
      expect(options.headers).toMatchObject({
        Authorization: "Bearer test-access-token",
      });
      expect(result.statuses).toHaveLength(1);
      expect(result.statuses[0].dataKey).toBe("config");
    });

    test("returns empty statuses when no data synced", async () => {
      mockResponse(200, { statuses: [] });

      const result = await getSyncStatus("token");
      expect(result.statuses).toEqual([]);
    });
  });

  describe("pushData", () => {
    test("calls POST /api/sync/push with correct body", async () => {
      mockResponse(200, {
        success: true,
        dataVersion: 2,
        updatedAt: "2026-04-22T10:00:00Z",
      });

      const result = await pushData("token", {
        dataKey: "config",
        encryptedData: "encrypted-payload",
        dataVersion: 1,
        clientTimestamp: "2026-04-22T09:00:00Z",
      });

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_BASE}/api/sync/push`);
      expect(options.method).toBe("POST");

      const body = JSON.parse(options.body as string);
      expect(body.dataKey).toBe("config");
      expect(body.encryptedData).toBe("encrypted-payload");
      expect(body.dataVersion).toBe(1);

      expect(result.dataVersion).toBe(2);
    });

    test("throws on version conflict (409)", async () => {
      mockResponse(409, {
        code: "CONFLICT",
        message: "Version conflict: server has version 3, client sent 1",
      });

      try {
        await pushData("token", {
          dataKey: "config",
          encryptedData: "data",
          dataVersion: 1,
          clientTimestamp: "2026-04-22T10:00:00Z",
        });
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.status).toBe(409);
        expect(err.code).toBe("CONFLICT");
      }
    });
  });

  describe("pullData", () => {
    test("calls GET /api/sync/pull?dataKey= with auth header", async () => {
      mockResponse(200, {
        dataKey: "config",
        encryptedData: "encrypted-config",
        dataVersion: 3,
        clientTimestamp: "2026-04-22T09:00:00Z",
        updatedAt: "2026-04-22T10:00:00Z",
      });

      const result = await pullData("token", "config");

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_BASE}/api/sync/pull?dataKey=config`);
      expect(options.headers).toMatchObject({
        Authorization: "Bearer token",
      });
      expect(result.encryptedData).toBe("encrypted-config");
      expect(result.dataVersion).toBe(3);
    });

    test("throws on not found (404)", async () => {
      mockResponse(404, {
        code: "NOT_FOUND",
        message: "No sync data found for this key",
      });

      try {
        await pullData("token", "config");
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.status).toBe(404);
      }
    });
  });

  describe("deleteSyncData", () => {
    test("calls DELETE /api/sync/data with auth header", async () => {
      mockResponse(200, { success: true });

      await deleteSyncData("token");

      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_BASE}/api/sync/data`);
      expect(options.method).toBe("DELETE");
    });

    test("deletes specific dataKey when provided", async () => {
      mockResponse(200, { success: true });

      await deleteSyncData("token", "config");

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_BASE}/api/sync/data?dataKey=config`);
    });
  });
});
