//! TS: cli/ui.ts —— swixter ui [--port] [--daemon] [--stop] [--status] [--no-browser]
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use swixter_server::daemon::{self, UiPidFile};
use swixter_server::DEFAULT_UI_PORT;

use crate::cli::UiArgs;
use crate::{EXIT_GENERAL, EXIT_SUCCESS};

pub fn dispatch(args: UiArgs) -> i32 {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    rt.block_on(async move {
        if args.stop {
            return stop().await;
        }
        if args.status {
            return status().await;
        }
        if args.daemon {
            return start_daemon(args.port).await;
        }
        run_foreground(args.port, args.no_browser).await
    })
}

/// ui.pid / ui.log 所在目录（config.json 同目录）
fn config_dir() -> PathBuf {
    swixter_core::paths::config_path()
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(swixter_core::paths::swixter_config_dir)
}

fn now_iso() -> String {
    swixter_core::types::now_iso()
}

/// TS: runForeground —— 已运行则只开浏览器；否则前台 serve 并写 PID 文件，
/// SIGINT/SIGTERM 时删 PID 文件退出
async fn run_foreground(port: Option<u16>, no_browser: bool) -> i32 {
    let dir = config_dir();
    daemon::cleanup_stale_pid_file(&dir);
    if let Some(pf) = daemon::is_ui_running(&dir).await {
        println!();
        println!("✓ Swixter UI is already running");
        println!("  URL: http://127.0.0.1:{}", pf.port);
        println!();
        swixter_server::open_browser(&format!("http://127.0.0.1:{}", pf.port));
        return EXIT_SUCCESS;
    }

    let port = swixter_server::find_available_port(port.unwrap_or(DEFAULT_UI_PORT)).await;
    let url = format!("http://127.0.0.1:{port}");
    // daemon 子进程（SWIXTER_UI_DAEMON=1）不开浏览器
    if !no_browser && std::env::var("SWIXTER_UI_DAEMON").is_err() {
        swixter_server::open_browser(&url);
    }

    // 写 PID 文件，让 --status / --stop 能发现本实例（TS runForeground 同款）
    let _ = daemon::write_pid_file(
        &dir,
        &UiPidFile {
            pid: std::process::id(),
            port,
            start_time: now_iso(),
        },
    );

    let server = tokio::spawn(swixter_server::start_server(Some(port), Default::default()));
    wait_for_shutdown_signal().await;
    println!();
    println!("Shutting down...");
    server.abort();
    let _ = daemon::remove_pid_file(&dir);
    EXIT_SUCCESS
}

async fn wait_for_shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = sigterm.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

/// TS: startDaemon —— cleanup stale → 已运行直接开浏览器；否则 spawn 自身
/// detached（去 --daemon，stdio → ui.log，env SWIXTER_UI_DAEMON=1）+ 立即写
/// PID + 200ms×50 轮询健康检查，超时 SIGTERM 子进程删 PID
async fn start_daemon(port: Option<u16>) -> i32 {
    let dir = config_dir();
    daemon::cleanup_stale_pid_file(&dir);
    if let Some(pf) = daemon::is_ui_running(&dir).await {
        println!();
        println!("Swixter UI is already running.");
        println!("  PID: {}", pf.pid);
        println!("  URL: http://127.0.0.1:{}", pf.port);
        println!();
        swixter_server::open_browser(&format!("http://127.0.0.1:{}", pf.port));
        return EXIT_SUCCESS;
    }

    let port = match port {
        Some(p) => p,
        None => swixter_server::find_available_port(DEFAULT_UI_PORT).await,
    };

    // 子进程参数：原样透传，仅去掉 --daemon（TS 同款过滤）
    let child_args: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| a != "--daemon")
        .collect();

    let log_path = daemon::log_file_path(&dir);
    let log_file = match std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        Ok(f) => f,
        Err(e) => {
            eprintln!("✗ Failed to open log file {}: {e}", log_path.display());
            return EXIT_GENERAL;
        }
    };
    let log_err = match log_file.try_clone() {
        Ok(f) => f,
        Err(e) => {
            eprintln!("✗ Failed to open log file: {e}");
            return EXIT_GENERAL;
        }
    };

    let exe = std::env::current_exe().expect("current exe");
    let mut cmd = std::process::Command::new(exe);
    cmd.args(&child_args)
        .stdin(Stdio::null())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_err))
        .env("SWIXTER_UI_DAEMON", "1");
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    let child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            eprintln!("✗ Failed to spawn daemon: {e}");
            return EXIT_GENERAL;
        }
    };
    let child_pid = child.id();
    drop(child); // unref：不持有句柄，父进程退出不等子进程

    // 立即写 PID 文件，防止并发启动拉起重复实例
    let pid_pf = UiPidFile {
        pid: child_pid,
        port,
        start_time: now_iso(),
    };
    let _ = daemon::write_pid_file(&dir, &pid_pf);

    // 200ms×50 轮询健康检查
    let mut started = false;
    for _ in 0..50 {
        if daemon::health_check(port).await {
            started = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    if !started {
        daemon::terminate(pid_pf.pid, true);
        let _ = daemon::remove_pid_file(&dir);
        println!();
        println!("✗ Failed to start daemon (timed out waiting for server).");
        println!();
        return EXIT_GENERAL;
    }

    println!();
    println!("✓ Swixter UI daemon started");
    println!("  PID:  {}", pid_pf.pid);
    println!("  URL:  http://127.0.0.1:{port}");
    println!("  Log:  {}", log_path.display());
    println!();
    println!("Run 'swixter ui --stop' to stop.");
    println!();
    EXIT_SUCCESS
}

/// TS: --stop
async fn stop() -> i32 {
    match daemon::stop_daemon(&config_dir()).await {
        Ok(msg) => {
            println!();
            println!("✓ {msg}");
            println!();
            EXIT_SUCCESS
        }
        Err(msg) => {
            println!();
            println!("⚠ {msg}");
            println!();
            EXIT_GENERAL
        }
    }
}

/// TS: showStatus —— cleanup stale → 打印运行状态
async fn status() -> i32 {
    let dir = config_dir();
    daemon::cleanup_stale_pid_file(&dir);
    let pf = daemon::read_pid_file(&dir).ok().flatten();

    println!();
    let Some(pf) = pf else {
        println!("Swixter UI is not running.");
        println!("Run 'swixter ui --daemon' to start in background.");
        println!();
        return EXIT_SUCCESS;
    };

    if daemon::is_ui_running(&dir).await.is_some() {
        println!("✓ Swixter UI is running");
        println!("  PID:  {}", pf.pid);
        println!("  URL:  http://127.0.0.1:{}", pf.port);
        println!("  Started: {}", pf.start_time);
        println!("  Log:  {}", daemon::log_file_path(&dir).display());
    } else {
        let _ = daemon::remove_pid_file(&dir);
        println!("⚠ Swixter UI is not running (stale PID file removed).");
    }
    println!();
    EXIT_SUCCESS
}
