use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command as ProcCommand, Stdio};
use std::time::{Duration, Instant};

use assert_cmd::Command;
use predicates::prelude::*;

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("TMPDIR", dir.path());
    c
}

/// 占一个临时端口再释放，拿到一个基本空闲的高端口（避免与默认 15721 / 其他测试冲突）
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// 裸 HTTP GET（不引 reqwest 依赖）；返回是否拿到 2xx 状态行
fn http_get_ok(port: u16, path: &str) -> bool {
    let Ok(mut s) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = write!(
        s,
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"
    );
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.1 2")
}

fn wait_health(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if http_get_ok(port, "/health") {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    false
}

/// 前台启动 proxy（保持子进程句柄，测试结束兜底 kill）
fn spawn_foreground_start(dir: &tempfile::TempDir, port: u16, extra: &[&str]) -> Child {
    let mut c = ProcCommand::new(assert_cmd::cargo::cargo_bin("swixter"));
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("TMPDIR", dir.path())
        .args(["proxy", "start", "--port", &port.to_string()])
        .args(extra)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    c.spawn().unwrap()
}

#[test]
fn proxy_status_no_instances() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["proxy", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No proxy instances running"));
}

#[test]
fn proxy_stop_not_running() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["proxy", "stop"])
        .assert()
        .success()
        .stdout(predicate::str::contains("is not running"));
}

#[test]
fn proxy_start_group_and_profile_mutually_exclusive() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["proxy", "start", "--group", "g1", "--profile", "p1"])
        .assert()
        .code(2)
        .stderr(predicate::str::contains(
            "Cannot specify both --group and --profile",
        ));
    setup(&dir)
        .args([
            "proxy",
            "run",
            "--group",
            "g1",
            "--profile",
            "p1",
            "--",
            "true",
        ])
        .assert()
        .code(2)
        .stderr(predicate::str::contains(
            "Cannot specify both --group and --profile",
        ));
}

#[test]
fn proxy_start_status_stop_foreground() {
    let dir = tempfile::tempdir().unwrap();
    let port = free_port();
    setup(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "pp1",
            "--provider",
            "ollama",
        ])
        .assert()
        .success();
    let mut server = spawn_foreground_start(&dir, port, &["--profile", "pp1"]);
    assert!(
        wait_health(port, Duration::from_secs(10)),
        "proxy /health should come up"
    );

    // status 列出运行实例
    setup(&dir)
        .args(["proxy", "status"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("default")
                .and(predicate::str::contains(port.to_string()))
                .and(predicate::str::contains("pp1")),
        );

    // stop 真正 kill 前台进程：/health 失败 + 子进程退出
    setup(&dir).args(["proxy", "stop"]).assert().success();
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if let Ok(Some(_)) = server.try_wait() {
            break;
        }
        assert!(Instant::now() < deadline, "server process should exit");
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(!http_get_ok(port, "/health"));
    setup(&dir)
        .args(["proxy", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No proxy instances running"));
}

#[test]
fn proxy_start_missing_profile_exits_3() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["proxy", "start", "--profile", "nope"])
        .assert()
        .code(3)
        .stderr(predicate::str::contains("Profile \"nope\" not found"));
}

#[test]
fn proxy_run_injects_coder_env() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args([
            "claude",
            "create",
            "--quiet",
            "--name",
            "rp1",
            "--provider",
            "ollama",
        ])
        .assert()
        .success();

    // fake claude：把注入的 env 写到 $ENV_OUT
    let bin = dir.path().join("bin");
    std::fs::create_dir_all(&bin).unwrap();
    let env_out = dir.path().join("env.out");
    let script = "#!/bin/sh\n{\n  echo \"ANTHROPIC_API_BASE=$(printenv ANTHROPIC_API_BASE)\"\n  echo \"ANTHROPIC_AUTH_TOKEN=$(printenv ANTHROPIC_AUTH_TOKEN)\"\n  echo \"ANTHROPIC_API_KEY=$(printenv ANTHROPIC_API_KEY)\"\n} > \"$ENV_OUT\"\n";
    std::fs::write(bin.join("claude"), script).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(bin.join("claude"), std::fs::Permissions::from_mode(0o755))
            .unwrap();
    }

    let port = free_port();
    let path = format!(
        "{}:{}",
        bin.display(),
        std::env::var("PATH").unwrap_or_default()
    );
    setup(&dir)
        .env("PATH", path)
        .env("ENV_OUT", &env_out)
        // 预置 ANTHROPIC_API_KEY，断言 run 会把它删掉
        .env("ANTHROPIC_API_KEY", "should-be-removed")
        .args([
            "proxy",
            "run",
            "--profile",
            "rp1",
            "--port",
            &port.to_string(),
            "--",
            "claude",
        ])
        .assert()
        .success();

    let env = std::fs::read_to_string(&env_out).unwrap();
    assert!(
        env.contains(&format!("ANTHROPIC_API_BASE=http://127.0.0.1:{port}")),
        "env.out: {env}"
    );
    assert!(
        env.contains("ANTHROPIC_AUTH_TOKEN=swixter-local-proxy"),
        "env.out: {env}"
    );
    assert!(
        env.contains("ANTHROPIC_API_KEY=\n") || env.trim_end().ends_with("ANTHROPIC_API_KEY="),
        "ANTHROPIC_API_KEY should be removed, env.out: {env}"
    );

    // run 创建的实例在 coder 退出后已停止
    setup(&dir)
        .args(["proxy", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No proxy instances running"));
}

#[test]
fn bare_proxy_shows_status() {
    // TS: 裸 `swixter proxy` 显示 status 并 exit 0
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["proxy"])
        .assert()
        .success()
        .stdout(predicate::str::contains("No proxy instances running"));
}

#[test]
fn proxy_run_extracts_profile_from_coder_args() {
    // coder 参数里的 --profile 被提取并参与校验：不存在 → exit 3 + 明确文案
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["proxy", "run", "--", "true", "--profile", "ghost"])
        .assert()
        .code(3)
        .stderr(predicate::str::contains("Profile \"ghost\" not found"));
}
