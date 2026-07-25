use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstanceKind {
    #[default]
    Service,
    Run,
}

/// TS: proxy/types.ts ProxyStatus —— proxy-instances.json 序列化格式逐字段对齐
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyStatus {
    pub instance_id: String,
    #[serde(rename = "type")]
    pub kind: InstanceKind,
    pub running: bool,
    pub host: String,
    pub port: u16,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_group: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<String>,
    pub request_count: u64,
    pub error_count: u64,
}

impl Default for ProxyStatus {
    fn default() -> Self {
        Self {
            instance_id: String::new(),
            kind: InstanceKind::default(),
            running: false,
            host: crate::DEFAULT_PROXY_HOST.to_string(),
            port: crate::DEFAULT_PROXY_PORT,
            group_name: None,
            active_group: None,
            profile_name: None,
            pid: None,
            start_time: None,
            request_count: 0,
            error_count: 0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ProxyServerConfig {
    pub instance_id: String,
    pub kind: InstanceKind,
    pub host: String,
    pub port: u16,
    pub timeout: Duration,
    pub group_name: Option<String>,
    pub profile_name: Option<String>,
    /// 测试注入；None → swixter_core::paths::config_path()
    pub config_path: Option<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxy_status_matches_ts_json() {
        let raw = r#"{"instanceId":"default","type":"service","running":true,"host":"127.0.0.1","port":15721,"groupName":"failover","activeGroup":"failover","pid":12345,"startTime":"2026-07-24T01:00:00.000Z","requestCount":3,"errorCount":1}"#;
        let s: ProxyStatus = serde_json::from_str(raw).unwrap();
        assert_eq!(s.kind, InstanceKind::Service);
        assert_eq!(s.request_count, 3);
        let back: serde_json::Value =
            serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        let orig: serde_json::Value = serde_json::from_str(raw).unwrap();
        assert_eq!(back, orig);
    }

    #[test]
    fn instance_kind_default_is_service() {
        assert_eq!(InstanceKind::default(), InstanceKind::Service);
    }
}
