//! rust-embed SPA 静态服务（决策点 3）：编译期嵌入 ui/dist；未命中回退 index.html。
use axum::{
    http::{header, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

/// 决策点 3：编译期嵌入 ui/dist（build.rs 保证目录存在）
#[derive(RustEmbed)]
#[folder = "../../ui/dist"]
struct UiAssets;

/// SPA fallback handler：命中返回资源（mime_guess Content-Type），未命中回退 index.html
pub async fn static_handler(uri: Uri) -> Response {
    serve_asset(uri.path())
}

fn serve_asset(path: &str) -> Response {
    let lookup = path.trim_start_matches('/');
    let lookup = if lookup.is_empty() {
        "index.html"
    } else {
        lookup
    };
    if let Some(file) = UiAssets::get(lookup) {
        return asset_response(lookup, file.data.into_owned());
    }
    match UiAssets::get("index.html") {
        Some(file) => asset_response("index.html", file.data.into_owned()),
        None => (StatusCode::NOT_FOUND, "ui assets not embedded").into_response(),
    }
}

fn asset_response(path: &str, body: Vec<u8>) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    ([(header::CONTENT_TYPE, mime.essence_str())], body).into_response()
}
