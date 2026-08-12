//! TS: cli/sync.ts —— swixter sync push|pull|status|enable|disable
use std::path::PathBuf;

use dialoguer::Password;
use swixter_core::config::ConfigManager;
use swixter_server::auth::client::AuthClient;
use swixter_server::auth::token::TokenStore;
use swixter_server::auth::types::AuthState;
use swixter_server::crypto::derive::{derive_key, key_from_base64};
use swixter_server::sync::auto_sync;
use swixter_server::sync::client::SyncClient;
use swixter_server::sync::flow::{pull_flow, push_flow, SyncContext};
use swixter_server::{ServerError, API_BASE};

use crate::cli::{SyncArgs, SyncCommand};
use crate::{EXIT_GENERAL, EXIT_SUCCESS};

pub fn dispatch(args: SyncArgs) -> i32 {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    rt.block_on(async move {
        match args.command {
            SyncCommand::Enable => {
                auto_sync::set_enabled(true);
                println!("✓ Auto sync enabled");
                // 决策点 2：进程内开关，不落盘（与 TS 一致）
                println!("Note: only effective for the current process, not persisted");
                EXIT_SUCCESS
            }
            SyncCommand::Disable => {
                auto_sync::set_enabled(false);
                println!("✓ Auto sync disabled");
                EXIT_SUCCESS
            }
            SyncCommand::Status => status().await,
            SyncCommand::Push { force_local } => push(force_local).await,
            SyncCommand::Pull { force_remote } => pull(force_remote).await,
        }
    })
}

/// 测试/私有部署可用 SWIXTER_API_BASE 覆盖云端地址（与 commands/auth.rs 同款）
fn api_base() -> String {
    std::env::var("SWIXTER_API_BASE")
        .ok()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| API_BASE.to_string())
}

fn auth_path() -> PathBuf {
    swixter_core::paths::config_path()
        .parent()
        .map(|p| p.join("auth.json"))
        .unwrap_or_else(|| swixter_core::paths::swixter_config_dir().join("auth.json"))
}

/// TS: requireAuth —— 未登录打印提示返回 None（调用方 exit 1）
async fn require_auth() -> Option<(SyncClient, AuthState)> {
    let store = TokenStore::new(auth_path());
    let auth = AuthClient::new(api_base());
    let token = store.get_access_token(&auth).await?;
    let state = store.load()?;
    Some((SyncClient::new(api_base(), token), state))
}

fn print_not_logged_in() {
    println!("Not logged in.");
    println!("Run 'swixter auth login' first");
}

/// TS: getEncryptionKey —— auth.json 有 encryptionKey 直接用，否则问 master password 派生
fn make_key_provider(state: &AuthState) -> impl Fn() -> Result<[u8; 32], ServerError> {
    let encryption_key = state.encryption_key.clone();
    let salt = state.encryption_salt.clone();
    move || {
        if let Some(k) = &encryption_key {
            return key_from_base64(k);
        }
        let master_password = Password::with_theme(&crate::theme::swixter_theme())
            .with_prompt("Master password:")
            .validate_with(|v: &String| {
                if v.is_empty() {
                    Err("Master password is required for encryption")
                } else {
                    Ok(())
                }
            })
            .interact()
            .map_err(|_| ServerError::Auth("cancelled".into()))?;
        derive_key(&master_password, &salt)
    }
}

/// TS: cmdPush —— 冲突提示 --force-local
pub async fn push(force_local: bool) -> i32 {
    let Some((client, state)) = require_auth().await else {
        print_not_logged_in();
        return EXIT_GENERAL;
    };
    let key_provider = make_key_provider(&state);
    let mut ctx = SyncContext {
        client: &client,
        config: ConfigManager::load(),
        providers_path: swixter_core::paths::providers_path(),
        key_provider: &key_provider,
    };
    println!("Pushing config to cloud...");
    match push_flow(&mut ctx, force_local).await {
        Ok(()) => {
            let meta = ctx.config.config().sync_meta.clone().unwrap_or_default();
            println!(
                "✓ Pushed config (v{}), providers (v{})",
                meta.config_version, meta.providers_version
            );
            EXIT_SUCCESS
        }
        Err(ServerError::SyncConflict(c)) => {
            println!("Version conflict detected!");
            println!(
                "  Local version: {}, Remote version: {}",
                c.local_version, c.remote_version
            );
            println!("  Use --force-local to overwrite remote, or pull first");
            EXIT_GENERAL
        }
        Err(ServerError::Auth(e)) if e == "cancelled" => EXIT_SUCCESS,
        Err(e) => {
            eprintln!("✗ Push failed");
            eprintln!("{e}");
            EXIT_GENERAL
        }
    }
}

/// TS: cmdPull —— 冲突提示 --force-remote；404 提示先 push
pub async fn pull(force_remote: bool) -> i32 {
    let Some((client, state)) = require_auth().await else {
        print_not_logged_in();
        return EXIT_GENERAL;
    };
    let key_provider = make_key_provider(&state);
    let mut ctx = SyncContext {
        client: &client,
        config: ConfigManager::load(),
        providers_path: swixter_core::paths::providers_path(),
        key_provider: &key_provider,
    };
    println!("Pulling config from cloud...");
    match pull_flow(&mut ctx, force_remote).await {
        Ok(()) => {
            let meta = ctx.config.config().sync_meta.clone().unwrap_or_default();
            println!(
                "✓ Pulled config (v{}), providers (v{})",
                meta.config_version, meta.providers_version
            );
            EXIT_SUCCESS
        }
        Err(ServerError::SyncConflict(c)) => {
            println!("Version conflict detected!");
            println!(
                "  Local version: {}, Remote version: {}",
                c.local_version, c.remote_version
            );
            println!("  Use --force-remote to overwrite local, or push first");
            EXIT_GENERAL
        }
        Err(ServerError::Auth(e)) if e == "cancelled" => EXIT_SUCCESS,
        Err(ServerError::Sync(e)) if e.status == 404 => {
            eprintln!("✗ Pull failed");
            println!("No remote data found. Push first with 'swixter sync push'");
            EXIT_GENERAL
        }
        Err(e) => {
            eprintln!("✗ Pull failed");
            eprintln!("{e}");
            EXIT_GENERAL
        }
    }
}

/// TS: cmdStatus —— 本地 syncMeta + 远端 status
async fn status() -> i32 {
    let Some((client, _state)) = require_auth().await else {
        print_not_logged_in();
        return EXIT_GENERAL;
    };
    let remote = match client.status().await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("✗ Failed to get sync status");
            eprintln!("{}", e.message);
            return EXIT_GENERAL;
        }
    };
    let meta = ConfigManager::load().config().sync_meta.clone();

    println!("Sync status:");
    println!();
    println!("  Remote:");
    if remote.is_empty() {
        println!("    No data synced");
    } else {
        for entry in &remote {
            println!(
                "    {}: v{} ({})",
                entry.data_key, entry.data_version, entry.updated_at
            );
        }
    }
    println!();
    println!("  Local:");
    match meta {
        Some(m) => {
            println!("    config: v{} ({})", m.config_version, m.local_updated_at);
            println!(
                "    providers: v{} ({})",
                m.providers_version, m.last_sync_at
            );
        }
        None => println!("    Never synced"),
    }
    println!();
    EXIT_SUCCESS
}
