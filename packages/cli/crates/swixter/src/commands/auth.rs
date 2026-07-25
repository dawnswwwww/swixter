//! TS: cli/auth.ts —— swixter auth register|login [--magic-link]|logout|status|delete-account
use std::path::PathBuf;

use dialoguer::{Confirm, Input, Password, Select};
use swixter_core::config::ConfigManager;
use swixter_server::auth::client::AuthClient;
use swixter_server::auth::token::TokenStore;
use swixter_server::auth::types::{AuthApiResponse, AuthState, AuthUser};
use swixter_server::crypto::derive::{derive_key, key_to_base64};
use swixter_server::{ServerError, API_BASE, MAGIC_LINK_MAX_ATTEMPTS, MAGIC_LINK_POLL_INTERVAL};

use crate::cli::{AuthArgs, AuthCommand};
use crate::{EXIT_GENERAL, EXIT_SUCCESS};

pub fn dispatch(args: AuthArgs) -> i32 {
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime");
    rt.block_on(async move {
        let client = AuthClient::new(api_base());
        let store = TokenStore::new(auth_path());
        match args.command {
            AuthCommand::Register => register(&client, &store).await,
            AuthCommand::Login { magic_link } => login(&client, &store, magic_link).await,
            AuthCommand::Logout => logout(&client, &store).await,
            AuthCommand::Status => status(&store),
            AuthCommand::DeleteAccount => delete_account(&client, &store).await,
        }
    })
}

/// 测试/私有部署可用 SWIXTER_API_BASE 覆盖云端地址（默认 api.swixter.com）
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

/// 登录/注册响应的统一视图（password 登录无 has_password）
struct LoginResult {
    access_token: String,
    refresh_token: String,
    expires_at: String,
    user: AuthUser,
    encryption_salt: String,
    has_password: Option<bool>,
}

impl From<AuthApiResponse> for LoginResult {
    fn from(r: AuthApiResponse) -> Self {
        Self {
            access_token: r.access_token,
            refresh_token: r.refresh_token,
            expires_at: r.expires_at,
            user: r.user,
            encryption_salt: r.encryption_salt,
            has_password: None,
        }
    }
}

/// dialoguer 取消（Esc / Ctrl+C）→ 静默退出 0（对齐 TS isCancel → return）
fn cancelled<T>(r: dialoguer::Result<T>) -> Option<T> {
    r.ok()
}

fn prompt_email() -> Option<String> {
    cancelled(
        Input::new()
            .with_prompt("Email:")
            .validate_with(|v: &String| {
                if v.is_empty() {
                    Err("Email is required")
                } else if !v.contains('@') {
                    Err("Invalid email format")
                } else {
                    Ok(())
                }
            })
            .interact_text(),
    )
}

/// TS: persistAuth —— 写 auth.json；换账号（email 不同）清 syncMeta。返回是否换账号
fn persist_auth(
    store: &TokenStore,
    result: &LoginResult,
    auth_method: &str,
) -> Result<bool, ServerError> {
    let previous = store.load();
    let user_changed = previous
        .as_ref()
        .is_some_and(|p| p.email != result.user.email);
    store.save(&AuthState {
        access_token: result.access_token.clone(),
        refresh_token: result.refresh_token.clone(),
        expires_at: result.expires_at.clone(),
        encryption_salt: result.encryption_salt.clone(),
        encryption_key: None,
        auth_method: auth_method.to_string(),
        user_id: result.user.id.clone(),
        email: result.user.email.clone(),
    })?;
    if user_changed {
        ConfigManager::load().clear_sync_meta().ok();
    }
    Ok(user_changed)
}

/// master password 派生 key；remember 时把 encryptionKey 存进 auth.json（供 auto-sync 免密）
fn apply_encryption_setup(
    store: &TokenStore,
    master_password: &str,
    remember: bool,
) -> Result<(), ServerError> {
    let mut state = store
        .load()
        .ok_or_else(|| ServerError::Auth("not logged in".into()))?;
    let key = derive_key(master_password, &state.encryption_salt)?;
    if remember {
        state.encryption_key = Some(key_to_base64(&key));
        store.save(&state)?;
        println!("Encryption key saved for automatic sync");
    }
    Ok(())
}

/// TS: setupEncryptionAfterAuth —— 引导设 E2E master password（≥8），可选保存 key
fn setup_encryption_after_auth(store: &TokenStore) {
    if store.load().is_none() {
        return;
    }
    let setup = cancelled(
        Confirm::new()
            .with_prompt("Set up end-to-end encryption for cloud sync?")
            .default(true)
            .interact(),
    );
    if setup != Some(true) {
        return;
    }
    let Some(master_password) = cancelled(
        Password::new()
            .with_prompt("Create master password for encryption (separate from login password):")
            .validate_with(|v: &String| {
                if v.is_empty() {
                    Err("Master password is required")
                } else if v.len() < 8 {
                    Err("Must be at least 8 characters")
                } else {
                    Ok(())
                }
            })
            .interact(),
    ) else {
        return;
    };
    let remember = cancelled(
        Confirm::new()
            .with_prompt(
                "Save encryption key locally for automatic sync? (Less secure but convenient)",
            )
            .default(false)
            .interact(),
    )
    .unwrap_or(false);
    if let Err(e) = apply_encryption_setup(store, &master_password, remember) {
        eprintln!("✗ Failed to set up encryption: {e}");
    }
}

/// TS: promptSetPassword —— magic-link 完成且无 hasPassword 时引导设登录密码
async fn prompt_set_password(client: &AuthClient, store: &TokenStore, has_password: Option<bool>) {
    if has_password == Some(true) {
        return;
    }
    let Some(state) = store.load() else { return };
    let set_pw = cancelled(
        Confirm::new()
            .with_prompt("Set a login password for future sign-ins?")
            .default(true)
            .interact(),
    );
    if set_pw != Some(true) {
        return;
    }
    let Some(password) = cancelled(
        Password::new()
            .with_prompt("Create password:")
            .validate_with(|v: &String| {
                if v.len() < 6 {
                    Err("Password must be at least 6 characters")
                } else {
                    Ok(())
                }
            })
            .interact(),
    ) else {
        return;
    };
    match client.set_password(&password, &state.access_token).await {
        Ok(()) => println!("✓ Password set! You can now log in with email + password."),
        Err(e) => eprintln!("✗ Failed to set password: {}", e.message),
    }
}

/// TS: promptSyncChoice —— 换账号登录后提示 pull/push/skip
fn prompt_sync_choice(store: &TokenStore) {
    let Some(state) = store.load() else { return };
    if state.encryption_key.is_none() {
        println!(
            "Cloud sync requires an encryption key. Run 'swixter sync push' after setting one up."
        );
        return;
    }
    let items = [
        "Pull from cloud (replace local profiles with cloud data)",
        "Push to cloud (upload local profiles to this account)",
        "Skip for now",
    ];
    let Some(choice) = cancelled(
        Select::new()
            .with_prompt("Different account detected. How would you like to handle cloud data?")
            .items(&items)
            .default(0)
            .interact(),
    ) else {
        return;
    };
    let extra: &[&str] = match choice {
        0 => &["pull", "--force-remote"],
        1 => &["push", "--force-local"],
        _ => return,
    };
    // 以子进程调本二进制 sync 子命令（对齐 TS 动态 import handleSyncCommand 的解耦）
    let exe = std::env::current_exe().expect("current exe");
    let _ = std::process::Command::new(exe)
        .arg("sync")
        .args(extra)
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .status();
}

/// TS: cmdRegister —— email → send-code → 6 位验证码 → 密码 ≥6 → 可选 displayName → verify
async fn register(client: &AuthClient, store: &TokenStore) -> i32 {
    println!();
    println!("Register Swixter Account");

    let Some(email) = prompt_email() else {
        return EXIT_SUCCESS;
    };

    println!("Sending verification code...");
    let send = match client.send_verification_code(&email).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("✗ Failed to send verification code");
            if e.status == 409 {
                eprintln!("This email is already registered. Try logging in instead.");
            } else {
                eprintln!("{}", e.message);
            }
            return EXIT_GENERAL;
        }
    };
    println!(
        "✓ Verification code sent! (Expires in {}s)",
        send.expires_in
    );

    let Some(code) = cancelled(
        Input::new()
            .with_prompt("Enter the 6-digit verification code sent to your email:")
            .validate_with(|v: &String| {
                if v.len() == 6 && v.chars().all(|c| c.is_ascii_digit()) {
                    Ok(())
                } else {
                    Err("Please enter a 6-digit code")
                }
            })
            .interact_text(),
    ) else {
        return EXIT_SUCCESS;
    };

    let Some(password) = cancelled(
        Password::new()
            .with_prompt("Create password:")
            .validate_with(|v: &String| {
                if v.is_empty() {
                    Err("Password is required")
                } else if v.len() < 6 {
                    Err("Password must be at least 6 characters")
                } else {
                    Ok(())
                }
            })
            .interact(),
    ) else {
        return EXIT_SUCCESS;
    };

    let display_name = cancelled(
        Input::new()
            .with_prompt("Display name (optional):")
            .allow_empty(true)
            .interact_text(),
    )
    .filter(|s: &String| !s.is_empty());

    println!("Creating account...");
    let resp = match client
        .verify_and_register(&email, &code, &password, display_name.as_deref())
        .await
    {
        Ok(r) => r,
        Err(e) => {
            eprintln!("✗ Registration failed");
            if e.status == 409 {
                eprintln!("This email is already registered.");
            } else {
                eprintln!("{}", e.message);
            }
            return EXIT_GENERAL;
        }
    };

    let result = LoginResult::from(resp);
    let welcome = result
        .user
        .display_name
        .clone()
        .unwrap_or_else(|| result.user.email.clone());
    if let Err(e) = persist_auth(store, &result, "password") {
        eprintln!("✗ {e}");
        return EXIT_GENERAL;
    }
    println!("✓ Account created and logged in!");
    setup_encryption_after_auth(store);
    println!("Welcome, {welcome}!");
    EXIT_SUCCESS
}

/// TS: completeMagicLinkManual —— 无 sessionId 时手动输 token 验证
async fn magic_link_manual(client: &AuthClient, email: &str) -> Result<LoginResult, String> {
    let token = cancelled(
        Input::new()
            .with_prompt("Enter the magic link token:")
            .validate_with(|v: &String| {
                if v.is_empty() {
                    Err("Token is required")
                } else {
                    Ok(())
                }
            })
            .interact_text(),
    )
    .ok_or_else(|| "cancelled".to_string())?;
    println!("Verifying...");
    let resp = client
        .verify_magic_link(email, &token)
        .await
        .map_err(|e| format!("Invalid or expired token: {}", e.message))?;
    Ok(LoginResult {
        access_token: resp.access_token,
        refresh_token: resp.refresh_token,
        expires_at: resp.expires_at,
        user: resp.user,
        encryption_salt: resp.encryption_salt,
        has_password: resp.has_password,
    })
}

/// TS: cmdMagicLinkLogin —— send → 有 sessionId 轮询 2s×300（404=session 过期），
/// 无 sessionId 走手动输 token
async fn magic_link_flow(client: &AuthClient, email: &str) -> Result<LoginResult, String> {
    println!("Sending magic link...");
    let send = client
        .send_magic_link(email)
        .await
        .map_err(|e| format!("Failed to send magic link: {}", e.message))?;
    println!("✓ Magic link sent!");

    let Some(session_id) = send.session_id else {
        return magic_link_manual(client, email).await;
    };

    println!();
    println!("Check your email and click the magic link to log in.");
    println!("The CLI will detect it automatically.");
    println!();

    for _ in 0..MAGIC_LINK_MAX_ATTEMPTS {
        tokio::time::sleep(MAGIC_LINK_POLL_INTERVAL).await;
        match client.check_magic_link_session(&session_id).await {
            Ok(s) if s.status == "completed" => {
                let (
                    Some(access_token),
                    Some(refresh_token),
                    Some(expires_at),
                    Some(user),
                    Some(salt),
                ) = (
                    s.access_token,
                    s.refresh_token,
                    s.expires_at,
                    s.user,
                    s.encryption_salt,
                )
                else {
                    return Err("Incomplete session data from server".to_string());
                };
                return Ok(LoginResult {
                    access_token,
                    refresh_token,
                    expires_at,
                    user,
                    encryption_salt: salt,
                    has_password: s.has_password,
                });
            }
            Ok(_) => continue, // pending
            Err(e) if e.status == 404 => {
                return Err("Session expired. Please try again.".to_string());
            }
            Err(_) => continue, // 其他错误继续轮询
        }
    }
    Err(
        "Timed out waiting for magic link confirmation. The magic link may have expired."
            .to_string(),
    )
}

/// TS: cmdLogin / cmdMagicLinkLogin 的公共收尾：persist → 加密引导 → 换账号提示
async fn login(client: &AuthClient, store: &TokenStore, magic_link: bool) -> i32 {
    if magic_link {
        println!();
        println!("Magic Link Login");
    } else {
        println!();
        println!("Login to Swixter");
    }

    let Some(email) = prompt_email() else {
        return EXIT_SUCCESS;
    };

    let auth_method = if magic_link { "magic-link" } else { "password" };
    let result = if magic_link {
        match magic_link_flow(client, &email).await {
            Ok(r) => r,
            Err(e) => {
                if e != "cancelled" {
                    eprintln!("✗ {e}");
                }
                return if e == "cancelled" {
                    EXIT_SUCCESS
                } else {
                    EXIT_GENERAL
                };
            }
        }
    } else {
        let Some(password) = cancelled(
            Password::new()
                .with_prompt("Password:")
                .validate_with(|v: &String| {
                    if v.is_empty() {
                        Err("Password is required")
                    } else {
                        Ok(())
                    }
                })
                .interact(),
        ) else {
            return EXIT_SUCCESS;
        };
        println!("Logging in...");
        match client.login(&email, &password).await {
            Ok(r) => LoginResult::from(r),
            Err(e) => {
                eprintln!("✗ Login failed");
                eprintln!("{}", e.message);
                return EXIT_GENERAL;
            }
        }
    };

    let welcome = result
        .user
        .display_name
        .clone()
        .unwrap_or_else(|| result.user.email.clone());
    let has_password = result.has_password;
    let user_changed = match persist_auth(store, &result, auth_method) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("✗ {e}");
            return EXIT_GENERAL;
        }
    };
    println!("✓ Logged in successfully!");

    // 未配置加密 → 引导设置
    if store.load().and_then(|s| s.encryption_key).is_none() {
        setup_encryption_after_auth(store);
    }
    // magic-link 完成且无密码 → 引导设登录密码
    if magic_link {
        prompt_set_password(client, store, has_password).await;
    }
    // 换账号 → 提示 pull/push/skip
    if user_changed {
        prompt_sync_choice(store);
        return EXIT_SUCCESS;
    }
    println!("Welcome back, {welcome}!");
    EXIT_SUCCESS
}

/// TS: cmdLogout —— 调云端 logout（错误忽略）→ 删 auth.json → clearSyncMeta
async fn logout(client: &AuthClient, store: &TokenStore) -> i32 {
    if let Some(state) = store.load() {
        let _ = client.logout(&state.refresh_token).await;
    }
    store.clear();
    ConfigManager::load().clear_sync_meta().ok();
    println!("✓ Logged out");
    EXIT_SUCCESS
}

/// TS: cmdStatus —— 登录态 + email/userId/加密状态
fn status(store: &TokenStore) -> i32 {
    match store.load() {
        None => {
            println!("Not logged in");
            println!("Run 'swixter auth login' to sign in");
        }
        Some(state) => {
            println!("✓ Logged in");
            println!("  Email: {}", state.email);
            println!("  User ID: {}", state.user_id);
            println!("  Expires: {}", state.expires_at);
            println!(
                "  Encryption: {}",
                if state.encryption_key.is_some() {
                    "enabled"
                } else {
                    "not configured"
                }
            );
        }
    }
    EXIT_SUCCESS
}

/// TS: cmdDeleteAccount —— Confirm 默认 false → DELETE → 清本地
async fn delete_account(client: &AuthClient, store: &TokenStore) -> i32 {
    if store.load().is_none() {
        println!("Not logged in");
        return EXIT_SUCCESS;
    }
    let confirmed = cancelled(
        Confirm::new()
            .with_prompt(
                "This will permanently delete your cloud account and all synced data. Continue?",
            )
            .default(false)
            .interact(),
    );
    if confirmed != Some(true) {
        println!("Cancelled");
        return EXIT_SUCCESS;
    }

    println!("Deleting account...");
    let Some(token) = store.get_access_token(client).await else {
        eprintln!("Session expired. Please log in again.");
        return EXIT_GENERAL;
    };
    match client.delete_account(&token).await {
        Ok(()) => {
            store.clear();
            ConfigManager::load().clear_sync_meta().ok();
            println!("✓ Account deleted");
            EXIT_SUCCESS
        }
        Err(e) => {
            eprintln!("✗ Failed to delete account");
            eprintln!("{}", e.message);
            EXIT_GENERAL
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store(dir: &tempfile::TempDir) -> TokenStore {
        let store = TokenStore::new(dir.path().join("auth.json"));
        store
            .save(&AuthState {
                access_token: "a".into(),
                refresh_token: "r".into(),
                expires_at: "2999-01-01T00:00:00Z".into(),
                encryption_salt: "AAECAwQFBgcICQoLDA0ODw==".into(),
                encryption_key: None,
                auth_method: "password".into(),
                user_id: "u1".into(),
                email: "e@x.com".into(),
            })
            .unwrap();
        store
    }

    #[test]
    fn encryption_setup_derives_and_optionally_stores_key() {
        // 派生结果必须与 TS WebCrypto 固定向量一致（Task 1 fixture 的 keyBase64）
        let dir = tempfile::tempdir().unwrap();
        let store = test_store(&dir);
        apply_encryption_setup(&store, "test-master-password-\u{1f511}", true).unwrap();
        let state = store.load().unwrap();
        assert_eq!(
            state.encryption_key.as_deref(),
            Some("i/vBKkpXIi1TH/LhryYiItNe6O5UNPzxTAm9muRi0M8=")
        );

        // 不保存 → auth.json 无 encryptionKey 字段
        let dir2 = tempfile::tempdir().unwrap();
        let store2 = test_store(&dir2);
        apply_encryption_setup(&store2, "test-master-password-\u{1f511}", false).unwrap();
        let raw = std::fs::read_to_string(dir2.path().join("auth.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert!(v.get("encryptionKey").is_none());
    }
}
