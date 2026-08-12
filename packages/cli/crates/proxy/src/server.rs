use std::sync::{Arc, OnceLock, RwLock};

use axum::{
    body::Body,
    extract::{Request, State},
    response::Response,
    Router,
};
use dashmap::DashMap;
use tokio::sync::oneshot;

use crate::events::{event_bus, ProxyEvent};
use crate::handler::{HandlerBody, ProxyHandler};
use crate::registry;
use crate::types::{ProxyServerConfig, ProxyStatus};
use crate::ProxyError;

struct RunningInstance {
    #[allow(dead_code)] // Task 10 status 命令读取进程内状态（优先于 registry）
    status: Arc<RwLock<ProxyStatus>>,
    shutdown: oneshot::Sender<()>,
}

/// 进程内实例表（对齐 TS servers/statuses map；status/list 时优先于 registry）
static INSTANCES: OnceLock<DashMap<String, RunningInstance>> = OnceLock::new();

fn instances() -> &'static DashMap<String, RunningInstance> {
    INSTANCES.get_or_init(DashMap::new)
}

/// axum 薄适配层：只做 请求/响应 类型转换，全部逻辑在 ProxyHandler。
/// 复制上游 headers 时跳过 content-length —— transform 会改变 body 长度，
/// 流式响应由 hyper 自行 chunked。
/// content-encoding 也必须剔除：reqwest 自动解压后仍保留该头，
/// 不剔会导致客户端对已是明文的 body 再 gunzip；
/// connection/transfer-encoding 属 hop-by-hop 头，同样不能转发。
async fn dispatch(State(h): State<Arc<ProxyHandler>>, req: Request) -> Response {
    let method = req.method().to_string();
    let path = req.uri().path().to_string()
        + req
            .uri()
            .query()
            .map(|q| format!("?{q}"))
            .as_deref()
            .unwrap_or("");
    let headers = req.headers().clone();
    let body = match axum::body::to_bytes(req.into_body(), usize::MAX).await {
        Ok(b) => b,
        Err(_) => {
            // 事实表 §端点：body 读取失败 400
            return Response::builder()
                .status(400)
                .body(Body::from("Failed to read request body"))
                .unwrap();
        }
    };
    let resp = h.handle(&method, &path, &headers, &body).await;
    let mut builder = Response::builder().status(resp.status);
    for (k, v) in resp.headers.iter() {
        if matches!(
            k.as_str(),
            "content-length" | "content-encoding" | "connection" | "transfer-encoding"
        ) {
            continue;
        }
        builder = builder.header(k, v);
    }
    let body = match resp.body {
        HandlerBody::Full(b) => Body::from(b),
        HandlerBody::Stream(s) => Body::from_stream(s),
    };
    builder.body(body).unwrap()
}

pub async fn start_proxy_server(mut config: ProxyServerConfig) -> Result<ProxyStatus, ProxyError> {
    // 端口被其他运行中实例占用 → 报错（TS startProxyServer 检查）
    let occupied = registry::list_proxy_instances()
        .into_iter()
        .any(|s| s.running && s.port == config.port && s.instance_id != config.instance_id);
    if occupied {
        return Err(ProxyError::AddrInUse(format!(
            "Port {} already in use",
            config.port
        )));
    }

    let handler = Arc::new(ProxyHandler::new(&config));
    let status = handler.status();
    let app = Router::new().fallback(dispatch).with_state(handler);

    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port)).await?;
    config.port = listener.local_addr()?.port(); // port 0 → 实际端口

    let (tx, rx) = oneshot::channel::<()>();
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                rx.await.ok();
            })
            .await
            .ok();
    });

    {
        let mut s = status.write().unwrap();
        s.port = config.port;
        registry::update_instance(&s);
        let _ = event_bus().send(ProxyEvent::InstanceStart(s.clone()));
    }
    instances().insert(
        config.instance_id.clone(),
        RunningInstance {
            status: status.clone(),
            shutdown: tx,
        },
    );
    let snapshot = status.read().unwrap().clone();
    Ok(snapshot)
}

/// 停止本进程内实例；返回是否真的停了（CLI stop 的跨进程 kill 在 Task 10）
pub async fn stop_in_process_instance(instance_id: &str) -> bool {
    let Some((_, inst)) = instances().remove(instance_id) else {
        return false;
    };
    let _ = inst.shutdown.send(());
    registry::remove_instance(instance_id);
    let _ = event_bus().send(ProxyEvent::InstanceStop(instance_id.to_string()));
    true
}

/// CLI daemon 启动后轮询用
pub async fn health_check(host: &str, port: u16) -> bool {
    let url = format!("http://{host}:{port}/health");
    matches!(
        reqwest::Client::new()
            .get(&url)
            .timeout(std::time::Duration::from_millis(500))
            .send()
            .await,
        Ok(r) if r.status().is_success()
    )
}
