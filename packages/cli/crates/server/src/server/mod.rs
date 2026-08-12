//! axum Web UI 后端：REST 路由 + /ws + 静态 SPA（Task 5/6）。
pub mod cors;
pub mod error;
pub mod extract;
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

/// bind 阶段：从期望端口起递增探测并就地 bind（探测即占用，没有先探测再 bind
/// 的竞争窗口）；返回实际绑定端口与 listener。递增到 65535 仍失败 → 结构化 Err
/// （与 find_available_port 同语义，不再 expect panic）。
pub async fn bind_server(
    port: Option<u16>,
) -> Result<(u16, tokio::net::TcpListener), crate::ServerError> {
    let mut port = port.unwrap_or(DEFAULT_UI_PORT);
    loop {
        match tokio::net::TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => return Ok((port, listener)),
            Err(e) if port == u16::MAX => return Err(e.into()),
            Err(_) => port += 1,
        }
    }
}

/// serve 阶段：在已绑定的 listener 上阻塞 serve（调用方负责生命周期/信号）
pub async fn serve_bound(listener: tokio::net::TcpListener, port: u16, opts: ServerOptions) {
    let state = state::AppState::new(opts.config_path);
    let app = routes::router(state);
    println!("Swixter Web UI: http://127.0.0.1:{port}");
    axum::serve(listener, app).await.ok();
}

/// 启动 Web UI server：bind 成功即返回（实际绑定端口, serve 任务句柄），
/// 调用方据实际端口写 PID 文件、用句柄管理生命周期（abort）；
/// 端口一路递增到 65535 仍被占用 → 返回 Err 而非 panic
pub async fn start_server(
    port: Option<u16>,
    opts: ServerOptions,
) -> Result<(u16, tokio::task::JoinHandle<()>), crate::ServerError> {
    let (port, listener) = bind_server(port).await?;
    let handle = tokio::spawn(serve_bound(listener, port, opts));
    Ok((port, handle))
}

#[cfg(test)]
mod tests {
    use super::{find_available_port, start_server};
    use crate::ServerOptions;

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
        // start_server 同款：bind 失败返回结构化 Err 而非 expect panic
        // （与上一个断言共用 65535 的占用，串行避免测试间端口互抢）
        assert!(start_server(Some(u16::MAX), Default::default())
            .await
            .is_err());
    }

    #[tokio::test]
    async fn start_server_returns_actual_port_after_race() {
        // 制造探测→bind 竞争：先占住一个端口，start_server 应递增 bind 到下一个
        // 可用端口，返回实际端口（≠ 被占端口）且不 panic；实际端口上服务可用
        let held = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let taken = held.local_addr().unwrap().port();
        let dir = tempfile::tempdir().unwrap();
        let opts = ServerOptions {
            config_path: Some(dir.path().join("config.json")),
        };
        let (port, handle) = start_server(Some(taken), opts).await.unwrap();
        assert_ne!(port, taken);
        assert!(crate::daemon::health_check(port).await);
        handle.abort();
    }
}
