use serde::{Deserialize, Serialize};

/// TS: auth/types.ts AuthState —— auth.json 序列化逐字段对齐
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthState {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub encryption_salt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encryption_key: Option<String>,
    pub auth_method: String,
    pub user_id: String,
    pub email: String,
}

/// TS: auth/types.ts AuthApiResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthApiResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub user: AuthUser,
    pub encryption_salt: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthUser {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
}

/// TS: auth/types.ts RefreshResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshResponse {
    pub access_token: String,
    pub expires_at: String,
}

/// TS: auth/types.ts VerificationCodeResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationCodeResponse {
    pub success: bool,
    pub expires_in: u64,
    pub code: Option<String>,
}

/// TS: auth/types.ts MagicLinkSendResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicLinkSendResponse {
    pub success: bool,
    pub session_id: Option<String>,
    pub message: Option<String>,
}

/// TS: auth/types.ts MagicLinkVerifyResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicLinkVerifyResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
    pub user: AuthUser,
    pub encryption_salt: String,
    pub has_password: Option<bool>,
}

/// TS: auth/types.ts MagicLinkSessionResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MagicLinkSessionResponse {
    pub status: String, // "pending" | "completed"
    pub email: Option<String>,
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub user: Option<AuthUser>,
    pub encryption_salt: Option<String>,
    pub has_password: Option<bool>,
}

/// TS: auth/client.ts AuthError —— 云端错误体 {code,message}
#[derive(thiserror::Error, Debug, Clone)]
#[error("auth error {status} {code}: {message}")]
pub struct AuthApiError {
    pub status: u16,
    pub code: String,
    pub message: String,
}
