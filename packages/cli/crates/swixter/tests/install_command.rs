use assert_cmd::Command;
use predicates::prelude::*;

/// HOME 隔离 + PATH 指向空的 bin 目录：保证测试机上的真实 claude/codex/qwen
/// 不会被探测到，install/update-cli 永远不会在测试中真的执行
fn setup(dir: &tempfile::TempDir) -> Command {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("PATH", &bin);
    c
}

#[test]
fn update_cli_without_install_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    // PATH 里没有 claude 可执行文件（HOME 隔离 + PATH 不注入 fake）
    setup(&dir).args(["claude", "update-cli"]).assert().code(3);
}

#[test]
fn install_with_invalid_method_index_exits_2() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["claude", "install", "--method", "99"])
        .assert()
        .code(2)
        .stderr(
            predicate::str::contains("Invalid method index")
                .or(predicate::str::contains("Invalid")),
        );
}

#[test]
fn get_cli_version_parses() {
    // 单测在 commands/install.rs 内联：见 Step 3 的 #[cfg(test)]
}
