use std::fs;
use std::path::PathBuf;

use crate::auth::client::AuthClient;
use crate::auth::types::AuthState;
use crate::{ServerError, TOKEN_REFRESH_BUFFER_MS};

pub struct TokenStore {
    auth_path: PathBuf,
}

impl TokenStore {
    pub fn new(auth_path: PathBuf) -> Self {
        Self { auth_path }
    }

    /// TS: loadAuthState —— 不存在或解析失败返回 None
    pub fn load(&self) -> Option<AuthState> {
        let raw = fs::read_to_string(&self.auth_path).ok()?;
        serde_json::from_str(&raw).ok()
    }

    /// TS: saveAuthState —— 2 空格缩进；Unix 0o600（决策点 1）
    pub fn save(&self, state: &AuthState) -> Result<(), ServerError> {
        if let Some(dir) = self.auth_path.parent() {
            fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(state)?;
        #[cfg(unix)]
        {
            use std::io::Write;
            use std::os::unix::fs::OpenOptionsExt;
            use std::os::unix::fs::PermissionsExt;
            let mut f = fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(true)
                .mode(0o600)
                .open(&self.auth_path)?;
            f.write_all(json.as_bytes())?;
            // 已存在文件 mode 不生效，显式纠正一次
            let mut perm = f.metadata()?.permissions();
            perm.set_mode(0o600);
            fs::set_permissions(&self.auth_path, perm)?;
        }
        #[cfg(not(unix))]
        {
            fs::write(&self.auth_path, json)?;
        }
        Ok(())
    }

    pub fn clear(&self) {
        let _ = fs::remove_file(&self.auth_path);
    }

    /// TS: getAccessToken —— 5min 缓冲；刷新失败清除并返回 None（决策点 5）
    pub async fn get_access_token(&self, client: &AuthClient) -> Option<String> {
        let mut state = self.load()?;
        let expiry = time::OffsetDateTime::parse(
            &state.expires_at,
            &time::format_description::well_known::Rfc3339,
        )
        .ok()?;
        let buffer = time::Duration::milliseconds(TOKEN_REFRESH_BUFFER_MS);
        if time::OffsetDateTime::now_utc() < expiry - buffer {
            return Some(state.access_token);
        }
        match client.refresh(&state.refresh_token).await {
            Ok(r) => {
                state.access_token = r.access_token.clone();
                state.expires_at = r.expires_at;
                self.save(&state).ok()?;
                Some(r.access_token)
            }
            Err(_) => {
                self.clear();
                None
            }
        }
    }
}
