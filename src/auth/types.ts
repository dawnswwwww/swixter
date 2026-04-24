/**
 * Auth module types
 */

/** Auth state stored in auth.json */
export interface AuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  encryptionSalt: string;
  encryptionKey?: string; // base64-encoded derived key (optional — user may not save it)
  authMethod: string;
  userId: string;
  email: string;
}

/** Login credentials */
export interface LoginCredentials {
  email: string;
  password: string;
}

/** Registration data */
export interface RegisterData {
  email: string;
  password: string;
  displayName?: string;
}

/** API response from auth endpoints */
export interface AuthApiResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
  encryptionSalt: string;
}

/** Refresh response */
export interface RefreshResponse {
  accessToken: string;
  expiresAt: string;
}

/** API error response */
export interface ApiErrorResponse {
  code: string;
  message: string;
}

/** Magic link send response */
export interface MagicLinkSendResponse {
  success: boolean;
  sessionId?: string;
  message?: string;
}

/** Magic link session status (for CLI polling) */
export interface MagicLinkSessionResponse {
  status: 'pending' | 'completed';
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: string;
  user?: {
    id: string;
    email: string;
    displayName: string | null;
  };
  encryptionSalt?: string;
}

/** Verification code send response */
export interface VerificationCodeResponse {
  success: boolean;
  expiresIn: number;
  code?: string; // Returned in test environments
}

/** Verify-and-register data */
export interface VerifyRegisterData {
  email: string;
  code: string;
  password: string;
  displayName?: string;
}

/** Magic link verify response */
export interface MagicLinkVerifyResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    displayName: string | null;
  };
  encryptionSalt: string;
}
