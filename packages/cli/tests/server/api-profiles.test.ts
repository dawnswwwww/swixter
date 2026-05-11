/**
 * Profiles API tests
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
} from "../../src/server/api/profiles.js";
import * as manager from "../../src/config/manager.js";
import type { ClaudeCodeProfile } from "../../src/types.js";

function createMockReq(overrides: Partial<IncomingMessage> & { body?: unknown } = {}): IncomingMessage {
  return {
    method: "GET",
    url: "/test",
    headers: {},
    ...overrides,
  } as IncomingMessage & { body?: unknown };
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
  } as unknown as ServerResponse & {
    statusCode: number;
    headers: Record<string, string>;
    ended: boolean;
    body: string;
  };
}

describe("Profiles API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("listProfiles", () => {
    it("returns empty array when no profiles exist", async () => {
      vi.spyOn(manager, "listProfiles").mockResolvedValue([]);

      const req = createMockReq();
      const res = createMockRes();

      await listProfiles(req, res);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual([]);
    });

    it("returns sanitized profiles", async () => {
      const profiles: ClaudeCodeProfile[] = [
        {
          name: "test-profile",
          providerId: "anthropic",
          apiKey: "sk-secret-key",
          baseURL: "https://api.anthropic.com",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
      ];
      vi.spyOn(manager, "listProfiles").mockResolvedValue(profiles);

      const req = createMockReq();
      const res = createMockRes();

      await listProfiles(req, res);

      const body = JSON.parse(res.body);
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("test-profile");
      // API key should be masked
      expect(body[0].apiKey).not.toBe("sk-secret-key");
      expect(body[0].apiKey).toContain("****");
    });
  });

  describe("getProfile", () => {
    it("returns 400 when name is missing", async () => {
      const req = createMockReq();
      const res = createMockRes();

      await getProfile(req, res, {});

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("INVALID_PARAMS");
    });

    it("returns 404 when profile not found", async () => {
      vi.spyOn(manager, "getProfile").mockResolvedValue(null);

      const req = createMockReq();
      const res = createMockRes();

      await getProfile(req, res, { name: "non-existent" });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("PROFILE_NOT_FOUND");
    });

    it("returns sanitized profile when found", async () => {
      const profile: ClaudeCodeProfile = {
        name: "my-profile",
        providerId: "ollama",
        apiKey: "ollama-api-key",
        baseURL: "http://localhost:11434",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      vi.spyOn(manager, "getProfile").mockResolvedValue(profile);

      const req = createMockReq();
      const res = createMockRes();

      await getProfile(req, res, { name: "my-profile" });

      const body = JSON.parse(res.body);
      expect(body.name).toBe("my-profile");
      expect(body.apiKey).toContain("****");
    });
  });

  describe("createProfile", () => {
    it("returns 400 when name is missing", async () => {
      const req = createMockReq({
        method: "POST",
        body: { providerId: "anthropic" },
      });
      const res = createMockRes();

      await createProfile(req, res);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("INVALID_PARAMS");
    });

    it("returns 400 when providerId is missing", async () => {
      const req = createMockReq({
        method: "POST",
        body: { name: "test-profile" },
      });
      const res = createMockRes();

      await createProfile(req, res);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("INVALID_PARAMS");
    });

    it("returns 400 when provider does not exist", async () => {
      const req = createMockReq({
        method: "POST",
        body: { name: "test-profile", providerId: "non-existent-provider" },
      });
      const res = createMockRes();

      await createProfile(req, res);

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("UNKNOWN_PROVIDER");
    });

    it("returns 409 when profile already exists", async () => {
      vi.spyOn(manager, "getProfile").mockResolvedValue({
        name: "existing-profile",
        providerId: "anthropic",
        apiKey: "key",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      });

      const req = createMockReq({
        method: "POST",
        body: { name: "existing-profile", providerId: "anthropic" },
      });
      const res = createMockRes();

      await createProfile(req, res);

      expect(res.statusCode).toBe(409);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("PROFILE_EXISTS");
    });

    it("creates profile successfully", async () => {
      vi.spyOn(manager, "getProfile").mockResolvedValue(null);
      const upsertSpy = vi.spyOn(manager, "upsertProfile").mockResolvedValue();

      const req = createMockReq({
        method: "POST",
        body: {
          name: "new-profile",
          providerId: "anthropic",
          apiKey: "sk-new-key",
          baseURL: "https://api.anthropic.com",
        },
      });
      const res = createMockRes();

      await createProfile(req, res);

      expect(upsertSpy).toHaveBeenCalled();
      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body.name).toBe("new-profile");
    });

    it("uses default baseURL from provider when not provided", async () => {
      vi.spyOn(manager, "getProfile").mockResolvedValue(null);
      const upsertSpy = vi.spyOn(manager, "upsertProfile").mockResolvedValue();

      const req = createMockReq({
        method: "POST",
        body: {
          name: "new-profile",
          providerId: "anthropic",
          apiKey: "sk-key",
        },
      });
      const res = createMockRes();

      await createProfile(req, res);

      expect(upsertSpy).toHaveBeenCalled();
      const createdProfile = upsertSpy.mock.calls[0][0] as ClaudeCodeProfile;
      expect(createdProfile.baseURL).toBe("https://api.anthropic.com");
    });
  });

  describe("updateProfile", () => {
    it("returns 400 when name is missing", async () => {
      const req = createMockReq({
        method: "PUT",
        body: { apiKey: "new-key" },
      });
      const res = createMockRes();

      await updateProfile(req, res, {});

      expect(res.statusCode).toBe(400);
    });

    it("returns 404 when profile not found", async () => {
      vi.spyOn(manager, "getProfile").mockResolvedValue(null);

      const req = createMockReq({
        method: "PUT",
        body: { apiKey: "new-key" },
      });
      const res = createMockRes();

      await updateProfile(req, res, { name: "non-existent" });

      expect(res.statusCode).toBe(404);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("PROFILE_NOT_FOUND");
    });

    it("updates profile successfully", async () => {
      const existingProfile: ClaudeCodeProfile = {
        name: "my-profile",
        providerId: "anthropic",
        apiKey: "old-key",
        baseURL: "https://api.anthropic.com",
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      vi.spyOn(manager, "getProfile").mockResolvedValue(existingProfile);
      const upsertSpy = vi.spyOn(manager, "upsertProfile").mockResolvedValue();

      const req = createMockReq({
        method: "PUT",
        body: { apiKey: "new-key" },
      });
      const res = createMockRes();

      await updateProfile(req, res, { name: "my-profile" });

      expect(upsertSpy).toHaveBeenCalled();
      const updatedProfile = upsertSpy.mock.calls[0][0] as ClaudeCodeProfile;
      expect(updatedProfile.apiKey).toBe("new-key");
      expect(updatedProfile.name).toBe("my-profile"); // name should stay consistent
    });
  });

  describe("deleteProfile", () => {
    it("returns 400 when name is missing", async () => {
      const req = createMockReq({ method: "DELETE" });
      const res = createMockRes();

      await deleteProfile(req, res, {});

      expect(res.statusCode).toBe(400);
    });

    it("deletes profile successfully", async () => {
      const deleteSpy = vi.spyOn(manager, "deleteProfile").mockResolvedValue();

      const req = createMockReq({ method: "DELETE" });
      const res = createMockRes();

      await deleteProfile(req, res, { name: "to-delete" });

      expect(deleteSpy).toHaveBeenCalledWith("to-delete");
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it("returns error when delete fails", async () => {
      vi.spyOn(manager, "deleteProfile").mockRejectedValue(new Error("Delete failed"));

      const req = createMockReq({ method: "DELETE" });
      const res = createMockRes();

      await deleteProfile(req, res, { name: "to-delete" });

      expect(res.statusCode).toBe(500);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("DELETE_FAILED");
    });
  });
});
