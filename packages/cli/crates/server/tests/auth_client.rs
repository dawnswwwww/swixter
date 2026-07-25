mod common;
use common::MockCloud;
use swixter_server::auth::{client::AuthClient, token::TokenStore, types::AuthState};

fn auth_state(expires_at: &str) -> AuthState {
    AuthState {
        access_token: "access-0".into(),
        refresh_token: "refresh-0".into(),
        expires_at: expires_at.into(),
        encryption_salt: "AAECAwQFBgcICQoLDA0ODw==".into(),
        encryption_key: None,
        auth_method: "password".into(),
        user_id: "u1".into(),
        email: "e@x.com".into(),
    }
}

#[tokio::test]
async fn get_access_token_returns_when_fresh() {
    let dir = tempfile::tempdir().unwrap();
    let store = TokenStore::new(dir.path().join("auth.json"));
    let future = (time::OffsetDateTime::now_utc() + time::Duration::hours(1))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    store.save(&auth_state(&future)).unwrap();
    let client = AuthClient::new("http://127.0.0.1:1"); // 不可达也没关系，不该发请求
    assert_eq!(
        store.get_access_token(&client).await.as_deref(),
        Some("access-0")
    );
}

#[tokio::test]
async fn get_access_token_refreshes_within_buffer() {
    let mock = MockCloud::start(vec![(
        "/api/auth/refresh",
        vec![(
            200,
            serde_json::json!({"accessToken":"access-1","expiresAt":"2999-01-01T00:00:00Z"}),
        )],
    )])
    .await;
    let dir = tempfile::tempdir().unwrap();
    let store = TokenStore::new(dir.path().join("auth.json"));
    let soon = (time::OffsetDateTime::now_utc() + time::Duration::minutes(4)) // < 5min 缓冲
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    store.save(&auth_state(&soon)).unwrap();
    let client = AuthClient::new(&mock.base_url);
    assert_eq!(
        store.get_access_token(&client).await.as_deref(),
        Some("access-1")
    );
    // 持久化：auth.json 已更新且仍是 0o600
    let saved = store.load().unwrap();
    assert_eq!(saved.access_token, "access-1");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            std::fs::metadata(dir.path().join("auth.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec[0].path, "/api/auth/refresh");
    assert_eq!(rec[0].body["refreshToken"], "refresh-0");
}

#[tokio::test]
async fn refresh_failure_clears_auth_and_returns_none() {
    let mock = MockCloud::start(vec![(
        "/api/auth/refresh",
        vec![(
            401,
            serde_json::json!({"code":"INVALID_REFRESH_TOKEN","message":"expired"}),
        )],
    )])
    .await;
    let dir = tempfile::tempdir().unwrap();
    let store = TokenStore::new(dir.path().join("auth.json"));
    let past = "2020-01-01T00:00:00Z";
    store.save(&auth_state(past)).unwrap();
    let client = AuthClient::new(&mock.base_url);
    assert!(store.get_access_token(&client).await.is_none());
    assert!(store.load().is_none()); // auth.json 已删除
}

#[tokio::test]
async fn login_and_magic_link_session_polling_contract() {
    let mock = MockCloud::start(vec![
        (
            "/api/auth/login",
            vec![(
                200,
                serde_json::json!({
                "accessToken":"a","refreshToken":"r","expiresAt":"2999-01-01T00:00:00Z",
                "user":{"id":"u1","email":"e@x.com","displayName":null},
                "encryptionSalt":"AAECAwQFBgcICQoLDA0ODw=="}),
            )],
        ),
        (
            "/api/auth/magic-link/session/s1",
            vec![
                (200, serde_json::json!({"status":"pending"})),
                (
                    200,
                    serde_json::json!({"status":"completed","accessToken":"a2","refreshToken":"r2",
                    "expiresAt":"2999-01-01T00:00:00Z",
                    "user":{"id":"u1","email":"e@x.com","displayName":null},
                    "encryptionSalt":"AAECAwQFBgcICQoLDA0ODw==","hasPassword":true}),
                ),
            ],
        ),
    ])
    .await;
    let client = AuthClient::new(&mock.base_url);
    let resp = client.login("e@x.com", "pw123456").await.unwrap();
    assert_eq!(resp.user.id, "u1");
    assert_eq!(
        client.check_magic_link_session("s1").await.unwrap().status,
        "pending"
    );
    assert_eq!(
        client.check_magic_link_session("s1").await.unwrap().status,
        "completed"
    );
}

#[tokio::test]
async fn error_body_is_parsed_into_auth_api_error() {
    let mock = MockCloud::start(vec![(
        "/api/auth/login",
        vec![(
            401,
            serde_json::json!({"code":"INVALID_CREDENTIALS","message":"wrong password"}),
        )],
    )])
    .await;
    let client = AuthClient::new(&mock.base_url);
    let err = client.login("e@x.com", "bad").await.unwrap_err();
    assert_eq!(err.status, 401);
    assert_eq!(err.code, "INVALID_CREDENTIALS");
    assert_eq!(err.message, "wrong password");
}

#[tokio::test]
async fn bearer_endpoints_send_authorization_header() {
    let mock = MockCloud::start(vec![
        ("/api/auth/set-password", vec![(200, serde_json::json!({}))]),
        ("/api/auth/account", vec![(200, serde_json::json!({}))]),
    ])
    .await;
    let client = AuthClient::new(&mock.base_url);
    client.set_password("pw123456", "access-0").await.unwrap();
    client.delete_account("access-0").await.unwrap();
    let rec = mock.recorded.lock().unwrap();
    assert_eq!(rec[0].authorization.as_deref(), Some("Bearer access-0"));
    assert_eq!(rec[0].body["password"], "pw123456");
    assert_eq!(rec[1].method, "DELETE");
    assert_eq!(rec[1].authorization.as_deref(), Some("Bearer access-0"));
}
