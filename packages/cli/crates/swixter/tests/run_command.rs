use assert_cmd::Command;

#[cfg(unix)]
fn fake_cli(dir: &tempfile::TempDir, name: &str) {
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let script = bin.join(name);
    std::fs::write(&script, format!(
        "#!/bin/sh\necho \"$@\" > \"$FAKE_OUT.args\"\nenv | grep -E 'ANTHROPIC|OPENAI|OLLAMA' > \"$FAKE_OUT.env\" 2>/dev/null || true\n"
    )).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
}

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("FAKE_OUT", dir.path().join("out"))
        .env(
            "PATH",
            format!(
                "{}:{}",
                dir.path().join("bin").display(),
                std::env::var("PATH").unwrap()
            ),
        );
    c
}

#[test]
#[cfg(unix)]
fn claude_run_passes_settings_and_yolo() {
    let dir = tempfile::tempdir().unwrap();
    fake_cli(&dir, "claude");
    setup(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "r1",
            "--provider",
            "anthropic",
            "--api-key",
            "sk-ant-run1",
        ])
        .assert()
        .success();
    setup(&dir)
        .args(["claude", "run", "--yolo", "chat"])
        .assert()
        .success();
    let args = std::fs::read_to_string(dir.path().join("out.args")).unwrap();
    assert!(args.contains("--dangerously-skip-permissions"));
    assert!(args.contains("--settings"));
    assert!(args.contains("chat"));
    // 临时 settings 文件已清理
    let leftovers: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_name()
                .to_string_lossy()
                .starts_with("swixter-settings-")
        })
        .collect();
    assert!(leftovers.is_empty());
}

#[test]
#[cfg(unix)]
fn codex_run_injects_env() {
    let dir = tempfile::tempdir().unwrap();
    fake_cli(&dir, "codex");
    setup(&dir)
        .args([
            "codex",
            "create",
            "--quiet",
            "--name",
            "r2",
            "--provider",
            "ollama",
            "--model",
            "qwen2.5-coder:7b",
        ])
        .assert()
        .success();
    setup(&dir)
        .args(["codex", "run", "exec", "hi"])
        .assert()
        .success();
    let env = std::fs::read_to_string(dir.path().join("out.env")).unwrap();
    assert!(env.contains("OPENAI_MODEL=qwen2.5-coder:7b"));
    // codex run 会先 apply：config.toml 已写
    assert!(dir.path().join(".codex/config.toml").exists());
}

#[test]
#[cfg(unix)]
fn qwen_run_injects_openai_args() {
    let dir = tempfile::tempdir().unwrap();
    fake_cli(&dir, "qwen");
    setup(&dir)
        .args([
            "qwen",
            "create",
            "--quiet",
            "--name",
            "r3",
            "--provider",
            "ollama",
            "--model",
            "qwen2.5-coder:7b",
            "--base-url",
            "http://localhost:11434",
        ])
        .assert()
        .success();
    setup(&dir).args(["qwen", "run", "chat"]).assert().success();
    let args = std::fs::read_to_string(dir.path().join("out.args")).unwrap();
    assert!(args.contains("--openai-base-url http://localhost:11434"));
    assert!(args.contains("--model qwen2.5-coder:7b"));
}

#[test]
fn run_without_profile_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir).args(["claude", "run"]).assert().code(3);
}
