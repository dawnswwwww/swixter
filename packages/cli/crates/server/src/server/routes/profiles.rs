//! TS: server/api/profiles.ts
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use swixter_core::types::{now_iso, Profile, ProviderPreset};

use crate::server::error::ApiError;
use crate::server::state::AppState;
use crate::server::util::sanitize_profile;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/profiles", get(list_profiles).post(create_profile))
        .route(
            "/profiles/{name}",
            get(get_profile).put(update_profile).delete(delete_profile),
        )
}

/// provider 查找：用户自定义（state 注入路径）优先，其次内置 preset（TS getProviderById 语义）
pub fn find_provider(state: &AppState, id: &str) -> Option<ProviderPreset> {
    if let Some(p) = swixter_core::user_providers::load_from(&state.providers_path())
        .into_iter()
        .find(|p| p.id == id)
    {
        return Some(p);
    }
    swixter_core::presets::find_builtin(id).cloned()
}

async fn list_profiles(State(state): State<AppState>) -> impl IntoResponse {
    let mgr = state.config_manager();
    let list: Vec<Profile> = mgr
        .config()
        .profiles
        .values()
        .map(sanitize_profile)
        .collect();
    Json(list)
}

async fn get_profile(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let mgr = state.config_manager();
    let profile = mgr.get_profile(&name).ok_or_else(|| {
        ApiError::not_found(
            "PROFILE_NOT_FOUND",
            format!("Profile \"{name}\" does not exist"),
        )
    })?;
    Ok(Json(sanitize_profile(profile)))
}

async fn create_profile(
    State(state): State<AppState>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, ApiError> {
    let name = body.get("name").and_then(|v| v.as_str());
    let provider_id = body.get("providerId").and_then(|v| v.as_str());
    let (Some(name), Some(provider_id)) = (name, provider_id) else {
        return Err(ApiError::bad_request(
            "INVALID_PARAMS",
            "name and providerId are required",
        ));
    };

    let provider = find_provider(&state, provider_id).ok_or_else(|| {
        ApiError::bad_request(
            "UNKNOWN_PROVIDER",
            format!("Provider \"{provider_id}\" not found"),
        )
    })?;

    let mut mgr = state.config_manager();
    if mgr.get_profile(name).is_some() {
        return Err(ApiError::conflict(
            "PROFILE_EXISTS",
            format!("Profile \"{name}\" already exists"),
        ));
    }

    // TS createProfile：未传字段回退默认值；baseURL 缺省继承 provider
    let now = now_iso();
    let mut v = serde_json::json!({
        "name": name,
        "providerId": provider_id,
        "apiKey": body.get("apiKey").and_then(|x| x.as_str()).unwrap_or(""),
        "baseURL": body
            .get("baseURL")
            .and_then(|x| x.as_str())
            .unwrap_or(&provider.base_url),
        "createdAt": now,
        "updatedAt": now,
    });
    if let Some(t) = body
        .get("authToken")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
    {
        v["authToken"] = t.into();
    }
    for k in ["model", "openaiModel", "models", "envKey", "headers"] {
        if let Some(x) = body.get(k) {
            v[k] = x.clone();
        }
    }
    let profile: Profile = serde_json::from_value(v)
        .map_err(|e| ApiError::bad_request("INVALID_PARAMS", e.to_string()))?;

    let coder = body.get("coder").and_then(|x| x.as_str());
    mgr.upsert_profile(profile.clone(), coder)
        .map_err(|e| ApiError::internal("CREATE_FAILED", e.to_string()))?;

    Ok((StatusCode::CREATED, Json(sanitize_profile(&profile))))
}

async fn update_profile(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, ApiError> {
    let mut mgr = state.config_manager();
    let existing = mgr.get_profile(&name).cloned().ok_or_else(|| {
        ApiError::not_found(
            "PROFILE_NOT_FOUND",
            format!("Profile \"{name}\" does not exist"),
        )
    })?;

    // TS: {...existing, ...body, name, updatedAt: now} —— name 取 URL 参数
    let mut v = serde_json::to_value(&existing)
        .map_err(|e| ApiError::internal("UPDATE_FAILED", e.to_string()))?;
    if let Some(obj) = body.as_object() {
        for (k, val) in obj {
            v[k] = val.clone();
        }
    }
    v["name"] = name.clone().into();
    v["updatedAt"] = now_iso().into();
    let profile: Profile = serde_json::from_value(v)
        .map_err(|e| ApiError::bad_request("INVALID_PARAMS", e.to_string()))?;

    mgr.upsert_profile(profile.clone(), None)
        .map_err(|e| ApiError::internal("UPDATE_FAILED", e.to_string()))?;
    Ok(Json(sanitize_profile(&profile)))
}

async fn delete_profile(
    State(state): State<AppState>,
    Path(name): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let mut mgr = state.config_manager();
    mgr.delete_profile(&name)
        .map_err(|e| ApiError::internal("DELETE_FAILED", e.to_string()))?;
    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Profile \"{name}\" deleted"),
    })))
}
