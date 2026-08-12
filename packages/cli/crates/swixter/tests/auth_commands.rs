use assert_cmd::Command;
use predicates::prelude::*;

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("SWIXTER_HOME", dir.path())
        // 指向不可达地址，避免测试打到真实云端（logout 忽略 API 错误，快速失败即可）
        .env("SWIXTER_API_BASE", "http://127.0.0.1:1");
    c
}

fn write_auth_json(dir: &tempfile::TempDir) {
    let auth = serde_json::json!({
        "accessToken": "access-0",
        "refreshToken": "refresh-0",
        "expiresAt": "2999-01-01T00:00:00Z",
        "encryptionSalt": "AAECAwQFBgcICQoLDA0ODw==",
        "authMethod": "password",
        "userId": "u1",
        "email": "e@x.com"
    });
    std::fs::write(
        dir.path().join("auth.json"),
        serde_json::to_string_pretty(&auth).unwrap(),
    )
    .unwrap();
}

#[test]
fn auth_status_not_logged_in() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["auth", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Not logged in"));
}

#[test]
fn auth_status_logged_in_shows_email_and_encryption() {
    let dir = tempfile::tempdir().unwrap();
    write_auth_json(&dir);
    setup(&dir)
        .args(["auth", "status"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("Logged in")
                .and(predicate::str::contains("e@x.com"))
                .and(predicate::str::contains("Encryption")),
        );
}

#[test]
fn auth_logout_not_logged_in() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["auth", "logout"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Logged out"));
}

#[test]
fn auth_logout_clears_auth_json_and_sync_meta() {
    let dir = tempfile::tempdir().unwrap();
    write_auth_json(&dir);
    let config = serde_json::json!({
        "version": "2.0.0",
        "profiles": {},
        "coders": {},
        "groups": {},
        "syncMeta": {
            "lastSyncAt": "2026-07-24T00:00:00.000Z",
            "configVersion": 3,
            "providersVersion": 1,
            "localUpdatedAt": "2026-07-24T00:00:00.000Z"
        }
    });
    std::fs::write(
        dir.path().join("config.json"),
        serde_json::to_string_pretty(&config).unwrap(),
    )
    .unwrap();

    setup(&dir)
        .args(["auth", "logout"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Logged out"));

    // auth.json 已删除
    assert!(!dir.path().join("auth.json").exists());
    // syncMeta 已清除
    let raw = std::fs::read_to_string(dir.path().join("config.json")).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert!(v.get("syncMeta").is_none());
}
