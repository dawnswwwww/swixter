//! Task 7: ui.pid 读写/存活性/健康检查/stop（逐条对齐 TS utils/daemon.ts）。
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// TS: PidFileData —— ui.pid 序列化逐字段 camelCase 对齐
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UiPidFile {
    pub pid: u32,
    pub port: u16,
    pub start_time: String,
}

pub fn pid_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join("ui.pid")
}

pub fn log_file_path(config_dir: &Path) -> PathBuf {
    config_dir.join("ui.log")
}

/// TS: readPidFile —— 不存在或解析失败返回 None
pub fn read_pid_file(config_dir: &Path) -> std::io::Result<Option<UiPidFile>> {
    match fs::read_to_string(pid_file_path(config_dir)) {
        Ok(raw) => Ok(serde_json::from_str(&raw).ok()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

/// TS: writePidFile —— 2 空格缩进
pub fn write_pid_file(config_dir: &Path, pf: &UiPidFile) -> std::io::Result<()> {
    fs::create_dir_all(config_dir)?;
    let json = serde_json::to_string_pretty(pf).map_err(std::io::Error::other)?;
    fs::write(pid_file_path(config_dir), json)
}

pub fn remove_pid_file(config_dir: &Path) -> std::io::Result<()> {
    match fs::remove_file(pid_file_path(config_dir)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e),
    }
}

/// TS: isProcessAlive（决策点 7，跨平台 cfg 分支）
#[cfg(unix)]
pub fn pid_alive(pid: u32) -> bool {
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
pub fn pid_alive(pid: u32) -> bool {
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return false;
        }
        windows_sys::Win32::Foundation::CloseHandle(h);
        true
    }
}

/// TS: stopDaemon 的 kill —— graceful=SIGTERM，否则 SIGKILL；
/// Windows 统一 TerminateProcess（无信号语义）
#[cfg(unix)]
pub fn terminate(pid: u32, graceful: bool) {
    unsafe {
        libc::kill(pid as i32, if graceful { libc::SIGTERM } else { libc::SIGKILL });
    }
}

#[cfg(windows)]
pub fn terminate(pid: u32, _graceful: bool) {
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    unsafe {
        let h = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if !h.is_null() {
            TerminateProcess(h, 1);
            windows_sys::Win32::Foundation::CloseHandle(h);
        }
    }
}

/// 健康检查：GET /api/version 3s 200（决策点 7，跨平台统一 HTTP）
pub async fn health_check(port: u16) -> bool {
    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
    else {
        return false;
    };
    client
        .get(format!("http://127.0.0.1:{port}/api/version"))
        .send()
        .await
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

/// TS: isSwixterUiRunning —— pid 存活 + 健康检查双重判定
pub async fn is_ui_running(config_dir: &Path) -> Option<UiPidFile> {
    let pf = read_pid_file(config_dir).ok()??;
    if !pid_alive(pf.pid) {
        return None;
    }
    if !health_check(pf.port).await {
        return None;
    }
    Some(pf)
}

/// TS: cleanupStalePidFile —— pid 已死则删 PID 文件
pub fn cleanup_stale_pid_file(config_dir: &Path) {
    if let Ok(Some(pf)) = read_pid_file(config_dir) {
        if !pid_alive(pf.pid) {
            let _ = remove_pid_file(config_dir);
        }
    }
}

/// TS: stopDaemon —— SIGTERM → 100ms×50 等待 → 仍存活 SIGKILL → 删 PID
pub async fn stop_daemon(config_dir: &Path) -> Result<String, String> {
    let pf = read_pid_file(config_dir)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No daemon process is running.".to_string())?;

    if !pid_alive(pf.pid) {
        let _ = remove_pid_file(config_dir);
        return Err("Daemon process is not running (stale PID file removed).".to_string());
    }

    terminate(pf.pid, true);
    for _ in 0..50 {
        if !pid_alive(pf.pid) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if pid_alive(pf.pid) {
        terminate(pf.pid, false);
    }
    let _ = remove_pid_file(config_dir);
    Ok(format!("Daemon process {} stopped.", pf.pid))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_file_roundtrip_and_stale_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        write_pid_file(
            dir.path(),
            &UiPidFile {
                pid: std::process::id(),
                port: 3141,
                start_time: "2026-07-24T00:00:00Z".into(),
            },
        )
        .unwrap();
        let pf = read_pid_file(dir.path()).unwrap().unwrap();
        assert_eq!(pf.port, 3141);
        // 大数值 pid（不存在）→ 判死并清理
        write_pid_file(
            dir.path(),
            &UiPidFile {
                pid: 4_000_000,
                port: 3141,
                start_time: "t".into(),
            },
        )
        .unwrap();
        cleanup_stale_pid_file(dir.path());
        assert!(read_pid_file(dir.path()).unwrap().is_none());
    }

    #[tokio::test]
    async fn stop_daemon_not_running_errors() {
        let dir = tempfile::tempdir().unwrap();
        let err = stop_daemon(dir.path()).await.unwrap_err();
        assert!(err.contains("No daemon process is running"));
    }
}
