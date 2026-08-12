use axum::{body::Bytes, http::HeaderMap, routing::any, Router};
use std::collections::{HashMap, VecDeque};
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
    pub authorization: Option<String>,
    #[allow(dead_code)]
    pub body: serde_json::Value,
}

/// 可编程 mock：按路径前缀匹配响应队列（每次调用弹一个，空了用最后一个）
pub struct MockCloud {
    #[allow(dead_code)] // 各测试按需使用；本任务只用 base_url/recorded
    pub addr: SocketAddr,
    pub base_url: String,
    pub recorded: Arc<Mutex<Vec<RecordedRequest>>>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

type RouteTable = Arc<Mutex<HashMap<&'static str, VecDeque<(u16, serde_json::Value)>>>>;

impl MockCloud {
    /// routes: (path, 响应序列[(status, body)])
    pub async fn start(routes: Vec<(&'static str, Vec<(u16, serde_json::Value)>)>) -> Self {
        let recorded = Arc::new(Mutex::new(Vec::new()));
        let table: RouteTable = Arc::new(Mutex::new(
            routes.into_iter().map(|(p, q)| (p, q.into())).collect(),
        ));
        let rec = recorded.clone();
        let tab = table.clone();
        let app = Router::new().route(
            "/{*path}",
            any(
                move |method: axum::http::Method,
                      headers: HeaderMap,
                      uri: axum::http::Uri,
                      body: Bytes| {
                    let rec = rec.clone();
                    let tab = tab.clone();
                    async move {
                        rec.lock().unwrap().push(RecordedRequest {
                            method: method.to_string(),
                            path: uri.path().to_string(),
                            authorization: headers
                                .get("authorization")
                                .and_then(|v| v.to_str().ok())
                                .map(String::from),
                            body: serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null),
                        });
                        let mut tab = tab.lock().unwrap();
                        // 前缀匹配，取最长命中的路由
                        let route = tab
                            .keys()
                            .filter(|p| uri.path().starts_with(**p))
                            .max_by_key(|p| p.len())
                            .copied();
                        let (status, body) = match route.and_then(|p| tab.get_mut(&p)) {
                            Some(queue) if queue.len() > 1 => queue.pop_front().unwrap(),
                            Some(queue) => queue.front().unwrap().clone(),
                            None => (
                                404,
                                serde_json::json!({"code":"NOT_FOUND","message":"no mock route"}),
                            ),
                        };
                        (
                            axum::http::StatusCode::from_u16(status).unwrap(),
                            axum::Json(body),
                        )
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

impl Drop for MockCloud {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
    }
}
