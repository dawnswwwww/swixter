pub mod coders;
pub mod config;
pub mod groups;
pub mod profiles;
pub mod providers;
pub mod proxy;

use axum::{middleware, routing::get, Router};

use crate::server::cors::cors_middleware;
use crate::server::state::AppState;
use crate::server::static_files::static_handler;
use crate::server::ws::ws_handler;

/// Router 组装：/api/* REST + /ws + 静态 SPA fallback（未匹配 /api 路径 → 404 JSON）
pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .merge(profiles::routes())
        .merge(providers::routes())
        .merge(coders::routes())
        .merge(config::routes())
        .merge(groups::routes())
        .merge(proxy::routes())
        // TS middleware.ts notFoundHandler：/api 前缀不落入静态 SPA
        .fallback(api_not_found);
    Router::new()
        .nest("/api", api)
        .route("/ws", get(ws_handler))
        .fallback(static_handler)
        .layer(middleware::from_fn(cors_middleware))
        .with_state(state)
}

async fn api_not_found(uri: axum::http::Uri) -> crate::server::error::ApiError {
    crate::server::error::ApiError::not_found("NOT_FOUND", format!("Path {uri} not found"))
}
