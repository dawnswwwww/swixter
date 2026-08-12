//! TS: server/api/groups.ts
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use swixter_core::groups;
use swixter_core::types::Group;

use crate::server::error::ApiError;
use crate::server::extract::JsonBody;
use crate::server::state::AppState;

pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/groups", get(list_groups).post(create_group))
        .route(
            "/groups/{id}",
            get(get_group).put(update_group).delete(delete_group),
        )
        .route("/groups/{id}/active", axum::routing::put(set_active_group))
}

/// 列表响应附 profileDetails [{id,name,providerId}|null]（按 profiles 顺序）
fn with_profile_details(state: &AppState, g: &Group) -> serde_json::Value {
    let mgr = state.config_manager();
    let mut v = serde_json::to_value(g).unwrap();
    let details: Vec<serde_json::Value> = g
        .profiles
        .iter()
        .map(|pid| match mgr.get_profile(pid) {
            Some(p) => serde_json::json!({
                "id": pid,
                "name": p.name,
                "providerId": p.provider_id,
            }),
            None => serde_json::Value::Null,
        })
        .collect();
    v["profileDetails"] = details.into();
    v
}

async fn list_groups(State(state): State<AppState>) -> impl IntoResponse {
    let mgr = state.config_manager();
    let list: Vec<serde_json::Value> = mgr
        .config()
        .groups
        .values()
        .map(|g| with_profile_details(&state, g))
        .collect();
    Json(list)
}

async fn get_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let mgr = state.config_manager();
    let group = groups::find_by_id_or_name(&mgr, &id).ok_or_else(|| {
        ApiError::not_found("GROUP_NOT_FOUND", format!("Group \"{id}\" not found"))
    })?;
    Ok(Json(group))
}

async fn create_group(
    State(state): State<AppState>,
    JsonBody(body): JsonBody,
) -> Result<impl IntoResponse, ApiError> {
    let Some(name) = body.get("name").and_then(|v| v.as_str()) else {
        return Err(ApiError::bad_request("INVALID_PARAMS", "name is required"));
    };
    let profiles: Vec<String> = body
        .get("profiles")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    let mut mgr = state.config_manager();
    let group = groups::create(&mut mgr, name, profiles)
        .map_err(|e| ApiError::bad_request("CREATE_GROUP_FAILED", e.to_string()))?;
    if body.get("isDefault").and_then(|v| v.as_bool()) == Some(true) {
        groups::set_default(&mut mgr, &group.id)
            .map_err(|e| ApiError::bad_request("CREATE_GROUP_FAILED", e.to_string()))?;
    }
    let out = mgr.config().groups.get(&group.id).cloned().unwrap_or(group);
    Ok((StatusCode::CREATED, Json(out)))
}

async fn update_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
    JsonBody(body): JsonBody,
) -> Result<impl IntoResponse, ApiError> {
    let mut mgr = state.config_manager();
    if !mgr.config().groups.contains_key(&id) {
        return Err(ApiError::not_found(
            "GROUP_NOT_FOUND",
            format!("Group \"{id}\" not found"),
        ));
    }
    let name = body.get("name").and_then(|v| v.as_str());
    let profiles: Option<Vec<String>> =
        body.get("profiles").and_then(|v| v.as_array()).map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        });
    groups::update(&mut mgr, &id, name, profiles)
        .map_err(|e| ApiError::bad_request("UPDATE_GROUP_FAILED", e.to_string()))?;
    // TS updateGroup：`isDefault: updates.isDefault ?? group.isDefault` ——
    // true → set_default（互斥清除其他）；显式 false → 仅取消本组默认
    // （不清其他组，也不动 activeGroup）
    match body.get("isDefault").and_then(|v| v.as_bool()) {
        Some(true) => {
            groups::set_default(&mut mgr, &id)
                .map_err(|e| ApiError::bad_request("UPDATE_GROUP_FAILED", e.to_string()))?;
        }
        Some(false) => {
            if let Some(g) = mgr.config_mut_for_test().groups.get_mut(&id) {
                g.is_default = false;
            }
            mgr.mark_dirty();
            mgr.save()
                .map_err(|e| ApiError::bad_request("UPDATE_GROUP_FAILED", e.to_string()))?;
        }
        None => {}
    }
    let out = mgr.config().groups.get(&id).cloned().unwrap();
    Ok(Json(out))
}

async fn delete_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let mut mgr = state.config_manager();
    if !mgr.config().groups.contains_key(&id) {
        return Err(ApiError::not_found(
            "GROUP_NOT_FOUND",
            format!("Group \"{id}\" not found"),
        ));
    }
    groups::delete(&mut mgr, &id)
        .map_err(|e| ApiError::bad_request("DELETE_GROUP_FAILED", e.to_string()))?;
    Ok(Json(serde_json::json!({
        "success": true,
        "message": format!("Group \"{id}\" deleted"),
    })))
}

/// PUT /{id}/active —— 设置 activeGroup 并广播 group.change（TS emitGroupChange）
async fn set_active_group(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let mut mgr = state.config_manager();
    let group = groups::find_by_id_or_name(&mgr, &id).ok_or_else(|| {
        ApiError::not_found("GROUP_NOT_FOUND", format!("Group \"{id}\" not found"))
    })?;
    groups::set_active(&mut mgr, &group.id)
        .map_err(|e| ApiError::internal("SET_ACTIVE_GROUP_FAILED", e.to_string()))?;
    let active = mgr
        .config()
        .active_group
        .as_ref()
        .and_then(|gid| mgr.config().groups.get(gid))
        .cloned();
    if let Some(g) = &active {
        // 无订阅者时 send 返回 Err，忽略（与 proxy 事件总线同语义）
        let _ = state.ws_broadcast.send(serde_json::json!({
            "type": "group.change",
            "groupId": g.id,
            "groupName": g.name,
        }));
    }
    Ok(Json(active))
}
