use serde::Serialize;

use crate::auth::types::*;

/// TS: auth/client.ts —— reqwest 认证 API 客户端，base_url 可注入（测试用 mock server）
pub struct AuthClient {
    http: reqwest::Client,
    base_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VerifyRegisterBody<'a> {
    email: &'a str,
    code: &'a str,
    password: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RegisterBody<'a> {
    email: &'a str,
    password: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    display_name: Option<&'a str>,
}

impl AuthClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    /// 发送请求；非 2xx 解析 {code,message} 为 AuthApiError（解析失败 code="UNKNOWN"）
    async fn send(&self, req: reqwest::RequestBuilder) -> Result<bytes::Bytes, AuthApiError> {
        let resp = req.send().await.map_err(|e| AuthApiError {
            status: 0,
            code: "NETWORK_ERROR".into(),
            message: e.to_string(),
        })?;
        let status = resp.status();
        let body = resp.bytes().await.map_err(|e| AuthApiError {
            status: status.as_u16(),
            code: "NETWORK_ERROR".into(),
            message: e.to_string(),
        })?;
        if !status.is_success() {
            let err: serde_json::Value =
                serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
            return Err(AuthApiError {
                status: status.as_u16(),
                code: err["code"].as_str().unwrap_or("UNKNOWN").to_string(),
                message: err["message"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| format!("HTTP {status}")),
            });
        }
        Ok(body)
    }

    fn post(&self, path: &str, body: &impl Serialize) -> reqwest::RequestBuilder {
        self.http.post(self.url(path)).json(body)
    }

    /// TS: sendVerificationCode
    pub async fn send_verification_code(
        &self,
        email: &str,
    ) -> Result<VerificationCodeResponse, AuthApiError> {
        let body = self
            .send(self.post(
                "/api/auth/register/send-code",
                &serde_json::json!({"email": email}),
            ))
            .await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// TS: verifyAndRegister
    pub async fn verify_and_register(
        &self,
        email: &str,
        code: &str,
        password: &str,
        display_name: Option<&str>,
    ) -> Result<AuthApiResponse, AuthApiError> {
        let body = self
            .send(self.post(
                "/api/auth/register/verify",
                &VerifyRegisterBody {
                    email,
                    code,
                    password,
                    display_name,
                },
            ))
            .await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// TS: registerUser（legacy 直接注册）
    pub async fn register_legacy(
        &self,
        email: &str,
        password: &str,
        display_name: Option<&str>,
    ) -> Result<AuthApiResponse, AuthApiError> {
        let body = self
            .send(self.post(
                "/api/auth/register",
                &RegisterBody {
                    email,
                    password,
                    display_name,
                },
            ))
            .await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// TS: loginUser
    pub async fn login(
        &self,
        email: &str,
        password: &str,
    ) -> Result<AuthApiResponse, AuthApiError> {
        let body = self
            .send(self.post(
                "/api/auth/login",
                &serde_json::json!({"email": email, "password": password}),
            ))
            .await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// TS: refreshToken
    pub async fn refresh(&self, refresh_token: &str) -> Result<RefreshResponse, AuthApiError> {
        let body = self
            .send(self.post(
                "/api/auth/refresh",
                &serde_json::json!({"refreshToken": refresh_token}),
            ))
            .await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// TS: logoutUser
    pub async fn logout(&self, refresh_token: &str) -> Result<(), AuthApiError> {
        self.send(self.post(
            "/api/auth/logout",
            &serde_json::json!({"refreshToken": refresh_token}),
        ))
        .await?;
        Ok(())
    }

    /// TS: setPassword（需 Bearer）
    pub async fn set_password(
        &self,
        password: &str,
        access_token: &str,
    ) -> Result<(), AuthApiError> {
        self.send(
            self.post(
                "/api/auth/set-password",
                &serde_json::json!({"password": password}),
            )
            .bearer_auth(access_token),
        )
        .await?;
        Ok(())
    }

    /// TS: deleteAccount（需 Bearer）
    pub async fn delete_account(&self, access_token: &str) -> Result<(), AuthApiError> {
        self.send(
            self.http
                .delete(self.url("/api/auth/account"))
                .bearer_auth(access_token),
        )
        .await?;
        Ok(())
    }

    /// TS: sendMagicLink
    pub async fn send_magic_link(
        &self,
        email: &str,
    ) -> Result<MagicLinkSendResponse, AuthApiError> {
        let body = self
            .send(self.post(
                "/api/auth/magic-link/send",
                &serde_json::json!({"email": email}),
            ))
            .await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// TS: verifyMagicLink
    pub async fn verify_magic_link(
        &self,
        email: &str,
        token: &str,
    ) -> Result<MagicLinkVerifyResponse, AuthApiError> {
        let body = self
            .send(self.post(
                "/api/auth/magic-link/verify",
                &serde_json::json!({"email": email, "token": token}),
            ))
            .await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// TS: checkMagicLinkSession（轮询浏览器点击登录流程）
    pub async fn check_magic_link_session(
        &self,
        session_id: &str,
    ) -> Result<MagicLinkSessionResponse, AuthApiError> {
        // TS 用 encodeURIComponent(sessionId)：session_id 作为路径段 percent-encode，
        // 防止 '/'、'?' 等字符改变路径语义（base 不带尾斜杠，push 恰好补一层）
        let mut url = url::Url::parse(&self.url("/api/auth/magic-link/session")).map_err(|e| {
            AuthApiError {
                status: 0,
                code: "INVALID_URL".into(),
                message: e.to_string(),
            }
        })?;
        url.path_segments_mut()
            .map_err(|_| AuthApiError {
                status: 0,
                code: "INVALID_URL".into(),
                message: "base url is cannot-be-a-base".into(),
            })?
            .push(session_id);
        let body = self.send(self.http.get(url)).await?;
        Ok(serde_json::from_slice(&body)?)
    }
}

impl From<serde_json::Error> for AuthApiError {
    fn from(e: serde_json::Error) -> Self {
        AuthApiError {
            status: 0,
            code: "INVALID_RESPONSE".into(),
            message: e.to_string(),
        }
    }
}
