use assert_cmd::Command;
use predicates::prelude::*;

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("SWIXTER_API_BASE", "http://127.0.0.1:1");
    c
}

#[test]
fn sync_status_requires_login() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["sync", "status"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("Not logged in"));
}

#[test]
fn sync_push_pull_require_login() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["sync", "push"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("Not logged in"));
    setup(&dir)
        .args(["sync", "pull"])
        .assert()
        .failure()
        .stdout(predicate::str::contains("Not logged in"));
}

#[test]
fn sync_enable_disable_prints_in_process_notice() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["sync", "enable"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("Auto sync enabled")
                .and(predicate::str::contains("current process")),
        );
    setup(&dir)
        .args(["sync", "disable"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Auto sync disabled"));
}
