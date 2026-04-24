/**
 * Auth API client for swixter-cloud
 */

import type {
  AuthApiResponse,
  LoginCredentials,
  RegisterData,
  RefreshResponse,
  ApiErrorResponse,
  MagicLinkSendResponse,
  MagicLinkVerifyResponse,
  MagicLinkSessionResponse,
} from "./types.js";

import { API_BASE } from "../constants/api.js";

class AuthError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({}))) as ApiErrorResponse;
    throw new AuthError(
      response.status,
      error.code || "UNKNOWN",
      error.message || `HTTP ${response.status}`
    );
  }

  const text = await response.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/**
 * Register a new account
 */
export async function registerUser(
  data: RegisterData
): Promise<AuthApiResponse> {
  return apiRequest<AuthApiResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Login with email and password
 */
export async function loginUser(
  credentials: LoginCredentials
): Promise<AuthApiResponse> {
  return apiRequest<AuthApiResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(credentials),
  });
}

/**
 * Refresh access token
 */
export async function refreshToken(
  refreshToken: string
): Promise<RefreshResponse> {
  return apiRequest<RefreshResponse>("/api/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

/**
 * Logout (revoke session)
 */
export async function logoutUser(refreshToken: string): Promise<void> {
  await apiRequest<{ success: boolean }>("/api/auth/logout", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
  });
}

/**
 * Set or update login password (requires being logged in)
 */
export async function setPassword(
  accessToken: string,
  password: string
): Promise<void> {
  await apiRequest<void>("/api/auth/set-password", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ password }),
  });
}

/**
 * Delete the user's cloud account and all synced data
 */
export async function deleteAccount(accessToken: string): Promise<void> {
  await apiRequest<void>("/api/auth/account", {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

/**
 * Request a magic link to be sent to the user's email
 */
export async function sendMagicLink(email: string): Promise<MagicLinkSendResponse> {
  return apiRequest<MagicLinkSendResponse>("/api/auth/magic-link/send", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/**
 * Verify a magic link token and log in
 */
export async function verifyMagicLink(
  email: string,
  token: string
): Promise<MagicLinkVerifyResponse> {
  return apiRequest<MagicLinkVerifyResponse>("/api/auth/magic-link/verify", {
    method: "POST",
    body: JSON.stringify({ email, token }),
  });
}

/**
 * Poll for magic link session status (browser-click-to-CLI-login flow)
 */
export async function checkMagicLinkSession(
  sessionId: string
): Promise<MagicLinkSessionResponse> {
  return apiRequest<MagicLinkSessionResponse>(
    `/api/auth/magic-link/session/${encodeURIComponent(sessionId)}`,
    { method: "GET" }
  );
}

export { AuthError };
