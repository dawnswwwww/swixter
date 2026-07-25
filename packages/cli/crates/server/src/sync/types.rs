use serde::{Deserialize, Serialize};

/// TS: sync/types.ts SyncStatusEntry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusEntry {
    pub data_key: String,
    pub data_version: u64,
    pub updated_at: String,
}

/// TS: SyncStatusResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusResponse {
    pub statuses: Vec<SyncStatusEntry>,
}

/// TS: PushRequest
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushRequest {
    pub data_key: String,
    pub encrypted_data: String,
    /// 远端当前版本（无则 0），服务端乐观锁
    pub data_version: u64,
    pub client_timestamp: String,
}

/// TS: PushResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResponse {
    #[allow(dead_code)]
    pub success: bool,
    pub data_version: u64,
    #[allow(dead_code)]
    pub updated_at: String,
}

/// TS: PullResponse
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResponse {
    #[allow(dead_code)]
    pub data_key: String,
    pub encrypted_data: String,
    pub data_version: u64,
    #[allow(dead_code)]
    pub client_timestamp: String,
    #[allow(dead_code)]
    pub updated_at: String,
}

/// TS: SyncConflict
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConflict {
    pub local_version: u64,
    pub remote_version: u64,
    pub data_key: String,
}

impl std::fmt::Display for SyncConflict {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "version conflict on {}: local v{}, remote v{}",
            self.data_key, self.local_version, self.remote_version
        )
    }
}
