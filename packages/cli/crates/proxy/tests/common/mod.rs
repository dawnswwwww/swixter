use axum::{body::Body, http::StatusCode, response::Response, routing::any, Router};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone)]
pub struct RecordedRequest {
    // 各测试二进制按需读取不同字段；单二进制内未读字段属正常
    #[allow(dead_code)]
    pub method: String,
    #[allow(dead_code)]
    pub path: String,
    #[allow(dead_code)]
    pub headers: Vec<(String, String)>,
    #[allow(dead_code)] // Task 9 handler/server 测试断言 body 时使用
    pub body: Vec<u8>,
}

pub struct MockUpstream {
    #[allow(dead_code)] // 后续任务使用；本任务只用 base_url
    pub addr: SocketAddr,
    pub base_url: String, // http://127.0.0.1:<port>
    pub recorded: Arc<Mutex<Vec<RecordedRequest>>>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl MockUpstream {
    /// respond: 每次请求调用，返回 (status, content_type, body)
    pub async fn start<F>(respond: F) -> Self
    where
        F: Fn() -> (StatusCode, String, Body) + Send + Sync + 'static,
    {
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let rec = recorded.clone();
        let respond = Arc::new(respond);
        let app = Router::new().route(
            "/{*path}",
            any(
                move |method: axum::http::Method,
                      headers: axum::http::HeaderMap,
                      uri: axum::http::Uri,
                      body: axum::body::Bytes| {
                    let rec = rec.clone();
                    let respond = respond.clone();
                    let (status, ct, resp_body) = respond();
                    async move {
                        let query = uri.query().map(|q| format!("?{q}")).unwrap_or_default();
                        rec.lock().unwrap().push(RecordedRequest {
                            method: method.to_string(),
                            path: format!("{}{}", uri.path(), query),
                            headers: headers
                                .iter()
                                .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
                                .collect(),
                            body: body.to_vec(),
                        });
                        Response::builder()
                            .status(status)
                            .header("content-type", ct)
                            .body(resp_body)
                            .unwrap()
                    }
                },
            ),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    rx.await.ok();
                })
                .await
                .unwrap();
        });
        Self {
            addr,
            base_url: format!("http://{addr}"),
            recorded,
            shutdown: Some(tx),
        }
    }
}

impl Drop for MockUpstream {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}
