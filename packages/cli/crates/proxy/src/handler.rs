use bytes::Bytes;
use reqwest::header::HeaderMap;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use futures::Stream;
use serde_json::{json, Value};
use std::pin::Pin;
use swixter_core::config::ConfigManager;
use swixter_core::types::{Group, Profile};

use crate::breaker::CircuitBreaker;
use crate::forwarder::{ForwardBody, ForwardRequest, Forwarder};
use crate::logger::ProxyLogger;
use crate::transform;
use crate::types::{ProxyServerConfig, ProxyStatus};
use crate::SWIXTER_PROXY_AUTH_TOKEN;

pub enum HandlerBody {
    Full(Bytes),
    Stream(Pin<Box<dyn Stream<Item = Result<Bytes, std::io::Error>> + Send>>),
}

pub struct HandlerResponse {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: HandlerBody,
}

impl HandlerResponse {
    fn json(status: u16, body: Value) -> Self {
        let mut headers = HeaderMap::new();
        headers.insert("content-type", "application/json".parse().unwrap());
        Self {
            status,
            headers,
            body: HandlerBody::Full(Bytes::from(serde_json::to_vec(&body).unwrap())),
        }
    }

    fn text(status: u16, body: &'static str) -> Self {
        Self {
            status,
            headers: HeaderMap::new(),
            body: HandlerBody::Full(Bytes::from(body)),
        }
    }
}

/// 框架无关的请求处理器（决策点 6）：鉴权 + 路由 + 单 profile/group 故障转移。
/// 默认超时值在 CLI 层解析（ProxyServerConfig.timeout 总是具体值），这里不做 Option 处理。
pub struct ProxyHandler {
    timeout: Duration,
    instance_id: String,
    group_name: Option<String>,
    profile_name: Option<String>,
    config_path: Option<std::path::PathBuf>,
    breaker: CircuitBreaker,
    forwarder: Forwarder,
    logger: ProxyLogger,
    started: Instant,
    status: Arc<RwLock<ProxyStatus>>,
}

impl ProxyHandler {
    pub fn new(config: &ProxyServerConfig) -> Self {
        Self {
            timeout: config.timeout,
            instance_id: config.instance_id.clone(),
            group_name: config.group_name.clone(),
            profile_name: config.profile_name.clone(),
            config_path: config.config_path.clone(),
            breaker: CircuitBreaker::new(),
            forwarder: Forwarder::new(),
            logger: ProxyLogger::new(&config.instance_id),
            started: Instant::now(),
            status: Arc::new(RwLock::new(ProxyStatus {
                instance_id: config.instance_id.clone(),
                kind: config.kind,
                running: true,
                host: config.host.clone(),
                port: config.port,
                group_name: config.group_name.clone(),
                active_group: config.group_name.clone(),
                profile_name: config.profile_name.clone(),
                pid: Some(std::process::id()),
                start_time: Some(swixter_core::types::now_iso()),
                ..Default::default()
            })),
        }
    }

    pub fn status(&self) -> Arc<RwLock<ProxyStatus>> {
        self.status.clone()
    }

    fn load_config(&self) -> ConfigManager {
        match &self.config_path {
            Some(p) => ConfigManager::load_from(p.clone()),
            None => ConfigManager::load(),
        }
    }

    /// TS: ProxyHandler.handleRequest（鉴权 + 路由 + access 日志 + 计数）
    pub async fn handle(
        &self,
        method: &str,
        path_and_query: &str,
        headers: &HeaderMap,
        body: &Bytes,
    ) -> HandlerResponse {
        let start = Instant::now();
        let path = path_and_query.split('?').next().unwrap_or(path_and_query);

        let resp = self
            .handle_inner(method, path, path_and_query, headers, body)
            .await;
        let ms = start.elapsed().as_millis() as u64;
        self.logger.request(method, path, resp.status, ms);
        {
            let mut s = self.status.write().unwrap();
            s.request_count += 1;
            if resp.status >= 500 {
                s.error_count += 1;
            }
        }
        let _ = crate::events::event_bus().send(crate::events::ProxyEvent::StatusUpdate(
            self.status.read().unwrap().clone(),
        ));
        resp
    }

    async fn handle_inner(
        &self,
        method: &str,
        path: &str,
        path_and_query: &str,
        headers: &HeaderMap,
        body: &Bytes,
    ) -> HandlerResponse {
        // 鉴权：除 /health 外必须 Bearer swixter-local-proxy
        if path != "/health" {
            let ok = headers
                .get("authorization")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.strip_prefix("Bearer "))
                == Some(SWIXTER_PROXY_AUTH_TOKEN);
            if !ok {
                return HandlerResponse::json(
                    401,
                    json!({"error": "Invalid or missing proxy authentication"}),
                );
            }
        }

        if method == "GET" && path == "/health" {
            return HandlerResponse::json(
                200,
                json!({
                    "status": "ok",
                    "instanceId": self.instance_id,
                    "groupName": self.group_name,
                    "timestamp": swixter_core::types::now_iso(),
                    "uptime": self.started.elapsed().as_secs_f64(),
                }),
            );
        }

        // 路由（事实表 §端点 注册顺序；/anthropic/* 任意方法）；未匹配 404 纯文本
        let is_api_route = matches!(
            (method, path),
            ("POST", "/v1/chat/completions") | ("POST", "/v1/messages") | ("POST", "/v1/responses")
        ) || path.starts_with("/anthropic/");
        if !is_api_route {
            return HandlerResponse::text(404, "Not Found");
        }

        // 单 profile / group 分发（TS forwardToProvider；死参数 format 不保留）
        if let Some(profile_name) = &self.profile_name {
            return self
                .forward_single_profile(method, path_and_query, headers, body, profile_name)
                .await;
        }
        self.forward_group(method, path_and_query, headers, body)
            .await
    }

    /// TS: getGroup(idOrName) —— 先按 id 再按 name
    fn find_group<'a>(&self, mgr: &'a ConfigManager, id_or_name: &str) -> Option<&'a Group> {
        mgr.config()
            .groups
            .get(id_or_name)
            .or_else(|| mgr.config().groups.values().find(|g| g.name == id_or_name))
    }

    async fn forward_single_profile(
        &self,
        method: &str,
        endpoint: &str,
        headers: &HeaderMap,
        body: &Bytes,
        profile_name: &str,
    ) -> HandlerResponse {
        let mgr = self.load_config();
        let Some(profile) = mgr.get_profile(profile_name).cloned() else {
            self.logger.warn(
                "Profile not found",
                Some(json!({"profileName": profile_name})),
            );
            return HandlerResponse::json(
                503,
                json!({"error": format!("Profile not found: {profile_name}")}),
            );
        };
        match self
            .try_profile(method, endpoint, headers, body, &profile)
            .await
        {
            TryOutcome::Success(resp) => resp,
            TryOutcome::Upstream(resp) => resp, // 非 2xx 原样返回，无转移
            TryOutcome::Error(e) => {
                self.logger.error(
                    "Provider request failed",
                    Some(&e),
                    Some(json!({"profileName": profile_name})),
                );
                HandlerResponse::json(502, json!({"error": e.to_string()}))
            }
        }
    }

    /// TS: forwardGroup —— groupName 指定或 activeGroup；body 读一次复用（调用方传入 &Bytes）
    async fn forward_group(
        &self,
        method: &str,
        endpoint: &str,
        headers: &HeaderMap,
        body: &Bytes,
    ) -> HandlerResponse {
        let mgr = self.load_config();
        let group = match &self.group_name {
            Some(name) => self.find_group(&mgr, name),
            None => mgr
                .config()
                .active_group
                .as_ref()
                .and_then(|id| mgr.config().groups.get(id)),
        };
        let Some(group) = group.filter(|g| !g.profiles.is_empty()).cloned() else {
            self.logger.warn("No active group or profiles", None);
            return HandlerResponse::json(503, json!({"error": "No active group or profiles"}));
        };

        let mut errors: Vec<String> = Vec::new();
        let mut last_failure: Option<HandlerResponse> = None;

        for profile_id in &group.profiles {
            // ① 熔断 open 跳过
            if !self.breaker.is_available(profile_id) {
                self.logger.info(
                    "Skipping unavailable provider",
                    Some(json!({"profileId": profile_id})),
                );
                continue;
            }
            // ② profile 不存在跳过
            let Some(profile) = mgr.get_profile(profile_id).cloned() else {
                self.logger
                    .warn("Profile not found", Some(json!({"profileId": profile_id})));
                continue;
            };
            // ③ 格式不同且无注册转换器跳过
            let client_format = transform::infer_client_format(endpoint);
            let preset = swixter_core::presets::find_provider(&profile.provider_id);
            let target_format = transform::infer_target_api_format(&profile, preset.as_ref());
            if client_format != target_format
                && !transform::has_transformer(client_format, target_format)
            {
                self.logger.info(
                    "Skipping provider: no transformer for format pair",
                    Some(json!({"profileId": profile_id})),
                );
                continue;
            }
            // ④-⑥ transform + model 改写 + 转发
            match self
                .try_profile(method, endpoint, headers, body, &profile)
                .await
            {
                TryOutcome::Success(resp) => {
                    self.breaker.record_success(profile_id);
                    return resp;
                }
                TryOutcome::Upstream(resp) => {
                    // 5xx/429 计入熔断；其余非 2xx 只转移
                    if resp.status >= 500 || resp.status == 429 {
                        self.breaker.record_failure(profile_id);
                    }
                    errors.push(format!("{profile_id}: upstream returned {}", resp.status));
                    self.logger.warn(
                        "Provider returned upstream status",
                        Some(
                            json!({"profileId": profile_id, "status": resp.status, "fallback": true}),
                        ),
                    );
                    last_failure = Some(resp);
                }
                TryOutcome::Error(e) => {
                    self.breaker.record_failure(profile_id);
                    errors.push(format!("{profile_id}: {e}"));
                    self.logger.error(
                        "Provider request failed",
                        Some(&e),
                        Some(json!({"profileId": profile_id})),
                    );
                }
            }
        }

        self.logger.error(
            "All providers failed",
            None,
            Some(json!({"errors": errors})),
        );
        match last_failure {
            Some(resp) => resp, // 回传最后一个上游失败响应
            None => HandlerResponse::json(
                503,
                json!({"error": "All providers failed", "details": errors}),
            ),
        }
    }

    /// 单次 profile 尝试：④ transform 请求（失败回退透传原 body+原 endpoint）
    /// → ⑤ model 改写 → ⑥ 转发 → 2xx 时响应 transform（失败回退原始 body）
    async fn try_profile(
        &self,
        method: &str,
        endpoint: &str,
        headers: &HeaderMap,
        body: &Bytes,
        profile: &Profile,
    ) -> TryOutcome {
        let preset = swixter_core::presets::find_provider(&profile.provider_id);
        let client_format = transform::infer_client_format(endpoint);
        let target_format = transform::infer_target_api_format(profile, preset.as_ref());

        let mut target_endpoint = endpoint.to_string();
        let mut eff_body = body.clone();
        let mut ctx: Option<transform::TransformCtx> = None;

        if client_format != target_format {
            let parsed: Value = if body.is_empty() {
                json!({})
            } else {
                match serde_json::from_slice(body) {
                    Ok(v) => v,
                    Err(_) => json!({}),
                }
            };
            let c = transform::TransformCtx {
                endpoint: endpoint.to_string(),
                client_format,
                target_format,
                stream: parsed.get("stream").and_then(Value::as_bool) == Some(true),
            };
            match transform::transform_request(&parsed, &c) {
                Ok(t) => {
                    eff_body = Bytes::from(serde_json::to_vec(&t.body).unwrap());
                    target_endpoint = t.target_endpoint;
                    ctx = Some(c);
                }
                Err(e) => {
                    // transform 失败回退透传原 body + 原 endpoint（事实表 §Group 故障转移 ④）
                    self.logger.error(
                        "Request transform failed, falling back to passthrough",
                        Some(&e),
                        None,
                    );
                }
            }
        }

        // ⑤ model 改写
        let eff_body = crate::model::rewrite_request_body_for_profile(&eff_body, profile);

        let fwd = ForwardRequest {
            method: method.to_string(),
            path: target_endpoint,
            headers: headers.clone(),
            body: eff_body,
        };
        let resp = match self
            .forwarder
            .forward(fwd, profile, preset.as_ref(), self.timeout, target_format)
            .await
        {
            Ok(r) => r,
            Err(e) => return TryOutcome::Error(e),
        };
        if !(200..300).contains(&resp.status) {
            return TryOutcome::Upstream(into_handler_response(resp));
        }

        // 2xx：需要时响应 transform（失败回退原始 body）
        match (ctx, resp.is_stream) {
            (Some(c), true) => {
                let ForwardBody::Stream(stream) = resp.body else {
                    unreachable!()
                };
                let transformed = transform::transform_stream(stream, &c);
                TryOutcome::Success(HandlerResponse {
                    status: resp.status,
                    headers: resp.headers,
                    body: HandlerBody::Stream(transformed),
                })
            }
            (Some(c), false) => {
                let ForwardBody::Full(bytes) = resp.body else {
                    unreachable!()
                };
                let parsed: Value = if bytes.is_empty() {
                    json!({})
                } else {
                    match serde_json::from_slice(&bytes) {
                        Ok(v) => v,
                        Err(_) => json!({}),
                    }
                };
                match transform::transform_response(&parsed, &c) {
                    Ok(v) => TryOutcome::Success(HandlerResponse {
                        status: resp.status,
                        headers: resp.headers,
                        body: HandlerBody::Full(Bytes::from(serde_json::to_vec(&v).unwrap())),
                    }),
                    Err(e) => {
                        self.logger.error(
                            "Response transform failed, returning raw response",
                            Some(&e),
                            None,
                        );
                        TryOutcome::Success(HandlerResponse {
                            status: resp.status,
                            headers: resp.headers,
                            body: HandlerBody::Full(bytes),
                        })
                    }
                }
            }
            (None, true) => {
                let ForwardBody::Stream(stream) = resp.body else {
                    unreachable!()
                };
                let mapped = futures::StreamExt::map(stream, |r| r.map_err(std::io::Error::other));
                TryOutcome::Success(HandlerResponse {
                    status: resp.status,
                    headers: resp.headers,
                    body: HandlerBody::Stream(Box::pin(mapped)),
                })
            }
            (None, false) => TryOutcome::Success(into_handler_response(resp)),
        }
    }
}

enum TryOutcome {
    Success(HandlerResponse),
    Upstream(HandlerResponse), // 非 2xx 上游响应
    Error(crate::ProxyError),  // 网络异常
}

fn into_handler_response(resp: crate::forwarder::ForwardResponse) -> HandlerResponse {
    match resp.body {
        ForwardBody::Full(b) => HandlerResponse {
            status: resp.status,
            headers: resp.headers,
            body: HandlerBody::Full(b),
        },
        ForwardBody::Stream(s) => {
            let mapped = futures::StreamExt::map(s, |r| r.map_err(std::io::Error::other));
            HandlerResponse {
                status: resp.status,
                headers: resp.headers,
                body: HandlerBody::Stream(Box::pin(mapped)),
            }
        }
    }
}
