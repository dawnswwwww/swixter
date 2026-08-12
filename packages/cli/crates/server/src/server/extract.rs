//! TS: server/middleware.ts jsonBodyMiddleware 对齐的 JSON body extractor
use axum::{
    extract::{FromRequest, Request},
    http::header,
};

use super::error::ApiError;

/// JSON body extractor，逐条对齐 TS jsonBodyMiddleware：
/// - Content-Type 不含 application/json → 不解析，body 视为 Value::Null
///   （TS 中 body 为 undefined，由各 handler 自行判缺参，通常 400 INVALID_PARAMS）
/// - 空 body → Value::Null（TS chunks.length === 0 → next()，不设置 body）
/// - 畸形 JSON → 500 {error:{code:"UNKNOWN_ERROR",message:"Invalid JSON body"}}
///   （TS middleware next(Error) → router finalize → sendError(error, 500)）
pub struct JsonBody(pub serde_json::Value);

impl<S> FromRequest<S> for JsonBody
where
    S: Send + Sync,
{
    type Rejection = ApiError;

    async fn from_request(req: Request, _state: &S) -> Result<Self, Self::Rejection> {
        let is_json = req
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|ct| ct.contains("application/json"));
        if !is_json {
            return Ok(JsonBody(serde_json::Value::Null));
        }
        let bytes = axum::body::to_bytes(req.into_body(), usize::MAX)
            .await
            .map_err(|e| ApiError::internal("UNKNOWN_ERROR", e.to_string()))?;
        if bytes.is_empty() {
            return Ok(JsonBody(serde_json::Value::Null));
        }
        serde_json::from_slice(&bytes)
            .map(JsonBody)
            .map_err(|_| ApiError::internal("UNKNOWN_ERROR", "Invalid JSON body"))
    }
}
