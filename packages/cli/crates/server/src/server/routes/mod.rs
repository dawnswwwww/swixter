pub mod coders;
pub mod config;
pub mod groups;
pub mod profiles;
pub mod providers;

use axum::{middleware, Router};

use crate::server::cors::cors_middleware;
use crate::server::state::AppState;

/// Router 组装（Task 5：5 组 REST；Task 6 追加 proxy 路由、/ws 与静态 SPA fallback）
pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .merge(profiles::routes())
        .merge(providers::routes())
        .merge(coders::routes())
        .merge(config::routes())
        .merge(groups::routes());
    Router::new()
        .nest("/api", api)
        .layer(middleware::from_fn(cors_middleware))
        .with_state(state)
}
