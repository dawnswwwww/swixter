use assert_cmd::Command;
use predicates::prelude::*;

fn swixter(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path());
    c
}

#[test]
fn create_list_switch_current_delete() {
    let dir = tempfile::tempdir().unwrap();
    // create（quiet）
    swixter(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "test1",
            "--provider",
            "anthropic",
            "--api-key",
            "sk-ant-12345",
        ])
        .assert()
        .success();
    // 首个 profile 自动激活
    swixter(&dir)
        .args(["claude", "current"])
        .assert()
        .success()
        .stdout(predicate::str::contains("test1"));
    // 第二个 profile + switch
    swixter(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "test2",
            "--provider",
            "ollama",
            "--base-url",
            "http://localhost:11434",
        ])
        .assert()
        .success();
    swixter(&dir)
        .args(["claude", "switch", "test2", "--no-apply"])
        .assert()
        .success()
        .stdout(predicate::str::contains("test2"));
    swixter(&dir)
        .args(["claude", "current"])
        .assert()
        .success()
        .stdout(predicate::str::contains("test2"));
    // 别名 sw
    swixter(&dir)
        .args(["claude", "sw", "test1", "--no-apply"])
        .assert()
        .success();
    // list 标记激活
    swixter(&dir)
        .args(["claude", "ls"])
        .assert()
        .success()
        .stdout(predicate::str::contains("test1").and(predicate::str::contains("test2")));
    // apply 到隔离 HOME 的 ~/.claude/settings.json
    swixter(&dir).args(["claude", "apply"]).assert().success();
    let settings = std::fs::read_to_string(dir.path().join(".claude/settings.json")).unwrap();
    assert!(settings.contains("sk-ant-12345"));
    // delete：激活态被清除
    swixter(&dir)
        .args(["claude", "delete", "test1"])
        .assert()
        .success();
    swixter(&dir)
        .args(["claude", "current"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No active profile"));
}

#[test]
fn create_quiet_validates_name_and_provider() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "x",
            "--provider",
            "anthropic",
        ])
        .assert()
        .code(2); // name 长度 < 2
    swixter(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "ok1",
            "--provider",
            "nope-provider",
        ])
        .assert()
        .code(1); // 未知 provider
    swixter(&dir)
        .args(["claude", "create", "--quiet", "--provider", "anthropic"])
        .assert()
        .code(2); // quiet 缺 --name
}

#[test]
fn codex_create_requires_api_key_unless_ollama() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir)
        .args([
            "codex",
            "create",
            "--quiet",
            "--name",
            "c1",
            "--provider",
            "openrouter",
        ])
        .assert()
        .code(2); // 缺 --api-key
    swixter(&dir)
        .args([
            "codex",
            "create",
            "--quiet",
            "--name",
            "c1",
            "--provider",
            "ollama",
        ])
        .assert()
        .success();
}

#[test]
fn qwen_rejects_anthropic_provider() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir)
        .args([
            "qwen",
            "create",
            "--quiet",
            "--name",
            "q1",
            "--provider",
            "anthropic",
            "--model",
            "m",
            "--api-key",
            "k",
        ])
        .assert()
        .code(2);
}

#[test]
fn switch_unknown_profile_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    swixter(&dir)
        .args(["claude", "switch", "ghost", "--no-apply"])
        .assert()
        .code(3);
}
