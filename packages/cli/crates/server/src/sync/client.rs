use crate::sync::types::*;

/// TS: sync/client.ts SyncError —— 云端错误体 {code,message}
#[derive(thiserror::Error, Debug, Clone)]
#[error("sync error {status} {code}: {message}")]
pub struct SyncError {
    pub status: u16,
    pub code: String,
    pub message: String,
}

impl SyncError {
    fn network(e: reqwest::Error) -> Self {
        Self {
            status: 0,
            code: "NETWORK_ERROR".into(),
            message: e.to_string(),
        }
    }
}

/// TS: sync/client.ts —— Bearer 认证的 sync API 客户端，base_url 可注入（测试用 mock）
pub struct SyncClient {
    http: reqwest::Client,
    base_url: String,
    access_token: String,
}

impl SyncClient {
    pub fn new(base_url: impl Into<String>, access_token: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            access_token: access_token.into(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    fn get(&self, path: &str) -> reqwest::RequestBuilder {
        self.http
            .get(self.url(path))
            .bearer_auth(&self.access_token)
    }

    /// 非 2xx 解析 {code,message} → SyncError
    async fn send(&self, req: reqwest::RequestBuilder) -> Result<bytes::Bytes, SyncError> {
        let resp = req.send().await.map_err(SyncError::network)?;
        let status = resp.status();
        let body = resp.bytes().await.map_err(SyncError::network)?;
        if !status.is_success() {
            let err: serde_json::Value =
                serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
            return Err(SyncError {
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

    /// TS: getSyncStatus —— GET /api/sync/status
    pub async fn status(&self) -> Result<Vec<SyncStatusEntry>, SyncError> {
        let body = self.send(self.get("/api/sync/status")).await?;
        let resp: SyncStatusResponse = serde_json::from_slice(&body).map_err(|e| SyncError {
            status: 0,
            code: "INVALID_RESPONSE".into(),
            message: e.to_string(),
        })?;
        Ok(resp.statuses)
    }

    /// TS: pushData —— POST /api/sync/push；版本冲突 409 {code:"CONFLICT"}
    pub async fn push(&self, req: PushRequest) -> Result<PushResponse, SyncError> {
        let body = self
            .send(
                self.http
                    .post(self.url("/api/sync/push"))
                    .bearer_auth(&self.access_token)
                    .json(&req),
            )
            .await?;
        serde_json::from_slice(&body).map_err(|e| SyncError {
            status: 0,
            code: "INVALID_RESPONSE".into(),
            message: e.to_string(),
        })
    }

    /// TS: pullData —— GET /api/sync/pull?dataKey=；404（无远端数据）→ Ok(None)
    pub async fn pull(&self, data_key: &str) -> Result<Option<PullResponse>, SyncError> {
        let resp = self
            .http
            .get(self.url("/api/sync/pull"))
            .bearer_auth(&self.access_token)
            .query(&[("dataKey", data_key)])
            .send()
            .await
            .map_err(SyncError::network)?;
        if resp.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let status = resp.status();
        let body = resp.bytes().await.map_err(SyncError::network)?;
        if !status.is_success() {
            let err: serde_json::Value =
                serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
            return Err(SyncError {
                status: status.as_u16(),
                code: err["code"].as_str().unwrap_or("UNKNOWN").to_string(),
                message: err["message"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(|| format!("HTTP {status}")),
            });
        }
        serde_json::from_slice(&body)
            .map(Some)
            .map_err(|e| SyncError {
                status: 0,
                code: "INVALID_RESPONSE".into(),
                message: e.to_string(),
            })
    }

    /// TS: deleteSyncData —— DELETE /api/sync/data[?dataKey=]；data_key=None 删全部
    pub async fn delete(&self, data_key: Option<&str>) -> Result<(), SyncError> {
        let req = self.http.delete(self.url("/api/sync/data"));
        let req = match data_key {
            Some(k) => req.query(&[("dataKey", k)]),
            None => req,
        };
        self.send(req.bearer_auth(&self.access_token)).await?;
        Ok(())
    }
}
