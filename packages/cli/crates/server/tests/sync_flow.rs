mod common;
use common::MockCloud;
use swixter_core::config::ConfigManager;
use swixter_core::types::SyncMeta;
use swixter_server::crypto::encrypt::decrypt;
use swixter_server::sync::{client::SyncClient, flow::*, merge::*, types::*};
use swixter_server::ServerError;

const KEY: [u8; 32] = [7u8; 32];

fn meta(cv: u64, pv: u64) -> SyncMeta {
    SyncMeta {
        last_sync_at: "t".into(),
        config_version: cv,
        providers_version: pv,
        local_updated_at: "t".into(),
        dirty: None,
    }
}

fn remote(v: u64) -> Vec<SyncStatusEntry> {
    vec![SyncStatusEntry {
        data_key: "config".into(),
        data_version: v,
        updated_at: "t".into(),
    }]
}

#[test]
fn detect_conflict_matrix() {
    let m = |cv: u64| meta(cv, 0);
    assert!(detect_conflict(Some(&m(3)), &remote(3), "config").is_none()); // 相等
    assert!(detect_conflict(Some(&m(0)), &remote(3), "config").is_none()); // local 0
    assert!(detect_conflict(Some(&m(3)), &remote(0), "config").is_none()); // remote 0
    assert!(detect_conflict(None, &remote(3), "config").is_none()); // 无 meta
    let c = detect_conflict(Some(&m(3)), &remote(5), "config").unwrap();
    assert_eq!((c.local_version, c.remote_version), (3, 5));
    // providers 走 providersVersion 字段
    assert!(detect_conflict(Some(&m(3)), &remote(9), "providers").is_none()); // providersVersion=0
}

// ---------- 测试辅助 ----------

fn profile_json(name: &str, api_key: &str, auth_token: Option<&str>) -> serde_json::Value {
    let mut p = serde_json::json!({
        "name": name,
        "providerId": "ollama",
        "apiKey": api_key,
        "createdAt": "2025-01-01T00:00:00.000Z",
        "updatedAt": "2025-01-01T00:00:00.000Z"
    });
    if let Some(t) = auth_token {
        p["authToken"] = t.into();
    }
    p
}

/// 写 config.json（2 个 profile + syncMeta）与 providers.json（1 个 user provider），返回路径
fn setup_dir(
    sync_meta: Option<SyncMeta>,
) -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let config_path = dir.path().join("config.json");
    let providers_path = dir.path().join("providers.json");
    let mut cfg = serde_json::json!({
        "version": "2.0.0",
        "profiles": {
            "p1": profile_json("p1", "sk-p1", Some("tok-p1")),
            "p2": profile_json("p2", "sk-p2", None)
        },
        "coders": {},
        "groups": {}
    });
    if let Some(m) = sync_meta {
        cfg["syncMeta"] = serde_json::to_value(m).unwrap();
    }
    std::fs::write(&config_path, serde_json::to_string_pretty(&cfg).unwrap()).unwrap();
    let providers = serde_json::json!({
        "version": "1.0.0",
        "providers": [{
            "id": "my-prov",
            "name": "my-prov",
            "displayName": "My Provider",
            "baseURL": "https://api.example.com",
            "defaultModels": ["m1"],
            "authType": "api-key"
        }]
    });
    std::fs::write(
        &providers_path,
        serde_json::to_string_pretty(&providers).unwrap(),
    )
    .unwrap();
    (dir, config_path, providers_path)
}

fn ctx<'a>(
    client: &'a SyncClient,
    config_path: &std::path::Path,
    providers_path: &std::path::Path,
) -> SyncContext<'a> {
    SyncContext {
        client,
        config: ConfigManager::load_from(config_path.to_path_buf()),
        providers_path: providers_path.to_path_buf(),
        key_provider: &|| Ok(KEY),
    }
}

fn status_body(config_v: u64, providers_v: u64) -> serde_json::Value {
    serde_json::json!({"statuses":[
        {"dataKey":"config","dataVersion":config_v,"updatedAt":"t"},
        {"dataKey":"providers","dataVersion":providers_v,"updatedAt":"t"}
    ]})
}

// ---------- Task 3: push/pull flow ----------

#[tokio::test]
async fn push_flow_encrypts_and_writes_back_sync_meta() {
    let mock = MockCloud::start(vec![
        ("/api/sync/status", vec![(200, status_body(3, 1))]),
        (
            "/api/sync/push",
            vec![
                (
                    200,
                    serde_json::json!({"success":true,"dataVersion":4,"updatedAt":"t2"}),
                ),
                (
                    200,
                    serde_json::json!({"success":true,"dataVersion":2,"updatedAt":"t2"}),
                ),
            ],
        ),
    ])
    .await;
    let (_dir, config_path, providers_path) = setup_dir(Some(meta(3, 1)));
    let client = SyncClient::new(&mock.base_url, "tok");
    let mut ctx = ctx(&client, &config_path, &providers_path);

    push_flow(&mut ctx, false).await.unwrap();

    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec.len(), 3);
    assert_eq!(rec[0].method, "GET");
    assert_eq!(rec[0].path, "/api/sync/status");
    assert_eq!(rec[0].authorization.as_deref(), Some("Bearer tok"));

    // config push：发远端当前版本 3（乐观锁）
    assert_eq!(rec[1].method, "POST");
    assert_eq!(rec[1].body["dataKey"], "config");
    assert_eq!(rec[1].body["dataVersion"], 3);
    let enc = rec[1].body["encryptedData"].as_str().unwrap();
    // TS: encryptedData = JSON.stringify(逐 profile 字段级加密) —— 可解析为 JSON map
    let profiles: serde_json::Value = serde_json::from_str(enc).unwrap();
    assert_ne!(profiles["p1"]["apiKey"], "sk-p1");
    assert_eq!(
        decrypt(&KEY, profiles["p1"]["apiKey"].as_str().unwrap()).unwrap(),
        "sk-p1"
    );
    assert_eq!(
        decrypt(&KEY, profiles["p1"]["authToken"].as_str().unwrap()).unwrap(),
        "tok-p1"
    );
    assert_eq!(
        decrypt(&KEY, profiles["p2"]["apiKey"].as_str().unwrap()).unwrap(),
        "sk-p2"
    );
    // 非敏感字段保持明文
    assert_eq!(profiles["p1"]["providerId"], "ollama");

    // providers push：{providers:[...]} 包裹，版本 1
    assert_eq!(rec[2].body["dataKey"], "providers");
    assert_eq!(rec[2].body["dataVersion"], 1);
    let prov: serde_json::Value =
        serde_json::from_str(rec[2].body["encryptedData"].as_str().unwrap()).unwrap();
    assert_eq!(prov["providers"][0]["id"], "my-prov");
    drop(rec);

    // syncMeta 写回服务端版本号；dirty 字段被清除（序列化后无 dirty 键）
    let raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
    assert_eq!(raw["syncMeta"]["configVersion"], 4);
    assert_eq!(raw["syncMeta"]["providersVersion"], 2);
    assert!(raw["syncMeta"].get("dirty").is_none());
}

#[tokio::test]
async fn push_flow_conflict_aborts_without_force() {
    let mock = MockCloud::start(vec![
        ("/api/sync/status", vec![(200, status_body(5, 1))]),
        (
            "/api/sync/push",
            vec![
                (
                    200,
                    serde_json::json!({"success":true,"dataVersion":6,"updatedAt":"t2"}),
                ),
                (
                    200,
                    serde_json::json!({"success":true,"dataVersion":2,"updatedAt":"t2"}),
                ),
            ],
        ),
    ])
    .await;
    let (_dir, config_path, providers_path) = setup_dir(Some(meta(3, 1)));
    let client = SyncClient::new(&mock.base_url, "tok");
    let mut ctx = ctx(&client, &config_path, &providers_path);

    // local configVersion=3，remote=5 → 冲突错误，不发 push 请求
    let err = push_flow(&mut ctx, false).await.unwrap_err();
    match err {
        ServerError::SyncConflict(c) => {
            assert_eq!(
                (c.local_version, c.remote_version, c.data_key.as_str()),
                (3, 5, "config")
            );
        }
        other => panic!("expected SyncConflict, got {other:?}"),
    }
    assert_eq!(mock.recorded.lock().unwrap().len(), 1); // 仅 status

    // force_local 则照常 push
    push_flow(&mut ctx, true).await.unwrap();
    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec.len(), 4); // status + status + push×2
    assert_eq!(rec[2].body["dataKey"], "config");
    assert_eq!(rec[2].body["dataVersion"], 5); // 基于远端当前版本
}

#[tokio::test]
async fn pull_flow_overwrites_same_name_keeps_local_only() {
    use swixter_server::crypto::fields::encrypt_sensitive_fields;
    // 远端 config v4：profile p1 被改（apiKey 换成 remote-p1）；不含本地独有的 p2
    let mut remote_profiles = serde_json::Map::new();
    let remote_p1 = profile_json("p1", "remote-p1", None);
    remote_profiles.insert(
        "p1".into(),
        encrypt_sensitive_fields(&KEY, &remote_p1).unwrap(),
    );
    let encrypted_data = serde_json::to_string(&remote_profiles).unwrap();

    let mock = MockCloud::start(vec![(
        "/api/sync/pull",
        vec![
            (
                200,
                serde_json::json!({
                    "dataKey":"config","encryptedData":encrypted_data,
                    "dataVersion":4,"clientTimestamp":"t","updatedAt":"t"
                }),
            ),
            (
                404,
                serde_json::json!({"code":"NOT_FOUND","message":"no data"}),
            ), // providers 404 容忍
        ],
    )])
    .await;
    // 本地 configVersion 已是 4（== 远端），非 force 也不冲突
    let (_dir, config_path, providers_path) = setup_dir(Some(meta(4, 1)));
    let client = SyncClient::new(&mock.base_url, "tok");
    let mut ctx = ctx(&client, &config_path, &providers_path);

    pull_flow(&mut ctx, false).await.unwrap();

    // 同名 profile 被远端覆盖；本地独有保留
    let raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
    assert_eq!(raw["profiles"]["p1"]["apiKey"], "remote-p1");
    assert!(raw["profiles"]["p1"].get("authToken").is_none()); // 远端无 authToken
    assert_eq!(raw["profiles"]["p2"]["apiKey"], "sk-p2");
    // syncMeta 写回远端版本；providers 404 → 保留原 providersVersion
    assert_eq!(raw["syncMeta"]["configVersion"], 4);
    assert_eq!(raw["syncMeta"]["providersVersion"], 1);
}

#[tokio::test]
async fn pull_flow_config_404_errors_push_first() {
    let mock = MockCloud::start(vec![(
        "/api/sync/pull",
        vec![(
            404,
            serde_json::json!({"code":"NOT_FOUND","message":"no data"}),
        )],
    )])
    .await;
    let (_dir, config_path, providers_path) = setup_dir(None);
    let client = SyncClient::new(&mock.base_url, "tok");
    let mut ctx = ctx(&client, &config_path, &providers_path);

    let err = pull_flow(&mut ctx, false).await.unwrap_err();
    match err {
        ServerError::Sync(e) => assert_eq!(e.status, 404),
        other => panic!("expected Sync(404), got {other:?}"),
    }
}

// ---------- Task 4: auto-sync ----------

use swixter_server::crypto::derive::key_to_base64;
use swixter_server::sync::auto_sync;

/// auto-sync 测试共享进程级 ENABLED 开关，必须串行
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn write_auth(dir: &std::path::Path, encryption_key: Option<String>) -> std::path::PathBuf {
    let auth_path = dir.join("auth.json");
    let mut auth = serde_json::json!({
        "accessToken": "tok",
        "refreshToken": "refresh-0",
        "expiresAt": "2999-01-01T00:00:00Z", // 远未来，不触发 refresh
        "encryptionSalt": "AAECAwQFBgcICQoLDA0ODw==",
        "authMethod": "password",
        "userId": "u1",
        "email": "e@x.com"
    });
    if let Some(k) = encryption_key {
        auth["encryptionKey"] = k.into();
    }
    std::fs::write(&auth_path, serde_json::to_string_pretty(&auth).unwrap()).unwrap();
    auth_path
}

fn auto_ctx(base_url: &str, dir: &std::path::Path) -> auto_sync::AutoSyncContext {
    auto_sync::AutoSyncContext {
        base_url: base_url.to_string(),
        auth_path: dir.join("auth.json"),
        config_path: dir.join("config.json"),
        providers_path: dir.join("providers.json"),
    }
}

#[tokio::test]
async fn auto_sync_skips_when_disabled_or_no_key() {
    let _g = SERIAL.lock().await;
    let mock = MockCloud::start(vec![
        ("/api/sync/status", vec![(200, status_body(3, 1))]),
        (
            "/api/sync/push",
            vec![(
                200,
                serde_json::json!({"success":true,"dataVersion":4,"updatedAt":"t"}),
            )],
        ),
    ])
    .await;
    let (dir, _cp, _pp) = setup_dir(Some(SyncMeta {
        dirty: Some(true),
        ..meta(3, 1)
    }));
    let dir_path = dir.path().to_path_buf();

    // disabled：零请求
    auto_sync::set_enabled(false);
    write_auth(&dir_path, Some(key_to_base64(&KEY)));
    auto_sync::sync_push_if_enabled(&auto_ctx(&mock.base_url, &dir_path)).await;
    assert_eq!(mock.recorded.lock().unwrap().len(), 0);

    // enabled 但 auth.json 无 encryptionKey：零请求（静默跳过）
    auto_sync::set_enabled(true);
    write_auth(&dir_path, None);
    auto_sync::sync_push_if_enabled(&auto_ctx(&mock.base_url, &dir_path)).await;
    assert_eq!(mock.recorded.lock().unwrap().len(), 0);

    auto_sync::set_enabled(false);
}

#[tokio::test]
async fn auto_sync_pushes_when_dirty_and_clears_dirty() {
    let _g = SERIAL.lock().await;
    let mock = MockCloud::start(vec![
        ("/api/sync/status", vec![(200, status_body(3, 1))]),
        (
            "/api/sync/push",
            vec![
                (
                    200,
                    serde_json::json!({"success":true,"dataVersion":4,"updatedAt":"t"}),
                ),
                (
                    200,
                    serde_json::json!({"success":true,"dataVersion":2,"updatedAt":"t"}),
                ),
            ],
        ),
    ])
    .await;
    let (dir, config_path, _pp) = setup_dir(Some(SyncMeta {
        dirty: Some(true),
        ..meta(3, 1)
    }));
    let dir_path = dir.path().to_path_buf();
    write_auth(&dir_path, Some(key_to_base64(&KEY)));

    auto_sync::set_enabled(true);
    auto_sync::sync_push_if_enabled(&auto_ctx(&mock.base_url, &dir_path)).await;
    auto_sync::set_enabled(false);

    let rec = mock.recorded.lock().unwrap();
    // status + config push + providers push（dirty 同时触发两者）
    assert_eq!(rec.len(), 3);
    assert_eq!(rec[1].body["dataKey"], "config");
    assert_eq!(rec[1].body["dataVersion"], 3);
    assert_eq!(rec[2].body["dataKey"], "providers");
    drop(rec);

    // 成功后写回 dirty:false（与手动 push 的「不带 dirty」路径不同）
    let raw: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
    assert_eq!(raw["syncMeta"]["dirty"], false);
    assert_eq!(raw["syncMeta"]["configVersion"], 4);
    assert_eq!(raw["syncMeta"]["providersVersion"], 2);
}

#[tokio::test]
async fn auto_sync_skips_when_not_dirty_and_versions_match() {
    let _g = SERIAL.lock().await;
    let mock = MockCloud::start(vec![("/api/sync/status", vec![(200, status_body(3, 1))])]).await;
    // 无 dirty、版本一致 → 只发 status，不发 push
    let (dir, _cp, _pp) = setup_dir(Some(meta(3, 1)));
    let dir_path = dir.path().to_path_buf();
    write_auth(&dir_path, Some(key_to_base64(&KEY)));

    auto_sync::set_enabled(true);
    auto_sync::sync_push_if_enabled(&auto_ctx(&mock.base_url, &dir_path)).await;
    auto_sync::set_enabled(false);

    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec.len(), 1);
    assert_eq!(rec[0].path, "/api/sync/status");
}

#[tokio::test]
async fn auto_sync_is_syncing_mutex() {
    let _g = SERIAL.lock().await;
    // 挂起服务器：接受连接但不响应，制造 isSyncing 窗口
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let hang_url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            tokio::spawn(async move {
                let _stream = stream; // 持有连接，永不响应
                tokio::time::sleep(std::time::Duration::from_secs(30)).await;
            });
        }
    });

    let (dir, _cp, _pp) = setup_dir(Some(SyncMeta {
        dirty: Some(true),
        ..meta(3, 1)
    }));
    let dir_path = dir.path().to_path_buf();
    write_auth(&dir_path, Some(key_to_base64(&KEY)));
    auto_sync::set_enabled(true);

    // 第一次调用挂在 status 请求上（持有 isSyncing）
    let first_ctx = auto_ctx(&hang_url, &dir_path);
    let first = tokio::spawn(async move {
        auto_sync::sync_push_if_enabled(&first_ctx).await;
    });
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;

    // 第二次调用 CAS 失败直接返回：mock 零请求
    let mock = MockCloud::start(
        vec![(200, status_body(3, 1))]
            .into_iter()
            .map(|r| ("/api/sync/status", vec![r]))
            .collect(),
    )
    .await;
    auto_sync::sync_push_if_enabled(&auto_ctx(&mock.base_url, &dir_path)).await;
    assert_eq!(mock.recorded.lock().unwrap().len(), 0);

    first.abort();
    auto_sync::set_enabled(false);
}

#[tokio::test]
async fn auto_sync_swallows_errors() {
    let _g = SERIAL.lock().await;
    let mock = MockCloud::start(vec![
        (
            "/api/sync/status",
            vec![(500, serde_json::json!({"code":"ERR","message":"boom"}))],
        ),
        (
            "/api/sync/pull",
            vec![(500, serde_json::json!({"code":"ERR","message":"boom"}))],
        ),
    ])
    .await;
    let (dir, config_path, _pp) = setup_dir(Some(SyncMeta {
        dirty: Some(true),
        ..meta(3, 1)
    }));
    let dir_path = dir.path().to_path_buf();
    write_auth(&dir_path, Some(key_to_base64(&KEY)));
    auto_sync::set_enabled(true);
    let ctx = auto_ctx(&mock.base_url, &dir_path);

    // load/saveConfigWithSync 正常返回，不传播 sync 错误
    let mgr = auto_sync::load_config_with_sync(&ctx).await;
    assert!(mgr.config().profiles.contains_key("p1"));
    auto_sync::save_config_with_sync(&ctx, &mgr).await.unwrap();
    assert!(config_path.exists());

    auto_sync::set_enabled(false);
}
