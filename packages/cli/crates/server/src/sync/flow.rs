use std::path::{Path, PathBuf};

use serde_json::{Map, Value};
use swixter_core::config::ConfigManager;
use swixter_core::types::{now_iso, Profile, ProviderPreset, SyncMeta};

use crate::crypto::fields::{decrypt_sensitive_fields, encrypt_sensitive_fields};
use crate::sync::client::{SyncClient, SyncError};
use crate::sync::merge::{detect_conflict, remote_version};
use crate::sync::types::{PullResponse, PushRequest, SyncConflict, SyncStatusEntry};
use crate::ServerError;

/// push/pull 流程上下文。`key_provider` 回调注入取加密 key 的方式：
/// CLI 层用 dialoguer 问 master password 派生（或直接用 auth.json 的 encryptionKey），
/// 测试给固定 key。
pub struct SyncContext<'a> {
    pub client: &'a SyncClient,
    pub config: ConfigManager, // load_from 注入路径
    pub providers_path: PathBuf,
    pub key_provider: &'a dyn Fn() -> Result<[u8; 32], ServerError>,
}

/// 从指定路径读 providers.json（{version, providers}），失败容忍为空数组
pub fn load_providers(path: &Path) -> Vec<ProviderPreset> {
    let raw = match std::fs::read_to_string(path) {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return vec![],
    };
    serde_json::from_value(v.get("providers").cloned().unwrap_or(Value::Null)).unwrap_or_default()
}

/// 覆盖写 providers.json（{version:"1.0.0", providers}，2 空格缩进，对齐 TS）
pub fn save_providers(path: &Path, providers: &[ProviderPreset]) -> Result<(), ServerError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let file = serde_json::json!({"version": "1.0.0", "providers": providers});
    std::fs::write(path, serde_json::to_string_pretty(&file)?)?;
    Ok(())
}

/// 409（服务端乐观锁拒绝）→ SyncConflict，调用方提示 --force-local
fn conflict_err(e: SyncError, meta: Option<&SyncMeta>, remote: u64, data_key: &str) -> ServerError {
    if e.status == 409 {
        let local = match (meta, data_key) {
            (Some(m), "config") => m.config_version,
            (Some(m), "providers") => m.providers_version,
            _ => 0,
        };
        return ServerError::SyncConflict(SyncConflict {
            local_version: local,
            remote_version: remote,
            data_key: data_key.to_string(),
        });
    }
    e.into()
}

/// TS: cli/sync.ts cmdPush
///
/// encryptedData 包裹层次（逐行对照 TS 校准）：`JSON.stringify(encryptedProfiles)`，
/// 即 {profileId: profile} map 直接序列化——只有 apiKey/authToken 字段级加密，
/// **没有**对整个 payload 二次 encrypt。providers 同理：
/// `JSON.stringify(encryptSensitiveFields(key, {providers}))`。
pub async fn push_flow(ctx: &mut SyncContext<'_>, force_local: bool) -> Result<(), ServerError> {
    let statuses = ctx.client.status().await?;
    let meta = ctx.config.config().sync_meta.clone();
    if !force_local {
        if let Some(c) = detect_conflict(meta.as_ref(), &statuses, "config") {
            return Err(ServerError::SyncConflict(c));
        }
    }
    let key = (ctx.key_provider)()?;

    // config：{profileId: profile}，逐 profile 加密敏感字段
    let mut profiles = Map::new();
    for (id, p) in &ctx.config.config().profiles {
        let v = serde_json::to_value(p)?;
        profiles.insert(id.clone(), encrypt_sensitive_fields(&key, &v)?);
    }
    let config_remote = remote_version(&statuses, "config");
    let resp = ctx
        .client
        .push(PushRequest {
            data_key: "config".into(),
            encrypted_data: serde_json::to_string(&profiles)?,
            data_version: config_remote,
            client_timestamp: now_iso(),
        })
        .await
        .map_err(|e| conflict_err(e, meta.as_ref(), config_remote, "config"))?;

    // providers：{providers:[...]}，字段级加密后 push
    let providers = load_providers(&ctx.providers_path);
    let wrapped = encrypt_sensitive_fields(&key, &serde_json::json!({ "providers": providers }))?;
    let providers_remote = remote_version(&statuses, "providers");
    let prov_resp = ctx
        .client
        .push(PushRequest {
            data_key: "providers".into(),
            encrypted_data: serde_json::to_string(&wrapped)?,
            data_version: providers_remote,
            client_timestamp: now_iso(),
        })
        .await
        .map_err(|e| conflict_err(e, meta.as_ref(), providers_remote, "providers"))?;

    // 写回 syncMeta：服务端版本号，不带 dirty（清除）
    let now = now_iso();
    ctx.config.config_mut_for_test().sync_meta = Some(SyncMeta {
        last_sync_at: now.clone(),
        config_version: resp.data_version,
        providers_version: prov_resp.data_version,
        local_updated_at: now,
        dirty: None,
    });
    ctx.config.save()?;
    Ok(())
}

/// TS: cli/sync.ts cmdPull
pub async fn pull_flow(ctx: &mut SyncContext<'_>, force_remote: bool) -> Result<(), ServerError> {
    // pull config；404 → 提示先 push
    let pulled: PullResponse = ctx.client.pull("config").await?.ok_or_else(|| {
        ServerError::Sync(SyncError {
            status: 404,
            code: "NOT_FOUND".into(),
            message: "No remote data found. Push first with 'swixter sync push'".into(),
        })
    })?;

    // 冲突检查（非 force_remote）
    let meta = ctx.config.config().sync_meta.clone();
    if !force_remote {
        let entries = [SyncStatusEntry {
            data_key: "config".into(),
            data_version: pulled.data_version,
            updated_at: pulled.updated_at.clone(),
        }];
        if let Some(c) = detect_conflict(meta.as_ref(), &entries, "config") {
            return Err(ServerError::SyncConflict(c));
        }
    }

    let key = (ctx.key_provider)()?;

    // 解密覆盖写入同名 profile（本地独有保留）
    let encrypted: Map<String, Value> = serde_json::from_str(&pulled.encrypted_data)?;
    for (id, p) in &encrypted {
        let dec = decrypt_sensitive_fields(&key, p)?;
        let profile: Profile = serde_json::from_value(dec)?;
        ctx.config
            .config_mut_for_test()
            .profiles
            .insert(id.clone(), profile);
    }

    // pull providers（404 容忍）→ 覆盖写 providers.json
    let mut providers_version = meta.as_ref().map(|m| m.providers_version).unwrap_or(0);
    if let Some(pr) = ctx.client.pull("providers").await? {
        let wrapped: Value = serde_json::from_str(&pr.encrypted_data)?;
        let dec = decrypt_sensitive_fields(&key, &wrapped)?;
        if let Some(list) = dec.get("providers").and_then(|v| v.as_array()) {
            let providers: Vec<ProviderPreset> =
                serde_json::from_value(Value::Array(list.clone()))?;
            save_providers(&ctx.providers_path, &providers)?;
            providers_version = pr.data_version;
        }
    }

    // 写回 syncMeta（不带 dirty，即清除）
    let now = now_iso();
    ctx.config.config_mut_for_test().sync_meta = Some(SyncMeta {
        last_sync_at: now.clone(),
        config_version: pulled.data_version,
        providers_version,
        local_updated_at: now,
        dirty: None,
    });
    ctx.config.save()?;
    Ok(())
}
