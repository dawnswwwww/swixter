//! TS: server/api/providers.ts
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, put},
    Json, Router,
};
use swixter_core::types::ProviderPreset;

use crate::server::error::ApiError;
use crate::server::extract::JsonBody;
use crate::server::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/providers", get(list_providers).post(create_provider))
        // TS 无 GET /api/providers/:id 端点，仅 PUT/DELETE
        .route(
            "/providers/{id}",
            put(update_provider).delete(delete_provider),
        )
}

/// 合并 presets+user（用户覆盖同 id 内置），附 isUser 标志
fn merged_providers(state: &AppState) -> Vec<serde_json::Value> {
    let user = swixter_core::user_providers::load_from(&state.providers_path());
    let user_ids: std::collections::HashSet<String> = user.iter().map(|p| p.id.clone()).collect();
    let mut all: Vec<ProviderPreset> = swixter_core::presets::builtin_presets()
        .iter()
        .filter(|p| !user_ids.contains(&p.id))
        .cloned()
        .collect();
    all.extend(user);
    all.into_iter()
        .map(|p| {
            let mut v = serde_json::to_value(&p).unwrap();
            v["isUser"] = user_ids.contains(&p.id).into();
            v
        })
        .collect()
}

fn load_user(state: &AppState) -> Vec<ProviderPreset> {
    swixter_core::user_providers::load_from(&state.providers_path())
}

async fn list_providers(State(state): State<AppState>) -> impl IntoResponse {
    Json(merged_providers(&state))
}

async fn create_provider(
    State(state): State<AppState>,
    JsonBody(body): JsonBody,
) -> Result<impl IntoResponse, ApiError> {
    let id = body.get("id").and_then(|v| v.as_str());
    let name = body.get("name").and_then(|v| v.as_str());
    let display_name = body.get("displayName").and_then(|v| v.as_str());
    let (Some(id), Some(_), Some(_)) = (id, name, display_name) else {
        return Err(ApiError::bad_request(
            "INVALID_PARAMS",
            "id, name, and displayName are required",
        ));
    };

    // 与任一已知 provider（内置或用户）重复 → 409
    if merged_providers(&state).iter().any(|p| p["id"] == id) {
        return Err(ApiError::conflict(
            "PROVIDER_EXISTS",
            format!("Provider \"{id}\" already exists"),
        ));
    }

    // TS createProvider 默认值：baseURL ""/defaultModels []/authType "api-key"
    let mut v = serde_json::json!({
        "id": id,
        "name": name,
        "displayName": display_name,
        "baseURL": body.get("baseURL").and_then(|x| x.as_str()).unwrap_or(""),
        "defaultModels": body.get("defaultModels").cloned().unwrap_or(serde_json::json!([])),
        "authType": body.get("authType").and_then(|x| x.as_str()).unwrap_or("api-key"),
    });
    for k in [
        "baseURLChat",
        "headers",
        "rateLimit",
        "docs",
        "isChinese",
        "defaultApiFormat",
        "wire_api",
        "env_key",
        "modelFamilies",
    ] {
        if let Some(x) = body.get(k) {
            v[k] = x.clone();
        }
    }
    let provider: ProviderPreset = serde_json::from_value(v)
        .map_err(|e| ApiError::bad_request("INVALID_PARAMS", e.to_string()))?;

    swixter_core::user_providers::add_to(&state.providers_path(), provider.clone())
        .map_err(|e| ApiError::internal("CREATE_FAILED", e.to_string()))?;

    let mut out = serde_json::to_value(&provider).unwrap();
    out["isUser"] = true.into();
    Ok((StatusCode::CREATED, Json(out)))
}

async fn update_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody,
) -> Result<impl IntoResponse, ApiError> {
    let existing = load_user(&state)
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| {
            ApiError::bad_request(
                "NOT_USER_PROVIDER",
                format!("Provider \"{id}\" is not a user-defined provider"),
            )
        })?;

    // TS: {...existing, ...body, id} —— id 取 URL 参数
    let mut v = serde_json::to_value(&existing).unwrap();
    if let Some(obj) = body.as_object() {
        for (k, val) in obj {
            v[k] = val.clone();
        }
    }
    v["id"] = id.clone().into();
    let provider: ProviderPreset = serde_json::from_value(v)
        .map_err(|e| ApiError::bad_request("INVALID_PARAMS", e.to_string()))?;

    swixter_core::user_providers::add_to(&state.providers_path(), provider.clone())
        .map_err(|e| ApiError::internal("UPDATE_FAILED", e.to_string()))?;

    let mut out = serde_json::to_value(&provider).unwrap();
    out["isUser"] = true.into();
    Ok(Json(out))
}

async fn delete_provider(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    if !load_user(&state).iter().any(|p| p.id == id) {
        return Err(ApiError::bad_request(
            "NOT_USER_PROVIDER",
            format!("Provider \"{id}\" is not a user-defined provider"),
        ));
    }
    let deleted = swixter_core::user_providers::remove_from(&state.providers_path(), &id)
        .map_err(|e| ApiError::internal("DELETE_FAILED", e.to_string()))?;
    if !deleted {
        return Err(ApiError::internal(
            "DELETE_FAILED",
            format!("Failed to delete provider \"{id}\""),
        ));
    }
    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Provider \"{id}\" deleted"),
    })))
}
