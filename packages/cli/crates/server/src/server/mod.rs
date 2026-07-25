//! axum Web UI 后端：REST 路由 + /ws + 静态 SPA（Task 5/6）。
pub mod cors;
pub mod error;
pub mod routes;
pub mod state;
pub mod static_files;
pub mod util;
pub mod ws;

use std::path::PathBuf;

use crate::DEFAULT_UI_PORT;

#[derive(Debug, Clone, Default)]
pub struct ServerOptions {
    /// 测试/嵌入注入；None → core::paths::config_path()
    pub config_path: Option<PathBuf>,
}

/// TS: server/index.ts findAvailablePort —— 从 start 起递增 bind 探测；
/// 递增到 65535 仍被占用则返回错误（debug 下 `port += 1` 会溢出 panic）
pub async fn find_available_port(start: u16) -> Result<u16, crate::ServerError> {
    let mut port = start;
    loop {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(_) => return Ok(port),
            Err(e) if port == u16::MAX => return Err(e.into()),
            Err(_) => port += 1,
        }
    }
}

/// TS: server/index.ts openBrowser（open crate 跨平台等价）
pub fn open_browser(url: &str) {
    if let Err(e) = open::that_detached(url) {
        eprintln!("Could not open browser automatically: {e}");
    }
}

/// 启动 Web UI server（阻塞 serve，调用方负责生命周期/信号）
pub async fn start_server(port: Option<u16>, opts: ServerOptions) {
    let port = match find_available_port(port.unwrap_or(DEFAULT_UI_PORT)).await {
        Ok(p) => p,
        Err(e) => {
            eprintln!("✗ No available port: {e}");
            return;
        }
    };
    let state = state::AppState::new(opts.config_path);
    let app = routes::router(state);
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .expect("bind ui server");
    println!("Swixter Web UI: http://127.0.0.1:{port}");
    axum::serve(listener, app).await.ok();
}

#[cfg(test)]
mod tests {
    use super::find_available_port;

    #[tokio::test]
    async fn returns_free_port() {
        let port = find_available_port(0).await.unwrap();
        assert_eq!(port, 0); // 0 = 由内核分配，bind 必成功
    }

    #[tokio::test]
    async fn errors_instead_of_overflow_at_upper_bound() {
        // 占住 65535 后从 65535 起探测：必须返回 Err 而非 debug 溢出 panic
        let _held = tokio::net::TcpListener::bind(("127.0.0.1", u16::MAX))
            .await
            .unwrap();
        assert!(find_available_port(u16::MAX).await.is_err());
    }
}
