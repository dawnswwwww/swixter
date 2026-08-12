use crate::model::{build_profile_env, managed_keys, CLAUDE_ENV_MAPPING};
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::{Path, PathBuf};

pub struct ClaudeCodeAdapter {
    path: PathBuf,
}

impl ClaudeCodeAdapter {
    pub fn new() -> Self {
        Self {
            path: crate::paths::claude_settings_path(),
        }
    }
    pub fn with_path(path: PathBuf) -> Self {
        Self { path }
    }

    fn read_existing(&self) -> serde_json::Value {
        // TS: 不存在 → {}；解析失败 → warn 并用 {}（不备份、不报错）
        // 合法 JSON 但非对象（如 [1,2,3]）同样按 {} 处理，
        // 否则 apply 里 existing["env"] = ... 会对非对象 panic
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
            .filter(|v| v.is_object())
            .unwrap_or_else(|| serde_json::json!({}))
    }

    fn expected_env(profile: &Profile, preset: Option<&ProviderPreset>) -> Vec<(String, String)> {
        // TS: baseURL 回退链 profile.baseURL || preset?.baseURL || ""
        // （TS `||` 空串亦回退；但 baseURL 空串在 load 的 URL 校验阶段即被拒，此处不可达）
        let base_url = profile
            .base_url
            .as_deref()
            .or(preset.map(|p| p.base_url.as_str()))
            .unwrap_or("");
        build_profile_env(profile, &CLAUDE_ENV_MAPPING, base_url)
    }
}

impl Default for ClaudeCodeAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl super::CoderAdapter for ClaudeCodeAdapter {
    fn name(&self) -> &'static str {
        "claude"
    }
    fn config_path(&self) -> &Path {
        &self.path
    }

    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError> {
        let mut existing = self.read_existing();
        let new_env = Self::expected_env(profile, preset);
        let managed = managed_keys(&CLAUDE_ENV_MAPPING);

        // 智能合并：保留非托管的用户自定义变量
        let mut env = serde_json::Map::new();
        if let Some(obj) = existing.get("env").and_then(|e| e.as_object()) {
            for (k, v) in obj {
                if !managed.contains(&k.as_str()) {
                    env.insert(k.clone(), v.clone());
                }
            }
        }
        for (k, v) in new_env {
            env.insert(k, serde_json::Value::String(v));
        }
        existing["env"] = serde_json::Value::Object(env);

        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(&self.path, serde_json::to_string_pretty(&existing)?)?;
        Ok(())
    }

    fn verify(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> bool {
        let raw = match std::fs::read_to_string(&self.path) {
            Ok(r) => r,
            Err(_) => return false,
        };
        let v: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => return false,
        };
        let expected = Self::expected_env(profile, preset);
        if expected.is_empty() {
            return false;
        }
        let env = match v.get("env").and_then(|e| e.as_object()) {
            Some(e) => e,
            None => return false,
        };
        expected
            .iter()
            .all(|(k, val)| env.get(k).and_then(|x| x.as_str()) == Some(val.as_str()))
    }

    /// TS: claude remove 是 no-op（全局 env，无 per-profile 条目）
    fn remove(&self, _profile_name: &str) -> Result<(), CoreError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::CoderAdapter;
    use crate::types::{ModelsConfig, Profile};

    fn adapter_at(dir: &tempfile::TempDir) -> ClaudeCodeAdapter {
        ClaudeCodeAdapter::with_path(dir.path().join("settings.json"))
    }

    fn profile() -> Profile {
        Profile {
            name: "p1".into(),
            provider_id: "anthropic".into(),
            api_key: "sk-ant-xxx".into(),
            auth_token: Some("tok".into()),
            base_url: Some("https://api.anthropic.com".into()),
            models: Some(ModelsConfig {
                anthropic_model: Some("claude-sonnet-4-20250514".into()),
                default_haiku_model: None,
                default_opus_model: None,
                default_sonnet_model: Some("s".into()),
            }),
            created_at: "t".into(),
            updated_at: "t".into(),
            ..Default::default()
        }
    }

    #[test]
    fn apply_writes_managed_env_and_preserves_rest() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"),
            r#"{ "permissions": {"allow": []}, "env": {"OTHER_VAR": "keep", "ANTHROPIC_API_KEY": "old"} }"#).unwrap();
        let a = adapter_at(&dir);
        a.apply(&profile(), None).unwrap();
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(v["permissions"]["allow"], serde_json::json!([])); // 其他段保留
        assert_eq!(v["env"]["OTHER_VAR"], "keep"); // 非托管 key 保留
        assert_eq!(v["env"]["ANTHROPIC_API_KEY"], "sk-ant-xxx");
        assert_eq!(v["env"]["ANTHROPIC_AUTH_TOKEN"], "tok");
        assert_eq!(v["env"]["ANTHROPIC_BASE_URL"], "https://api.anthropic.com");
        assert_eq!(v["env"]["ANTHROPIC_MODEL"], "claude-sonnet-4-20250514");
        assert_eq!(v["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"], "s");
        assert!(v["env"].get("ANTHROPIC_DEFAULT_HAIKU_MODEL").is_none()); // 空值不写
    }

    #[test]
    fn apply_full_replace_semantics() {
        let dir = tempfile::tempdir().unwrap();
        let a = adapter_at(&dir);
        a.apply(&profile(), None).unwrap();
        let mut p2 = profile();
        p2.auth_token = None; // 切换 profile 后旧值必须被删除
        a.apply(&p2, None).unwrap();
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        )
        .unwrap();
        assert!(v["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
    }

    #[test]
    fn apply_handles_non_object_settings() {
        // 合法 JSON 但非对象：按 {} 重建，不得 panic
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), "[1,2,3]").unwrap();
        let a = adapter_at(&dir);
        a.apply(&profile(), None).unwrap();
        let v: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.path().join("settings.json")).unwrap(),
        )
        .unwrap();
        assert!(v.is_object());
        assert_eq!(v["env"]["ANTHROPIC_API_KEY"], "sk-ant-xxx");
        assert!(a.verify(&profile(), None));
    }

    #[test]
    fn verify_and_corrupt_file() {
        let dir = tempfile::tempdir().unwrap();
        let a = adapter_at(&dir);
        assert!(!a.verify(&profile(), None)); // 文件不存在
        a.apply(&profile(), None).unwrap();
        assert!(a.verify(&profile(), None));
        std::fs::write(dir.path().join("settings.json"), "{not json").unwrap();
        assert!(!a.verify(&profile(), None)); // 损坏 → false
        a.apply(&profile(), None).unwrap(); // 损坏 → 从 {} 重建（不备份）
        assert!(a.verify(&profile(), None));
    }
}
