//! TS: server/api/config.ts
use std::collections::HashMap;

use axum::{
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use swixter_core::export::{export_config, import_config, EXPORT_VERSION};
use swixter_core::types::CONFIG_VERSION;

use crate::server::error::ApiError;
use crate::server::state::AppState;
use crate::server::util::{generate_etag, parse_if_none_match};

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/version", get(get_version))
        .route("/config", get(get_config_meta))
        .route("/config/export", get(export_config_file))
        .route("/config/import", axum::routing::post(import_config_file))
        .route("/config/reset", axum::routing::post(reset_config))
}

async fn get_version() -> impl IntoResponse {
    Json(serde_json::json!({
        "appVersion": env!("CARGO_PKG_VERSION"),
        "configVersion": CONFIG_VERSION,
        "exportVersion": EXPORT_VERSION,
    }))
}

fn mtime_iso(t: std::time::SystemTime) -> String {
    const FORMAT: &[time::format_description::FormatItem<'_>] = time::macros::format_description!(
        "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z"
    );
    time::OffsetDateTime::from(t).format(&FORMAT).unwrap()
}

/// GET /api/config —— ETag 缓存（If-None-Match 匹配 → 304）
async fn get_config_meta(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let path = state.config_path();
    let Ok(meta) = std::fs::metadata(&path) else {
        return Json(serde_json::json!({
            "exists": false,
            "profiles": [],
            "mtime": null,
            "size": 0,
        }))
        .into_response();
    };
    let mtime_secs = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let size = meta.len();
    let etag = generate_etag(mtime_secs, size);

    if let Some(inm) = headers.get("if-none-match").and_then(|v| v.to_str().ok()) {
        if parse_if_none_match(inm) == etag.trim_matches('"') {
            return StatusCode::NOT_MODIFIED.into_response();
        }
    }

    let mgr = state.config_manager();
    let profiles: Vec<serde_json::Value> = mgr
        .config()
        .profiles
        .values()
        .map(|p| {
            serde_json::json!({
                "name": p.name,
                "providerId": p.provider_id,
                "updatedAt": p.updated_at,
            })
        })
        .collect();
    let mtime = meta.modified().map(mtime_iso).unwrap_or_default();
    (
        [
            (header::ETAG, etag.clone()),
            (header::CACHE_CONTROL, "no-cache".to_string()),
        ],
        Json(serde_json::json!({
            "exists": true,
            "profiles": profiles,
            "mtime": mtime,
            "size": size,
            "etag": etag,
        })),
    )
        .into_response()
}

/// GET /api/config/export?sanitize=true —— Content-Disposition attachment
async fn export_config_file(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Response, ApiError> {
    let sanitize = q.get("sanitize").is_some_and(|v| v == "true");
    let mgr = state.config_manager();
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let tmp = state
        .config_path()
        .with_file_name(format!(".export-{millis}.json"));
    // 同名残留先删，避免沿用旧文件权限；导出内容含明文 key，落盘即收紧 0600
    let _ = std::fs::remove_file(&tmp);
    let result = export_config(mgr.config(), &tmp, sanitize, None)
        .map_err(|e| ApiError::internal("EXPORT_FAILED", e.to_string()))
        .and_then(|()| {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))
                    .map_err(|e| ApiError::internal("EXPORT_FAILED", e.to_string()))?;
            }
            std::fs::read_to_string(&tmp)
                .map_err(|e| ApiError::internal("EXPORT_FAILED", e.to_string()))
        });
    let _ = std::fs::remove_file(&tmp);
    let content = result?;
    Ok((
        [
            (header::CONTENT_TYPE, "application/json".to_string()),
            (
                header::CONTENT_DISPOSITION,
                "attachment; filename=\"swixter-config.json\"".to_string(),
            ),
        ],
        content,
    )
        .into_response())
}

/// POST /api/config/import —— body {config, overwrite?=true}
async fn import_config_file(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, ApiError> {
    let Some(config) = body.get("config") else {
        return Err(ApiError::bad_request(
            "INVALID_PARAMS",
            "config is required",
        ));
    };
    let overwrite = body
        .get("overwrite")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    let tmp = state
        .config_path()
        .with_file_name(format!(".import-{millis}.json"));
    std::fs::write(&tmp, serde_json::to_string(config)?)
        .map_err(|e| ApiError::internal("IMPORT_FAILED", e.to_string()))?;

    let mut mgr = state.config_manager();
    let result = import_config(&mut mgr, &tmp, overwrite, true);
    let _ = std::fs::remove_file(&tmp);
    let stats = result.map_err(|e| ApiError::internal("IMPORT_FAILED", e.to_string()))?;
    Ok(Json(serde_json::json!({
        "success": true,
        "imported": stats.imported,
        "skipped": stats.skipped,
        "errors": stats.errors,
    })))
}

/// POST /api/config/reset —— 清各 coder adapter 配置后重置为空配置（TS resetAllData）
async fn reset_config(State(state): State<AppState>) -> Result<impl IntoResponse, ApiError> {
    let mut mgr = state.config_manager();
    for profile_name in mgr.config().profiles.keys() {
        for spec in swixter_core::coder::CODERS {
            let adapter = swixter_core::adapters::get_adapter(spec.adapter);
            if let Err(e) = adapter.remove(profile_name) {
                eprintln!(
                    "Warning: Failed to cleanup {} adapter configuration: {e}",
                    spec.id
                );
            }
        }
    }
    mgr.reset()
        .map_err(|e| ApiError::internal("RESET_FAILED", e.to_string()))?;
    Ok(Json(serde_json::json!({
        "success": true,
        "message": "All data has been reset",
    })))
}

impl From<serde_json::Error> for ApiError {
    fn from(e: serde_json::Error) -> Self {
        ApiError::internal("JSON_ERROR", e.to_string())
    }
}
