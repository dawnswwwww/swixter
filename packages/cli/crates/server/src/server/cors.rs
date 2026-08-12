use axum::{
    extract::Request,
    http::{HeaderValue, StatusCode},
    middleware::Next,
    response::Response,
};

/// origin 放行判定：scheme 限 http，host 精确匹配 127.0.0.1 / localhost（任意端口）。
/// 不能用前缀匹配——`http://127.0.0.1.evil.com` 这类域名可绕过 starts_with。
fn is_allowed_origin(origin: &str) -> bool {
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    // authority = host[:port]（origin 规范无 path/userinfo，保守截断兜底）
    let authority = rest.split('/').next().unwrap_or("");
    let authority = authority.rsplit('@').next().unwrap_or("");
    let host = match authority.rsplit_once(':') {
        // 端口存在时必须纯数字（空端口/非数字视为非法 origin）
        Some((h, p)) => {
            if p.is_empty() || !p.chars().all(|c| c.is_ascii_digit()) {
                return false;
            }
            h
        }
        None => authority,
    };
    host == "127.0.0.1" || host == "localhost"
}

/// 事实表 §中间件：仅放行 http://127.0.0.1:* / http://localhost:*（回显 origin）；
/// OPTIONS 204 + Max-Age 86400；其余 origin 不加 CORS 头
pub async fn cors_middleware(req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .filter(|o| is_allowed_origin(o))
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

#[cfg(test)]
mod tests {
    use super::is_allowed_origin;

    #[test]
    fn allows_exact_loopback_hosts_with_any_port() {
        assert!(is_allowed_origin("http://127.0.0.1:3141"));
        assert!(is_allowed_origin("http://127.0.0.1"));
        assert!(is_allowed_origin("http://localhost:8080"));
        assert!(is_allowed_origin("http://localhost"));
    }

    #[test]
    fn rejects_prefix_bypass_and_other_origins() {
        // 前缀绕过：旧 starts_with 实现会误放行这两个
        assert!(!is_allowed_origin("http://127.0.0.1.evil.com"));
        assert!(!is_allowed_origin("http://localhost.evil.com"));
        // https 不放行（仅 http）
        assert!(!is_allowed_origin("https://127.0.0.1:3141"));
        assert!(!is_allowed_origin("https://localhost"));
        // 其他 host / 畸形 origin
        assert!(!is_allowed_origin("http://evil.com"));
        assert!(!is_allowed_origin("http://127.0.0.2:3141"));
        assert!(!is_allowed_origin("http://localhost:abc"));
        assert!(!is_allowed_origin("http://localhost:"));
        assert!(!is_allowed_origin("http://127.0.0.1:3141@evil.com"));
        assert!(!is_allowed_origin(""));
    }
}
