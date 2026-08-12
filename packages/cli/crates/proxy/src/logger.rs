use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, OnceLock, RwLock};

use crate::MAX_PROXY_LOG_SIZE_BYTES;

/// 测试用日志目录覆盖（同 registry 的路径注入思路）
static DIR_OVERRIDE: OnceLock<RwLock<Option<PathBuf>>> = OnceLock::new();
static OVERRIDE_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

fn override_slot() -> &'static RwLock<Option<PathBuf>> {
    DIR_OVERRIDE.get_or_init(|| RwLock::new(None))
}

fn log_dir_override() -> Option<PathBuf> {
    override_slot().read().ok()?.clone()
}

/// 持有期间将日志目录覆盖为指定目录；Drop 时恢复原值。
pub struct LogPathOverride {
    _guard: MutexGuard<'static, ()>,
    previous: Option<PathBuf>,
}

impl LogPathOverride {
    pub fn set(dir: PathBuf) -> Self {
        let guard = OVERRIDE_MUTEX
            .get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let previous = override_slot().write().unwrap().replace(dir);
        Self {
            _guard: guard,
            previous,
        }
    }
}

impl Drop for LogPathOverride {
    fn drop(&mut self) {
        *override_slot().write().unwrap() = self.previous.take();
    }
}

pub fn proxy_log_path(instance_id: &str) -> PathBuf {
    if let Some(dir) = log_dir_override() {
        return dir.join(format!("proxy-{instance_id}.log"));
    }
    swixter_core::paths::config_path()
        .parent()
        .unwrap()
        .join(format!("proxy-{instance_id}.log"))
}

/// 单代滚动：超过阈值 → 删 .1 → rename 为 .1（TS rotateProxyLogIfNeeded）
fn rotate_if_needed(path: &std::path::Path, max_size: u64) {
    let Ok(meta) = std::fs::metadata(path) else {
        return;
    };
    if meta.len() < max_size {
        return;
    }
    let rotated = path.with_file_name(format!("{}.1", path.file_name().unwrap().to_string_lossy()));
    let _ = std::fs::remove_file(&rotated);
    let _ = std::fs::rename(path, rotated);
}

#[derive(Clone)]
pub struct ProxyLogger {
    instance_id: String,
}

impl ProxyLogger {
    pub fn new(instance_id: &str) -> Self {
        Self {
            instance_id: instance_id.to_string(),
        }
    }

    pub fn info(&self, msg: &str, meta: Option<Value>) {
        self.write("info", json!({"msg": msg}), meta);
    }

    pub fn warn(&self, msg: &str, meta: Option<Value>) {
        self.write("warn", json!({"msg": msg}), meta);
    }

    pub fn error(&self, msg: &str, err: Option<&dyn std::error::Error>, meta: Option<Value>) {
        let mut rec = json!({"msg": msg});
        if let Some(e) = err {
            rec["error"] = json!(e.to_string());
        }
        self.write("error", rec, meta);
    }

    pub fn request(&self, method: &str, path: &str, status: u16, duration_ms: u64) {
        self.write(
            "access",
            json!({"method": method, "path": path, "status": status, "durationMs": duration_ms}),
            None,
        );
    }

    fn write(&self, level: &str, mut record: Value, meta: Option<Value>) {
        // 日志绝不能中断代理流程：所有失败静默（TS writeProxyLog catch{}）
        let obj = record.as_object_mut().unwrap();
        obj.insert("ts".into(), json!(swixter_core::types::now_iso()));
        obj.insert("level".into(), json!(level));
        obj.insert("instanceId".into(), json!(self.instance_id));
        if let Some(Value::Object(m)) = meta {
            obj.extend(m);
        }
        let path = proxy_log_path(&self.instance_id);
        let _ = (|| -> std::io::Result<()> {
            if let Some(dir) = path.parent() {
                std::fs::create_dir_all(dir)?;
            }
            rotate_if_needed(&path, MAX_PROXY_LOG_SIZE_BYTES);
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)?;
            writeln!(f, "{}", serde_json::to_string(&record).unwrap())?;
            Ok(())
        })();
        // 无订阅者 → send 返回 Err，忽略（决策点 2）
        let _ = crate::events::event_bus().send(crate::events::ProxyEvent::Log {
            instance_id: self.instance_id.clone(),
            entry: record,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jsonl_fields_and_silent_failure() {
        let dir = tempfile::tempdir().unwrap();
        let _guard = LogPathOverride::set(dir.path().to_path_buf());
        let log = ProxyLogger::new("default");
        log.info("hello", Some(serde_json::json!({"k": 1})));
        log.request("POST", "/v1/messages", 200, 42);
        let lines: Vec<serde_json::Value> = std::fs::read_to_string(proxy_log_path("default"))
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(lines[0]["level"], "info");
        assert_eq!(lines[0]["msg"], "hello");
        assert_eq!(lines[0]["instanceId"], "default");
        assert_eq!(lines[0]["k"], 1);
        assert!(lines[0]["ts"].is_string());
        assert_eq!(lines[1]["level"], "access");
        assert_eq!(lines[1]["method"], "POST");
        assert_eq!(lines[1]["status"], 200);
        assert_eq!(lines[1]["durationMs"], 42);
        // 写失败静默：目录删除后调用不 panic
        std::fs::remove_dir_all(dir.path()).unwrap();
        log.info("gone", None);
    }

    #[test]
    fn rotates_at_size_limit_single_generation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("proxy-default.log");
        std::fs::write(&path, "x".repeat(1024)).unwrap();
        std::fs::write(dir.path().join("proxy-default.log.1"), "old".as_bytes()).unwrap();
        rotate_if_needed(&path, 1024); // 内部函数以可测的小阈值调用
        assert!(!path.exists());
        assert_eq!(
            std::fs::read(dir.path().join("proxy-default.log.1"))
                .unwrap()
                .len(),
            1024
        );
    }
}
