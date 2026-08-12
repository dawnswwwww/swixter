//! REST 端点集成测试（计划 Task 5/6）。
//! 隔离方式：AppState.config_path 注入临时目录（不用进程级 SWIXTER_CONFIG_PATH，避免并行污染）。
use std::path::Path;

use swixter_server::server::state::AppState;

/// 写最小 config.json 到临时目录
fn write_config(dir: &Path, profiles: serde_json::Value, groups: serde_json::Value) {
    std::fs::write(
        dir.join("config.json"),
        serde_json::json!({
            "version": "2.0.0",
            "profiles": profiles,
            "coders": {},
            "groups": groups,
        })
        .to_string(),
    )
    .unwrap();
}

fn profile_json(name: &str, provider_id: &str, api_key: &str) -> serde_json::Value {
    serde_json::json!({
        "name": name,
        "providerId": provider_id,
        "apiKey": api_key,
        "createdAt": "2025-01-01T00:00:00.000Z",
        "updatedAt": "2025-01-01T00:00:00.000Z",
    })
}

async fn spawn_server(dir: &Path) -> String {
    let state = AppState::new(Some(dir.join("config.json")));
    let app = swixter_server::server::routes::router(state);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.ok();
    });
    format!("http://{addr}")
}

#[tokio::test]
async fn profiles_crud_with_masking_and_error_codes() {
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({
            "main": {
                "name": "main",
                "providerId": "ollama",
                "apiKey": "sk-ant-abcdefghij1234567890abcd",
                "authToken": "token-abcdefgh12345678",
                "createdAt": "2025-01-01T00:00:00.000Z",
                "updatedAt": "2025-01-01T00:00:00.000Z",
            }
        }),
        serde_json::json!({}),
    );
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // GET 列表：apiKey/authToken 掩码（首4 + 星号(min(len-8,20)) + 尾4）
    let resp = http
        .get(format!("{base}/api/profiles"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let list: serde_json::Value = resp.json().await.unwrap();
    let p = &list.as_array().unwrap()[0];
    assert_eq!(p["name"], "main");
    let key = "sk-ant-abcdefghij1234567890abcd";
    let expected = format!("sk-a{}abcd", "*".repeat((key.len() - 8).min(20)));
    assert_eq!(p["apiKey"], expected);
    let token = p["authToken"].as_str().unwrap();
    assert!(token.starts_with("toke") && token.ends_with("5678"));
    assert!(token.contains('*'));

    // 长度 ≤ 8 的 key 掩码为 "****"
    let resp = http
        .post(format!("{base}/api/profiles"))
        .json(&serde_json::json!({"name": "shorty", "providerId": "ollama", "apiKey": "short123"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let created: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(created["apiKey"], "****");

    // POST 未知 provider → 400 UNKNOWN_PROVIDER
    let resp = http
        .post(format!("{base}/api/profiles"))
        .json(&serde_json::json!({"name": "x", "providerId": "nope-provider"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "UNKNOWN_PROVIDER");

    // POST 缺 providerId → 400 INVALID_PARAMS
    let resp = http
        .post(format!("{base}/api/profiles"))
        .json(&serde_json::json!({"name": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "INVALID_PARAMS");

    // POST 重名 → 409 PROFILE_EXISTS
    let resp = http
        .post(format!("{base}/api/profiles"))
        .json(&serde_json::json!({"name": "main", "providerId": "ollama"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 409);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "PROFILE_EXISTS");

    // GET 不存在 → 404 PROFILE_NOT_FOUND
    let resp = http
        .get(format!("{base}/api/profiles/ghost"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "PROFILE_NOT_FOUND");

    // PUT：与 existing 合并，name 取 URL 参数（body 里的 name 被忽略）
    let resp = http
        .put(format!("{base}/api/profiles/shorty"))
        .json(&serde_json::json!({"name": "renamed", "model": "m1"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let updated: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(updated["name"], "shorty");
    assert_eq!(updated["model"], "m1");
    // baseURL 默认继承 provider 的 baseURL（POST 时未传 → ollama 的）
    let resp = http
        .get(format!("{base}/api/profiles/shorty"))
        .send()
        .await
        .unwrap();
    let fetched: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(fetched["providerId"], "ollama");

    // DELETE → 200 success
    let resp = http
        .delete(format!("{base}/api/profiles/shorty"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["success"], true);
}

#[tokio::test]
async fn config_etag_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({"p1": profile_json("p1", "ollama", "k-123456789")}),
        serde_json::json!({}),
    );
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    let resp = http.get(format!("{base}/api/config")).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let etag = resp
        .headers()
        .get("etag")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert_eq!(resp.headers().get("cache-control").unwrap(), "no-cache");
    // ETag 格式："<mtime秒>-<size>"
    let inner = etag.trim_matches('"');
    let (secs, size) = inner.split_once('-').expect("etag format");
    assert!(secs.parse::<u64>().is_ok() && size.parse::<u64>().is_ok());
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["exists"], true);
    assert_eq!(body["profiles"][0]["name"], "p1");
    assert_eq!(body["etag"], etag);

    // If-None-Match 匹配 → 304 空体
    let resp = http
        .get(format!("{base}/api/config"))
        .header("if-none-match", &etag)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 304);
}

#[tokio::test]
async fn providers_user_only_mutation() {
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), serde_json::json!({}), serde_json::json!({}));
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // GET：内置 preset 带 isUser=false
    let resp = http
        .get(format!("{base}/api/providers"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let list: serde_json::Value = resp.json().await.unwrap();
    let ollama = list
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "ollama")
        .unwrap();
    assert_eq!(ollama["isUser"], false);

    // PUT 内置 preset → 400 NOT_USER_PROVIDER
    let resp = http
        .put(format!("{base}/api/providers/ollama"))
        .json(&serde_json::json!({"displayName": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "NOT_USER_PROVIDER");

    // POST 重复 id（与内置冲突）→ 409 PROVIDER_EXISTS
    let resp = http
        .post(format!("{base}/api/providers"))
        .json(&serde_json::json!({"id": "ollama", "name": "o", "displayName": "O"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 409);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "PROVIDER_EXISTS");

    // POST 缺字段 → 400 INVALID_PARAMS
    let resp = http
        .post(format!("{base}/api/providers"))
        .json(&serde_json::json!({"id": "my-prov"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);

    // POST 正常创建 → 201 isUser=true
    let resp = http
        .post(format!("{base}/api/providers"))
        .json(&serde_json::json!({
            "id": "my-prov", "name": "my-prov", "displayName": "My Prov",
            "baseURL": "https://api.example.com",
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let created: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(created["isUser"], true);

    // PUT 用户 provider → 200
    let resp = http
        .put(format!("{base}/api/providers/my-prov"))
        .json(&serde_json::json!({"displayName": "Renamed"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let updated: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(updated["displayName"], "Renamed");
    assert_eq!(updated["id"], "my-prov");

    // DELETE 内置 → 400 NOT_USER_PROVIDER；DELETE 用户 → 200
    let resp = http
        .delete(format!("{base}/api/providers/ollama"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let resp = http
        .delete(format!("{base}/api/providers/my-prov"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn coders_apply_wire_api_warning_and_unknown_coder() {
    let dir = tempfile::tempdir().unwrap();
    // anthropic 是 responses wire_api；codex 只支持 chat → 不兼容
    write_config(
        dir.path(),
        serde_json::json!({"p1": profile_json("p1", "anthropic", "sk-ant-abcdefgh1234")}),
        serde_json::json!({}),
    );
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // 列表包含三个 coder，含 wireApi 与 activeProfile=null
    let resp = http.get(format!("{base}/api/coders")).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let coders: serde_json::Value = resp.json().await.unwrap();
    let arr = coders.as_array().unwrap();
    assert_eq!(arr.len(), 3);
    let claude = arr.iter().find(|c| c["id"] == "claude").unwrap();
    assert_eq!(claude["wireApi"], "both");
    assert_eq!(claude["displayName"], "Claude Code");
    assert!(claude["activeProfile"].is_null());

    // 未知 coder → 404 UNKNOWN_CODER
    let resp = http
        .get(format!("{base}/api/coders/nope/active"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "UNKNOWN_CODER");

    // 无 active profile 时 apply → 400 NO_ACTIVE_PROFILE
    let resp = http
        .post(format!("{base}/api/coders/codex/apply"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "NO_ACTIVE_PROFILE");

    // 设置 active → GET active 返回掩码后的 profile
    let resp = http
        .put(format!("{base}/api/coders/codex/active"))
        .json(&serde_json::json!({"profileName": "p1"}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["activeProfile"]["name"], "p1");
    assert_eq!(v["activeProfile"]["apiKey"], "sk-a***********1234"); // 19 字符 → 11 星号

    // apply：wire_api 不兼容 → 200 {success:false, warning:true}
    let resp = http
        .post(format!("{base}/api/coders/codex/apply"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["success"], false);
    assert_eq!(v["warning"], true);
}

#[tokio::test]
async fn version_endpoint_for_daemon_healthcheck() {
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), serde_json::json!({}), serde_json::json!({}));
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!("{base}/api/version"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = resp.json().await.unwrap();
    assert!(v["appVersion"].as_str().unwrap().contains('.'));
    assert_eq!(v["configVersion"], "2.0.0");
    assert_eq!(v["exportVersion"], "1.0.0");
}

#[tokio::test]
async fn cors_only_allows_localhost_origins() {
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), serde_json::json!({}), serde_json::json!({}));
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // 本机 origin：OPTIONS → 204 + 回显 origin + Max-Age 86400
    let resp = http
        .request(reqwest::Method::OPTIONS, format!("{base}/api/profiles"))
        .header("origin", "http://localhost:3000")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 204);
    assert_eq!(
        resp.headers().get("access-control-allow-origin").unwrap(),
        "http://localhost:3000"
    );
    assert_eq!(
        resp.headers().get("access-control-max-age").unwrap(),
        "86400"
    );

    // 127.0.0.1 origin 普通请求也回显
    let resp = http
        .get(format!("{base}/api/version"))
        .header("origin", "http://127.0.0.1:8080")
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.headers().get("access-control-allow-origin").unwrap(),
        "http://127.0.0.1:8080"
    );

    // 非本机 origin：不带 CORS 头（不报错）
    let resp = http
        .get(format!("{base}/api/version"))
        .header("origin", "https://evil.example.com")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert!(resp.headers().get("access-control-allow-origin").is_none());

    // 前缀绕过 origin：host 精确匹配，必须无 CORS 头
    for evil in [
        "http://127.0.0.1.evil.com",
        "http://localhost.evil.com",
        "https://127.0.0.1:3141",
    ] {
        let resp = http
            .get(format!("{base}/api/version"))
            .header("origin", evil)
            .send()
            .await
            .unwrap();
        assert!(
            resp.headers().get("access-control-allow-origin").is_none(),
            "origin {evil} 不应被放行"
        );
    }

    // 任意端口的本机 origin 放行
    for good in ["http://127.0.0.1:3141", "http://localhost:8080"] {
        let resp = http
            .get(format!("{base}/api/version"))
            .header("origin", good)
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.headers().get("access-control-allow-origin").unwrap(),
            good
        );
    }
}

#[tokio::test]
async fn groups_crud_and_set_active() {
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({"p1": profile_json("p1", "ollama", "k-123456789")}),
        serde_json::json!({}),
    );
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // POST 缺 name → 400 INVALID_PARAMS
    let resp = http
        .post(format!("{base}/api/groups"))
        .json(&serde_json::json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);

    // POST 创建 → 201
    let resp = http
        .post(format!("{base}/api/groups"))
        .json(&serde_json::json!({"name": "g1", "profiles": ["p1"]}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let group: serde_json::Value = resp.json().await.unwrap();
    let gid = group["id"].as_str().unwrap().to_string();
    assert!(gid.starts_with("grp_"));

    // GET 列表附 profileDetails
    let resp = http.get(format!("{base}/api/groups")).send().await.unwrap();
    let list: serde_json::Value = resp.json().await.unwrap();
    let g = &list.as_array().unwrap()[0];
    assert_eq!(g["profileDetails"][0]["name"], "p1");
    assert_eq!(g["profileDetails"][0]["providerId"], "ollama");

    // GET /:id
    let resp = http
        .get(format!("{base}/api/groups/{gid}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let resp = http
        .get(format!("{base}/api/groups/grp_nope"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "GROUP_NOT_FOUND");

    // PUT /:id/active → 200 返回激活 group
    let resp = http
        .put(format!("{base}/api/groups/{gid}/active"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let active: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(active["id"], gid);

    // DELETE → 200；再 GET → 404
    let resp = http
        .delete(format!("{base}/api/groups/{gid}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let resp = http
        .delete(format!("{base}/api/groups/{gid}"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 404);
}

// ---- Task 6 追加：proxy 端点 + 静态 SPA ----

#[tokio::test]
async fn proxy_logs_parsed_ndjson_latest_first() {
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), serde_json::json!({}), serde_json::json!({}));
    let _guard = swixter_proxy::logger::LogPathOverride::set(dir.path().to_path_buf());
    // 3 条合法 + 1 条坏行（坏行应被跳过但计入 total）
    std::fs::write(
        dir.path().join("proxy-default.log"),
        concat!(
            r#"{"ts":"t1","level":"info","msg":"first"}"#,
            "\n",
            r#"{"ts":"t2","level":"info","msg":"second"}"#,
            "\n",
            "not-json\n",
            r#"{"ts":"t3","level":"info","msg":"third"}"#,
            "\n",
        ),
    )
    .unwrap();
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // lines=3 → tail 覆盖坏行（跳过）+ 2 条合法行，最新在前
    // （TS 同款语义：先 tail 后解析，坏行占 tail 名额）
    let resp = http
        .get(format!("{base}/api/proxy/logs?lines=3"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["instanceId"], "default");
    assert_eq!(v["total"], 4); // 非空行总数（含坏行）
    let lines = v["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0]["msg"], "third");
    assert_eq!(lines[1]["msg"], "second");

    // 默认 200 行 → 全部 3 条合法行，最新在前
    let resp = http
        .get(format!("{base}/api/proxy/logs"))
        .send()
        .await
        .unwrap();
    let v: serde_json::Value = resp.json().await.unwrap();
    let lines = v["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0]["msg"], "third");
    assert_eq!(lines[2]["msg"], "first");

    // 日志文件不存在 → 空结果
    let resp = http
        .get(format!("{base}/api/proxy/logs?instanceId=ghost"))
        .send()
        .await
        .unwrap();
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["lines"].as_array().unwrap().len(), 0);
    assert_eq!(v["total"], 0);
}

#[tokio::test]
async fn proxy_status_and_instances_enriched() {
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({
            "p1": {
                "name": "p1", "providerId": "ollama", "apiKey": "k-123456789",
                "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z",
            }
        }),
        serde_json::json!({
            "g1": {
                "id": "g1", "name": "main", "profiles": ["p1"], "isDefault": false,
                "createdAt": "2025-01-01T00:00:00.000Z", "updatedAt": "2025-01-01T00:00:00.000Z",
            }
        }),
    );
    // activeGroup 写盘
    let mut cfg: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("config.json")).unwrap())
            .unwrap();
    cfg["activeGroup"] = "g1".into();
    std::fs::write(dir.path().join("config.json"), cfg.to_string()).unwrap();

    let _guard =
        swixter_proxy::registry::RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
    swixter_proxy::registry::update_instance(&swixter_proxy::types::ProxyStatus {
        instance_id: "default".into(),
        kind: swixter_proxy::types::InstanceKind::Service,
        running: true,
        host: "127.0.0.1".into(),
        port: 15721,
        pid: Some(std::process::id()),
        ..Default::default()
    });
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    let resp = http
        .get(format!("{base}/api/proxy/status"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let v: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(v["instanceId"], "default");
    assert_eq!(v["running"], true);
    assert_eq!(v["activeGroupName"], "main");

    let resp = http
        .get(format!("{base}/api/proxy/instances"))
        .send()
        .await
        .unwrap();
    let list: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["activeGroupName"], "main");
}

#[tokio::test]
async fn static_spa_fallback_and_mime() {
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), serde_json::json!({}), serde_json::json!({}));
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // GET / → 200 text/html
    let resp = http.get(format!("{base}/")).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let ct = resp
        .headers()
        .get("content-type")
        .unwrap()
        .to_str()
        .unwrap()
        .to_string();
    assert!(ct.starts_with("text/html"), "content-type: {ct}");
    let index_html = resp.text().await.unwrap();
    assert!(index_html.to_lowercase().contains("<html"));

    // SPA 回退：未命中路径 → index.html
    let resp = http
        .get(format!("{base}/no/such/route"))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.text().await.unwrap(), index_html);

    // 已知静态资源 MIME（vite.svg 恒存在于 ui_dist）
    let resp = http.get(format!("{base}/vite.svg")).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    assert_eq!(resp.headers().get("content-type").unwrap(), "image/svg+xml");

    // ui_dist 里若有 js 资产，断言 javascript MIME
    let assets_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/ui_dist/assets");
    if let Some(js) = std::fs::read_dir(assets_dir).ok().and_then(|mut it| {
        it.find_map(|e| {
            let name = e.ok()?.file_name().to_string_lossy().into_owned();
            name.ends_with(".js").then_some(name)
        })
    }) {
        let resp = http
            .get(format!("{base}/assets/{js}"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let ct = resp
            .headers()
            .get("content-type")
            .unwrap()
            .to_str()
            .unwrap()
            .to_string();
        assert!(ct.contains("javascript"), "content-type: {ct}");
    }

    // /api/ 前缀不落入静态：未匹配的 api 路径 → 404（非 index.html）
    let resp = http.get(format!("{base}/api/nope")).send().await.unwrap();
    assert_eq!(resp.status(), 404);
}

// ---- 评审修复追加：baseURL 空串回退 / isDefault:false / 畸形 JSON 信封 ----

#[tokio::test]
async fn create_profile_blank_base_url_falls_back_to_provider() {
    // TS createProfile `body.baseURL || provider.baseURL`：空串视为未提供
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), serde_json::json!({}), serde_json::json!({}));
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    let resp = http
        .post(format!("{base}/api/profiles"))
        .json(&serde_json::json!({"name": "blank", "providerId": "ollama", "baseURL": ""}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let created: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(created["baseURL"], "http://localhost:11434"); // ollama 默认

    // 落盘值同样回退（非空串）
    let cfg: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("config.json")).unwrap())
            .unwrap();
    assert_eq!(
        cfg["profiles"]["blank"]["baseURL"],
        "http://localhost:11434"
    );
}

#[tokio::test]
async fn groups_update_is_default_false_clears_default() {
    // TS updateGroup：显式 isDefault:false 仅取消本组默认，不动 activeGroup
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({"p1": profile_json("p1", "ollama", "k-123456789")}),
        serde_json::json!({}),
    );
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // g1 创建即默认；g2 非默认
    let resp = http
        .post(format!("{base}/api/groups"))
        .json(&serde_json::json!({"name": "g1", "profiles": ["p1"], "isDefault": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 201);
    let g1: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(g1["isDefault"], true);
    let g1id = g1["id"].as_str().unwrap().to_string();
    let resp = http
        .post(format!("{base}/api/groups"))
        .json(&serde_json::json!({"name": "g2", "profiles": ["p1"]}))
        .send()
        .await
        .unwrap();
    let g2: serde_json::Value = resp.json().await.unwrap();
    let g2id = g2["id"].as_str().unwrap().to_string();

    // 显式 isDefault:false → 取消 g1 默认；g2 不受影响；activeGroup 不变
    let resp = http
        .put(format!("{base}/api/groups/{g1id}"))
        .json(&serde_json::json!({"isDefault": false}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let updated: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(updated["isDefault"], false);
    let cfg: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("config.json")).unwrap())
            .unwrap();
    assert_eq!(cfg["groups"][&g1id]["isDefault"], false);
    assert_eq!(cfg["groups"][&g2id]["isDefault"], false);
    assert_eq!(cfg["activeGroup"], g1id); // 取消默认不动 activeGroup

    // isDefault:true 互斥语义不回归：g2 设默认后 g1 非默认
    let resp = http
        .put(format!("{base}/api/groups/{g2id}"))
        .json(&serde_json::json!({"isDefault": true}))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let cfg: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(dir.path().join("config.json")).unwrap())
            .unwrap();
    assert_eq!(cfg["groups"][&g2id]["isDefault"], true);
    assert_eq!(cfg["groups"][&g1id]["isDefault"], false);
}

#[tokio::test]
async fn malformed_json_returns_ts_error_envelope() {
    // TS jsonBodyMiddleware 解析失败 → router finalize → sendError(Error, 500)
    let dir = tempfile::tempdir().unwrap();
    write_config(dir.path(), serde_json::json!({}), serde_json::json!({}));
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    let resp = http
        .post(format!("{base}/api/profiles"))
        .header("content-type", "application/json")
        .body("{not json")
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 500);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "UNKNOWN_ERROR");
    assert_eq!(err["error"]["message"], "Invalid JSON body");
}

#[tokio::test]
async fn non_json_content_type_is_treated_as_absent_body() {
    // TS jsonBodyMiddleware：非 application/json 不解析 body，由 handler 判缺参
    let dir = tempfile::tempdir().unwrap();
    write_config(
        dir.path(),
        serde_json::json!({"p1": profile_json("p1", "ollama", "k-123456789")}),
        serde_json::json!({}),
    );
    let base = spawn_server(dir.path()).await;
    let http = reqwest::Client::new();

    // POST create：body 被忽略 → 400 INVALID_PARAMS（TS 同款）
    let resp = http
        .post(format!("{base}/api/profiles"))
        .header("content-type", "text/plain")
        .body(r#"{"name":"x","providerId":"ollama"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
    let err: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(err["error"]["code"], "INVALID_PARAMS");

    // PUT update：body 被忽略 → {...existing} 无变化成功（TS 同款）
    let resp = http
        .put(format!("{base}/api/profiles/p1"))
        .header("content-type", "text/plain")
        .body(r#"{"model":"should-not-stick"}"#)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let updated: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(updated["name"], "p1");
    assert!(updated["model"].is_null());
}
