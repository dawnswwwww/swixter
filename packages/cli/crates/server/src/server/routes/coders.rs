//! TS: server/api/coders.ts
use axum::{
    extract::{Path, State},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use swixter_core::coder::{get_coder, CODERS};
use swixter_core::types::WireApi;

use crate::server::error::ApiError;
use crate::server::extract::JsonBody;
use crate::server::state::AppState;
use crate::server::util::sanitize_profile;

use super::profiles::find_provider;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/coders", get(list_coders))
        .route(
            "/coders/{coder}/active",
            get(get_active_profile).put(set_active_profile),
        )
        .route("/coders/{coder}/apply", axum::routing::post(apply_profile))
        .route("/coders/{coder}/verify", get(verify_config))
}

fn require_coder(coder: &str) -> Result<&'static swixter_core::coder::CoderSpec, ApiError> {
    get_coder(coder)
        .ok_or_else(|| ApiError::not_found("UNKNOWN_CODER", format!("Coder \"{coder}\" not found")))
}

async fn list_coders(State(state): State<AppState>) -> impl IntoResponse {
    let mgr = state.config_manager();
    let result: Vec<serde_json::Value> = CODERS
        .iter()
        .map(|c| {
            let active = mgr.active_profile(c.id);
            serde_json::json!({
                "id": c.id,
                "displayName": c.display_name,
                "executable": c.executable,
                "wireApi": c.wire_api,
                "supportsAuthToken": c.supports_auth_token,
                "activeProfile": active.map(|p| serde_json::json!({
                    "name": p.name,
                    "providerId": p.provider_id,
                    "baseURL": p.base_url,
                })),
            })
        })
        .collect();
    Json(result)
}

async fn get_active_profile(
    State(state): State<AppState>,
    Path(coder): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let spec = require_coder(&coder)?;
    let mgr = state.config_manager();
    let active = mgr.active_profile(spec.id);
    Ok(Json(serde_json::json!({
        "activeProfile": active.map(sanitize_profile),
    })))
}

async fn set_active_profile(
    State(state): State<AppState>,
    Path(coder): Path<String>,
    JsonBody(body): JsonBody,
) -> Result<impl IntoResponse, ApiError> {
    let spec = require_coder(&coder)?;
    let profile_name = body
        .get("profileName")
        .and_then(|v| v.as_str())
        .ok_or_else(|| ApiError::bad_request("INVALID_PARAMS", "profileName is required"))?;
    let mut mgr = state.config_manager();
    mgr.set_active_profile(spec.id, profile_name)
        .map_err(|e| ApiError::internal("SWITCH_FAILED", e.to_string()))?;
    let active = mgr.active_profile(spec.id);
    Ok(Json(serde_json::json!({
        "activeProfile": active.map(sanitize_profile),
    })))
}

/// provider 的 wire_api 归一化为 TS 字符串语义（缺省 "chat"）
fn provider_wire_api(preset: &swixter_core::types::ProviderPreset) -> &'static str {
    match preset.wire_api {
        Some(WireApi::Responses) => "responses",
        Some(WireApi::Chat) | None => "chat",
    }
}

async fn apply_profile(
    State(state): State<AppState>,
    Path(coder): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let spec = require_coder(&coder)?;
    let mgr = state.config_manager();
    let profile = mgr.active_profile(spec.id).ok_or_else(|| {
        ApiError::bad_request(
            "NO_ACTIVE_PROFILE",
            format!("No active profile for coder \"{coder}\""),
        )
    })?;

    // wire_api 兼容性检查（TS applyProfile）：不兼容 → 200 {success:false, warning:true}
    let provider = find_provider(&state, &profile.provider_id);
    if let Some(p) = &provider {
        let provider_wire = provider_wire_api(p);
        let coder_wire = spec.wire_api;
        let compatible = coder_wire == "both" || coder_wire == provider_wire;
        if !compatible {
            return Ok(Json(serde_json::json!({
                "success": false,
                "message": format!(
                    "Provider \"{}\" uses {} API which is not compatible with {}. \
                     This provider may not work correctly with this coder.",
                    p.display_name, provider_wire, spec.display_name
                ),
                "warning": true,
            })));
        }
    }

    let adapter = swixter_core::adapters::get_adapter(spec.adapter);
    adapter
        .apply(profile, provider.as_ref())
        .map_err(|e| ApiError::internal("APPLY_FAILED", e.to_string()))?;
    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Profile applied to {coder}"),
    })))
}

async fn verify_config(
    State(state): State<AppState>,
    Path(coder): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let spec = require_coder(&coder)?;
    let mgr = state.config_manager();
    let Some(profile) = mgr.active_profile(spec.id) else {
        return Ok(Json(serde_json::json!({
            "verified": false,
            "message": "No active profile",
        })));
    };
    let provider = find_provider(&state, &profile.provider_id);
    let adapter = swixter_core::adapters::get_adapter(spec.adapter);
    let verified = adapter.verify(profile, provider.as_ref());
    Ok(Json(serde_json::json!({
        "verified": verified,
        "message": if verified { "Configuration verified" } else { "Verification failed" },
    })))
}
