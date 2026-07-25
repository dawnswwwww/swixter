use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

use swixter_core::config::ConfigManager;
use swixter_core::types::{now_iso, Profile, ProviderPreset, SyncMeta};

use crate::auth::client::AuthClient;
use crate::auth::token::TokenStore;
use crate::crypto::derive::key_from_base64;
use crate::crypto::fields::{decrypt_sensitive_fields, encrypt_sensitive_fields};
use crate::sync::client::SyncClient;
use crate::sync::flow::{load_providers, save_providers};
use crate::sync::merge::remote_version;
use crate::sync::types::PushRequest;
use crate::ServerError;

/// TS: sync/auto-sync.ts —— 进程内开关，默认 false，无持久化（决策点 2）；
/// enable/disable 仅对当前进程生效
static ENABLED: AtomicBool = AtomicBool::new(false);
static IS_SYNCING: AtomicBool = AtomicBool::new(false);

pub fn is_enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
}

/// isSyncing 复位守卫（手写 Drop，不引入 scopeguard 依赖）
struct SyncGuard;
impl Drop for SyncGuard {
    fn drop(&mut self) {
        IS_SYNCING.store(false, Ordering::SeqCst);
    }
}

pub struct AutoSyncContext {
    pub base_url: String,
    pub auth_path: PathBuf,
    pub config_path: PathBuf,
    pub providers_path: PathBuf,
}

/// 已登录且 auth.json 存有 encryptionKey → (token, key)；否则 None（静默跳过）。
/// auto-sync 不能交互问 master password，所以只接受已存储的 key。
async fn token_and_key(ctx: &AutoSyncContext) -> Option<(String, [u8; 32])> {
    let store = TokenStore::new(ctx.auth_path.clone());
    let state = store.load()?;
    let key_b64 = state.encryption_key.clone()?;
    let token = store
        .get_access_token(&AuthClient::new(&ctx.base_url))
        .await?;
    let key = key_from_base64(&key_b64).ok()?;
    Some((token, key))
}

/// TS: auto-sync.ts syncPush —— 触发条件 dirty || !syncMeta || localVersion != remoteVersion；
/// 成功写回 dirty:false。不做冲突检查（auto-sync 以后台合并为准）。
async fn push_inner(ctx: &AutoSyncContext) -> Result<(), ServerError> {
    let Some((token, key)) = token_and_key(ctx).await else {
        return Ok(());
    };
    let client = SyncClient::new(&ctx.base_url, token);
    let statuses = client.status().await?;
    let mut mgr = ConfigManager::load_from(ctx.config_path.clone());
    let meta = mgr.config().sync_meta.clone();
    let dirty = meta.as_ref().and_then(|m| m.dirty).unwrap_or(false);

    // config
    let config_remote = remote_version(&statuses, "config");
    if dirty
        || meta.is_none()
        || meta
            .as_ref()
            .is_some_and(|m| m.config_version != config_remote)
    {
        let mut profiles = serde_json::Map::new();
        for (id, p) in &mgr.config().profiles {
            let v = serde_json::to_value(p)?;
            profiles.insert(id.clone(), encrypt_sensitive_fields(&key, &v)?);
        }
        let resp = client
            .push(PushRequest {
                data_key: "config".into(),
                encrypted_data: serde_json::to_string(&profiles)?,
                data_version: config_remote,
                client_timestamp: now_iso(),
            })
            .await?;
        let now = now_iso();
        mgr.config_mut_for_test().sync_meta = Some(SyncMeta {
            last_sync_at: now.clone(),
            config_version: resp.data_version,
            providers_version: meta.as_ref().map(|m| m.providers_version).unwrap_or(0),
            local_updated_at: now,
            dirty: Some(false), // auto-sync push 成功写回 dirty:false
        });
        mgr.save()?;
    }

    // providers（本地为空则不 push）
    let providers = load_providers(&ctx.providers_path);
    let providers_remote = remote_version(&statuses, "providers");
    if !providers.is_empty()
        && (dirty
            || meta.is_none()
            || meta
                .as_ref()
                .is_some_and(|m| m.providers_version != providers_remote))
    {
        let wrapped =
            encrypt_sensitive_fields(&key, &serde_json::json!({ "providers": providers }))?;
        let resp = client
            .push(PushRequest {
                data_key: "providers".into(),
                encrypted_data: serde_json::to_string(&wrapped)?,
                data_version: providers_remote,
                client_timestamp: now_iso(),
            })
            .await?;
        // 展开现有 syncMeta（保留 configVersion / dirty:false），只更新 providersVersion
        let now = now_iso();
        let base = mgr.config().sync_meta.clone().unwrap_or(SyncMeta {
            last_sync_at: now.clone(),
            config_version: 0,
            providers_version: 0,
            local_updated_at: now.clone(),
            dirty: None,
        });
        mgr.config_mut_for_test().sync_meta = Some(SyncMeta {
            providers_version: resp.data_version,
            ..base
        });
        mgr.save()?;
    }
    Ok(())
}

/// TS: auto-sync.ts syncPull —— 版本不同才合并；404 容忍；不做冲突检查。
async fn pull_inner(ctx: &AutoSyncContext) -> Result<(), ServerError> {
    let Some((token, key)) = token_and_key(ctx).await else {
        return Ok(());
    };
    let client = SyncClient::new(&ctx.base_url, token);
    let mut mgr = ConfigManager::load_from(ctx.config_path.clone());
    let meta = mgr.config().sync_meta.clone();

    // config：远端覆盖同名 profile，本地独有保留
    if let Some(pulled) = client.pull("config").await? {
        if meta.is_none()
            || meta
                .as_ref()
                .is_some_and(|m| m.config_version != pulled.data_version)
        {
            let encrypted: serde_json::Map<String, serde_json::Value> =
                serde_json::from_str(&pulled.encrypted_data)?;
            for (id, p) in &encrypted {
                let dec = decrypt_sensitive_fields(&key, p)?;
                let profile: Profile = serde_json::from_value(dec)?;
                mgr.config_mut_for_test()
                    .profiles
                    .insert(id.clone(), profile);
            }
            let now = now_iso();
            mgr.config_mut_for_test().sync_meta = Some(SyncMeta {
                last_sync_at: now.clone(),
                config_version: pulled.data_version,
                providers_version: meta.as_ref().map(|m| m.providers_version).unwrap_or(0),
                local_updated_at: now,
                dirty: None,
            });
            mgr.save()?;
        }
    }

    // providers
    if let Some(pr) = client.pull("providers").await? {
        if meta.is_none()
            || meta
                .as_ref()
                .is_some_and(|m| m.providers_version != pr.data_version)
        {
            let wrapped: serde_json::Value = serde_json::from_str(&pr.encrypted_data)?;
            let dec = decrypt_sensitive_fields(&key, &wrapped)?;
            if let Some(list) = dec.get("providers").and_then(|v| v.as_array()) {
                let providers: Vec<ProviderPreset> =
                    serde_json::from_value(serde_json::Value::Array(list.clone()))?;
                if !providers.is_empty() {
                    save_providers(&ctx.providers_path, &providers)?;
                }
            }
            let now = now_iso();
            let base = mgr.config().sync_meta.clone().unwrap_or(SyncMeta {
                last_sync_at: now.clone(),
                config_version: 0,
                providers_version: 0,
                local_updated_at: now.clone(),
                dirty: None,
            });
            mgr.config_mut_for_test().sync_meta = Some(SyncMeta {
                providers_version: pr.data_version,
                ..base
            });
            mgr.save()?;
        }
    }
    Ok(())
}

/// TS: syncPush 入口 —— 开关 + isSyncing CAS 互斥；任何错误吞掉（eprintln 警告）
pub async fn sync_push_if_enabled(ctx: &AutoSyncContext) {
    if !is_enabled() {
        return;
    }
    if IS_SYNCING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return; // 互斥：进行中直接跳过
    }
    let _guard = SyncGuard;
    if let Err(e) = push_inner(ctx).await {
        eprintln!("auto-sync push failed: {e}");
    }
}

/// TS: syncPull 入口，同 sync_push_if_enabled 模式
pub async fn sync_pull_if_enabled(ctx: &AutoSyncContext) {
    if !is_enabled() {
        return;
    }
    if IS_SYNCING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }
    let _guard = SyncGuard;
    if let Err(e) = pull_inner(ctx).await {
        eprintln!("auto-sync pull failed: {e}");
    }
}

/// TS: loadConfigWithSync —— 先 pull（错误吞掉），再 load
pub async fn load_config_with_sync(ctx: &AutoSyncContext) -> ConfigManager {
    sync_pull_if_enabled(ctx).await;
    ConfigManager::load_from(ctx.config_path.clone())
}

/// TS: saveConfigWithSync —— 先写盘（写盘错误传播），再 push（错误吞掉）
pub async fn save_config_with_sync(
    ctx: &AutoSyncContext,
    mgr: &ConfigManager,
) -> Result<(), ServerError> {
    mgr.save()?;
    sync_push_if_enabled(ctx).await;
    Ok(())
}
