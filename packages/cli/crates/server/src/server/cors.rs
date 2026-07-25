use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};

/// 事实表 §中间件：仅放行 http://127.0.0.1:* / http://localhost:*（回显 origin）；
/// OPTIONS 204 + Max-Age 86400；其余 origin 不加 CORS 头
pub async fn cors_middleware(req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .filter(|o| o.starts_with("http://127.0.0.1") || o.starts_with("http://localhost"))
        .map(|s| s.to_string());
    let is_options = req.method() == axum::http::Method::OPTIONS;
    let mut resp = if is_options {
        let mut r = Response::new(axum::body::Body::empty());
        *r.status_mut() = StatusCode::NO_CONTENT;
        r
    } else {
        next.run(req).await
    };
    if let Some(o) = origin {
        let h = resp.headers_mut();
        h.insert(
            "access-control-allow-origin",
            HeaderValue::from_str(&o).unwrap(),
        );
        h.insert(
            "access-control-allow-methods",
            HeaderValue::from_static("GET,POST,PUT,DELETE,PATCH,OPTIONS"),
        );
        h.insert(
            "access-control-allow-headers",
            HeaderValue::from_static("content-type,authorization"),
        );
        if is_options {
            h.insert("access-control-max-age", HeaderValue::from_static("86400"));
        }
    }
    resp
}
