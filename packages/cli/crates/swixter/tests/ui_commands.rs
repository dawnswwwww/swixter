use std::io::{Read, Write};
use std::time::{Duration, Instant};

use assert_cmd::Command;
use predicates::prelude::*;

fn setup(dir: &tempfile::TempDir) -> Command {
    let mut c = Command::cargo_bin("swixter").unwrap();
    c.env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("SWIXTER_HOME", dir.path());
    c
}

/// 占用探测：bind 端口 0 取一个空闲高端口后释放（测试窗口内被抢概率可忽略）
fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}

/// 裸 HTTP GET（不引 reqwest dev 依赖）：200 → true
fn http_get_ok(port: u16, path: &str) -> bool {
    let Ok(mut s) = std::net::TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    s.set_read_timeout(Some(Duration::from_secs(2))).ok();
    let req = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    if s.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = Vec::new();
    if s.read_to_end(&mut buf).is_err() {
        return false;
    }
    buf.starts_with(b"HTTP/1.1 200") || buf.starts_with(b"HTTP/1.0 200")
}

fn wait_for_health(port: u16, timeout: Duration) -> bool {
    let start = Instant::now();
    while start.elapsed() < timeout {
        if http_get_ok(port, "/api/version") {
            return true;
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    false
}

#[test]
fn ui_status_not_running() {
    let dir = tempfile::tempdir().unwrap();
    setup(&dir)
        .args(["ui", "--status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("not running"));
}

#[test]
fn ui_foreground_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    let port = free_port();

    // 前台启动（后台子进程），--no-browser 避免开浏览器
    let mut child = std::process::Command::new(assert_cmd::cargo::cargo_bin("swixter"))
        .args(["ui", "--port", &port.to_string(), "--no-browser"])
        .env("SWIXTER_CONFIG_PATH", dir.path().join("config.json"))
        .env("HOME", dir.path())
        .env("SWIXTER_HOME", dir.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();

    // /api/version 200
    assert!(
        wait_for_health(port, Duration::from_secs(20)),
        "ui server did not become healthy on port {port}"
    );

    // --status 报告运行
    setup(&dir)
        .args(["ui", "--status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("running"));

    // --stop 后健康检查失败、status 不再运行
    setup(&dir).args(["ui", "--stop"]).assert().success();
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(10) && http_get_ok(port, "/api/version") {
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(!http_get_ok(port, "/api/version"));
    setup(&dir)
        .args(["ui", "--status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("not running"));

    let _ = child.kill();
    let _ = child.wait();
}

// Windows 上挂死（CI 实测：assert 永不返回；daemon 分离进程语义在 Windows
// 属受限能力，见 docs/WINDOWS.md），按项目惯例限 unix
#[test]
#[cfg(unix)]
fn ui_daemon_lifecycle() {
    let dir = tempfile::tempdir().unwrap();
    let port = free_port();

    // --daemon：spawn detached + 健康检查通过后 exit 0
    setup(&dir)
        .args(["ui", "--daemon", "--port", &port.to_string()])
        .assert()
        .success()
        .stdout(predicate::str::contains("daemon started"));

    assert!(wait_for_health(port, Duration::from_secs(10)));

    setup(&dir)
        .args(["ui", "--status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("running"));

    setup(&dir)
        .args(["ui", "--stop"])
        .assert()
        .success()
        .stdout(predicate::str::contains("stopped"));

    setup(&dir)
        .args(["ui", "--status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("not running"));
}
