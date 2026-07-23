use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock, RwLock};

use crate::types::{InstanceKind, ProxyStatus};
use crate::{DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct InstanceRegistry {
    pub instances: HashMap<String, ProxyStatus>,
}

/// 测试用路径覆盖（避免并行测试污染真实配置目录，计划决策点 7 同款思路）。
static PATH_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();
static OVERRIDE_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

fn override_slot() -> &'static RwLock<Option<PathBuf>> {
    PATH_OVERRIDE.get_or_init(|| RwLock::new(None))
}

fn path_override() -> Option<PathBuf> {
    override_slot().read().ok()?.clone()
}

/// 持有期间将 registry 路径覆盖为指定文件；Drop 时恢复原值。
/// 全局互斥锁保证并行测试不会互相干扰。
pub struct RegistryPathOverride {
    _guard: MutexGuard<'static, ()>,
    previous: Option<PathBuf>,
}

impl RegistryPathOverride {
    pub fn set(path: PathBuf) -> Self {
        let guard = OVERRIDE_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let previous = override_slot().write().unwrap().replace(path);
        Self {
            _guard: guard,
            previous,
        }
    }
}

impl Drop for RegistryPathOverride {
    fn drop(&mut self) {
        *override_slot().write().unwrap() = self.previous.take();
    }
}

pub fn registry_path() -> PathBuf {
    if let Some(p) = path_override() {
        return p;
    }
    swixter_core::paths::config_path()
        .parent()
        .unwrap()
        .join("proxy-instances.json")
}

fn legacy_runtime_path() -> PathBuf {
    registry_path()
        .parent()
        .unwrap()
        .join("proxy-runtime.json")
}

pub fn load_registry() -> InstanceRegistry {
    std::fs::read_to_string(registry_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save_registry(registry: &InstanceRegistry) -> std::io::Result<()> {
    let path = registry_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(registry)?)
}

pub fn update_instance(status: &ProxyStatus) {
    let mut r = load_registry();
    r.instances.insert(status.instance_id.clone(), status.clone());
    let _ = save_registry(&r);
}

pub fn remove_instance(instance_id: &str) {
    let mut r = load_registry();
    if r.instances.remove(instance_id).is_some() {
        let _ = save_registry(&r);
    }
}

/// 清 stale：running 且 pid 不存活的条目删除（无 pid 视为不存活）
pub fn clean_stale_instances() {
    let mut r = load_registry();
    let before = r.instances.len();
    r.instances
        .retain(|_, s| !(s.running && !is_process_alive(s.pid.unwrap_or(0))));
    if r.instances.len() != before {
        let _ = save_registry(&r);
    }
}

/// TS: migrateLegacyRuntime —— 旧格式 proxy-runtime.json 一次性迁移；registry 已存在则跳过。
/// 旧格式缺 instanceId/type，靠 serde default 补齐后强制 instance_id = "default"。
pub fn migrate_legacy_runtime() {
    let legacy = legacy_runtime_path();
    if !legacy.exists() || registry_path().exists() {
        return;
    }
    let parsed = std::fs::read_to_string(&legacy)
        .ok()
        .and_then(|raw| serde_json::from_str::<ProxyStatus>(&raw).ok());
    if let Some(mut s) = parsed {
        if s.running {
            s.instance_id = "default".into();
            s.kind = InstanceKind::Service;
            let mut r = InstanceRegistry::default();
            r.instances.insert("default".into(), s);
            let _ = save_registry(&r);
        }
    }
}

/// 未找到时返回 running:false 占位（host/port 为默认值）
pub fn get_proxy_status(instance_id: &str) -> ProxyStatus {
    migrate_legacy_runtime();
    clean_stale_instances();
    load_registry()
        .instances
        .get(instance_id)
        .cloned()
        .unwrap_or_else(|| ProxyStatus {
            instance_id: instance_id.to_string(),
            host: DEFAULT_PROXY_HOST.into(),
            port: DEFAULT_PROXY_PORT,
            ..Default::default()
        })
}

pub fn list_proxy_instances() -> Vec<ProxyStatus> {
    migrate_legacy_runtime();
    clean_stale_instances();
    load_registry().instances.into_values().collect()
}

#[cfg(unix)]
pub fn is_process_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

#[cfg(windows)]
pub fn is_process_alive(pid: u32) -> bool {
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    if pid == 0 {
        return false;
    }
    let h = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if h.is_null() {
        return false;
    }
    unsafe {
        windows_sys::Win32::Foundation::CloseHandle(h);
    }
    true
}

/// 决策点 3：Unix SIGTERM → ≤5s 轮询 → SIGKILL；Windows 无 SIGTERM，直接 TerminateProcess
#[cfg(unix)]
pub fn terminate_process(pid: u32) {
    unsafe {
        libc::kill(pid as i32, libc::SIGTERM);
    }
    for _ in 0..50 {
        if !is_process_alive(pid) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    if is_process_alive(pid) {
        unsafe {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }
}

#[cfg(windows)]
pub fn terminate_process(pid: u32) {
    use windows_sys::Win32::System::Threading::{
        OpenProcess, TerminateProcess, PROCESS_TERMINATE,
    };
    let h = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if !h.is_null() {
        unsafe {
            TerminateProcess(h, 1);
            windows_sys::Win32::Foundation::CloseHandle(h);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::InstanceKind;

    fn status(id: &str, pid: Option<u32>) -> ProxyStatus {
        ProxyStatus {
            instance_id: id.into(),
            kind: InstanceKind::Service,
            running: true,
            host: "127.0.0.1".into(),
            port: 15721,
            pid,
            start_time: Some("2026-07-24T01:00:00.000Z".into()),
            ..Default::default()
        }
    }

    #[test]
    fn registry_roundtrip_and_remove() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
        update_instance(&status("default", Some(std::process::id())));
        let list = list_proxy_instances();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].instance_id, "default");
        // JSON 格式与 TS 一致：camelCase + 2 空格缩进
        let raw = std::fs::read_to_string(registry_path()).unwrap();
        assert!(raw.contains("\n  \"instances\": {"));
        assert!(raw.contains("\"instanceId\": \"default\""));
        remove_instance("default");
        assert!(list_proxy_instances().is_empty());
    }

    #[test]
    fn stale_entries_cleaned_by_pid_liveness() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
        update_instance(&status("alive", Some(std::process::id())));
        update_instance(&status("dead", Some(4_000_000))); // 几乎不可能存活的 pid
        clean_stale_instances();
        let list = list_proxy_instances();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].instance_id, "alive");
    }

    #[test]
    fn legacy_runtime_migrated_once() {
        let dir = tempfile::tempdir().unwrap();
        let legacy = dir.path().join("proxy-runtime.json");
        std::fs::write(
            &legacy,
            r#"{"running":true,"host":"127.0.0.1","port":15721,"pid":4000000}"#,
        )
        .unwrap();
        let _guard = RegistryPathOverride::set(dir.path().join("proxy-instances.json"));
        migrate_legacy_runtime();
        let s = get_proxy_status("default");
        assert_eq!(s.port, 15721);
        // registry 已存在后不再重复迁移
        remove_instance("default");
        migrate_legacy_runtime();
        assert!(list_proxy_instances().is_empty());
    }

    #[test]
    fn corrupt_registry_falls_back_to_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy-instances.json");
        std::fs::write(&path, "{not json").unwrap();
        let _guard = RegistryPathOverride::set(path);
        assert!(list_proxy_instances().is_empty());
    }

    #[test]
    fn current_process_is_alive() {
        assert!(is_process_alive(std::process::id()));
        assert!(!is_process_alive(4_000_000));
    }
}
