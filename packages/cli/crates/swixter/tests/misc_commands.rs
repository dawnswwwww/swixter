use assert_cmd::Command;
use predicates::prelude::*;

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path());
    c
}

#[test]
fn providers_list_shows_builtins() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["providers", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("Anthropic").and(predicate::str::contains("Ollama")));
}

#[test]
fn providers_add_show_remove_quiet() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args([
            "providers",
            "add",
            "--quiet",
            "--id",
            "my-corp",
            "--name",
            "my-corp",
            "--display-name",
            "Corp LLM",
            "--base-url",
            "https://llm.corp.example",
            "--auth-type",
            "api-key",
            "--models",
            "corp-1,corp-2",
        ])
        .assert()
        .success();
    setup(&dir)
        .args(["providers", "show", "my-corp"])
        .assert()
        .success()
        .stdout(predicate::str::contains("https://llm.corp.example"));
    setup(&dir)
        .args(["providers", "remove", "my-corp", "--quiet"])
        .assert()
        .success();
    setup(&dir)
        .args(["providers", "show", "my-corp"])
        .assert()
        .code(3);
}

#[test]
fn group_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    for n in ["g-p1", "g-p2"] {
        setup(&dir)
            .args([
                "claude",
                "create",
                "--quiet",
                "--name",
                n,
                "--provider",
                "ollama",
            ])
            .assert()
            .success();
    }
    setup(&dir)
        .args(["group", "create", "main", "--profiles", "g-p1,g-p2"])
        .assert()
        .success();
    setup(&dir)
        .args(["group", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("main"));
    setup(&dir)
        .args(["group", "show", "main"])
        .assert()
        .success()
        .stdout(predicate::str::contains("g-p1"));
    setup(&dir)
        .args(["group", "set-default", "main"])
        .assert()
        .success();
    setup(&dir)
        .args(["group", "delete", "main", "--force"])
        .assert()
        .success();
    setup(&dir).args(["group", "show", "main"]).assert().code(3);
}

#[test]
fn group_create_duplicate_name_exits_2() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "dp1",
            "--provider",
            "ollama",
        ])
        .assert()
        .success();
    setup(&dir)
        .args(["group", "create", "dup", "--profiles", "dp1"])
        .assert()
        .success();
    setup(&dir)
        .args(["group", "create", "dup", "--profiles", "dp1"])
        .assert()
        .code(2)
        .stderr(predicate::str::contains("Group \"dup\" already exists"));
}

#[test]
fn group_delete_confirm_cancel_exits_130() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "cp1",
            "--provider",
            "ollama",
        ])
        .assert()
        .success();
    setup(&dir)
        .args(["group", "create", "c1", "--profiles", "cp1"])
        .assert()
        .success();
    // 无 --force 且非 TTY：确认框 cancel → exit 130，group 保留
    setup(&dir)
        .args(["group", "delete", "c1"])
        .assert()
        .code(130);
    setup(&dir).args(["group", "show", "c1"]).assert().success();
}

#[test]
fn no_args_prints_help_and_exits_0() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .assert()
        .success()
        .stdout(predicate::str::contains("Usage: swixter"));
}

#[test]
fn export_import_roundtrip() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "e1",
            "--provider",
            "anthropic",
            "--api-key",
            "sk-ant-export-test",
        ])
        .assert()
        .success();
    let file = dir.path().join("backup.json");
    setup(&dir)
        .args(["export", file.to_str().unwrap()])
        .assert()
        .success();
    // 删除后导入恢复
    setup(&dir)
        .args(["claude", "delete", "e1"])
        .assert()
        .success();
    setup(&dir)
        .args(["import", file.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("1").and(predicate::str::contains("imported")));
    setup(&dir)
        .args(["claude", "list"])
        .assert()
        .success()
        .stdout(predicate::str::contains("e1"));
    // 缺文件参数 → clap 报错 exit 2
    setup(&dir).args(["export"]).assert().code(2);
}
