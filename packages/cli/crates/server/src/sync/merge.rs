use swixter_core::types::SyncMeta;

use crate::sync::types::{SyncConflict, SyncStatusEntry};

fn local_version(meta: Option<&SyncMeta>, data_key: &str) -> u64 {
    match (meta, data_key) {
        (Some(m), "config") => m.config_version,
        (Some(m), "providers") => m.providers_version,
        _ => 0,
    }
}

/// TS: sync/merge.ts detectConflict
/// local==remote 或任一方为 0 → 无冲突；双方非零且不等 → 冲突。
pub fn detect_conflict(
    local_meta: Option<&SyncMeta>,
    remote_statuses: &[SyncStatusEntry],
    data_key: &str,
) -> Option<SyncConflict> {
    let local = local_version(local_meta, data_key);
    let remote = remote_statuses
        .iter()
        .find(|s| s.data_key == data_key)
        .map(|s| s.data_version)
        .unwrap_or(0);
    if local == remote || local == 0 || remote == 0 {
        return None;
    }
    Some(SyncConflict {
        local_version: local,
        remote_version: remote,
        data_key: data_key.to_string(),
    })
}

/// 远端某 dataKey 的当前版本（无则 0）——push 的 dataVersion 用它（乐观锁）
pub fn remote_version(statuses: &[SyncStatusEntry], data_key: &str) -> u64 {
    statuses
        .iter()
        .find(|s| s.data_key == data_key)
        .map(|s| s.data_version)
        .unwrap_or(0)
}
