use crate::types::{CoderConfig, ConfigFile, Profile, CONFIG_VERSION};
use crate::CoreError;
use std::path::{Path, PathBuf};

pub struct ConfigManager {
    path: PathBuf,
    config: ConfigFile,
}

impl ConfigManager {
    pub fn load() -> Self {
        Self::load_from(crate::paths::config_path())
    }

    pub fn load_from(path: PathBuf) -> Self {
        let config = match std::fs::read_to_string(&path) {
            Ok(raw) => parse_and_migrate(&raw),
            Err(_) => ConfigFile::empty(),
        };
        Self { path, config }
    }

    pub fn config(&self) -> &ConfigFile {
        &self.config
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// 仅供 crate 内部与测试使用；外部代码走具体 mutator 方法。
    #[doc(hidden)]
    pub fn config_mut_for_test(&mut self) -> &mut ConfigFile {
        &mut self.config
    }

    /// TS: saveConfig — 校验 → 2 空格缩进 → 写 .config.tmp-<millis> → rename
    pub fn save(&self) -> Result<(), CoreError> {
        crate::validate::validate_config(&self.config)?;
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let content = serde_json::to_string_pretty(&self.config)?;
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis();
        let tmp = self.path.with_file_name(format!(".config.tmp-{millis}"));
        std::fs::write(&tmp, content)?;
        std::fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// TS: upsertProfile — createdAt 保留，updatedAt 由调用方设置；
    /// coder 指定时：首个 profile 或当前无激活 → 自动设为激活
    pub fn upsert_profile(
        &mut self,
        mut profile: Profile,
        coder: Option<&str>,
    ) -> Result<(), CoreError> {
        if let Some(existing) = self.config.profiles.get(&profile.name) {
            profile.created_at = existing.created_at.clone();
        }
        self.config
            .profiles
            .insert(profile.name.clone(), profile.clone());
        if let Some(c) = coder {
            let entry = self
                .config
                .coders
                .entry(c.to_string())
                .or_insert_with(|| CoderConfig {
                    active_profile: String::new(),
                });
            if self.config.profiles.len() == 1 || entry.active_profile.is_empty() {
                entry.active_profile = profile.name.clone();
            }
        }
        self.mark_dirty();
        self.save()
    }

    /// TS: deleteProfile — 被 group 引用时报错；清除引用它的 coder 激活态。
    /// 注意：adapter 清理（对各 coder 配置文件的 remove）由 CLI 层在调用本方法前执行
    /// （core 内 config 不反向依赖 adapters 的运行期行为）。
    pub fn delete_profile(&mut self, name: &str) -> Result<(), CoreError> {
        if !self.config.profiles.contains_key(name) {
            return Err(CoreError::NotFound(format!(
                "Profile \"{name}\" does not exist"
            )));
        }
        let referencing: Vec<String> = self
            .config
            .groups
            .values()
            .filter(|g| g.profiles.iter().any(|p| p == name))
            .map(|g| g.name.clone())
            .collect();
        if !referencing.is_empty() {
            return Err(CoreError::InUse(format!(
                "Profile \"{name}\" is used in group(s): {}. Remove it from the group(s) first.",
                referencing.join(", ")
            )));
        }
        self.config.profiles.remove(name);
        for c in self.config.coders.values_mut() {
            if c.active_profile == name {
                c.active_profile.clear();
            }
        }
        self.mark_dirty();
        self.save()
    }

    pub fn set_active_profile(&mut self, coder: &str, name: &str) -> Result<(), CoreError> {
        if !self.config.profiles.contains_key(name) {
            return Err(CoreError::NotFound(format!(
                "Profile \"{name}\" does not exist"
            )));
        }
        self.config
            .coders
            .entry(coder.to_string())
            .or_insert_with(|| CoderConfig {
                active_profile: String::new(),
            })
            .active_profile = name.to_string();
        self.mark_dirty();
        self.save()
    }

    pub fn active_profile(&self, coder: &str) -> Option<&Profile> {
        let name = self.config.coders.get(coder)?.active_profile.as_str();
        if name.is_empty() {
            return None;
        }
        self.config.profiles.get(name)
    }

    pub fn get_profile(&self, name: &str) -> Option<&Profile> {
        self.config.profiles.get(name)
    }

    pub fn mark_dirty(&mut self) {
        if let Some(meta) = &mut self.config.sync_meta {
            meta.dirty = Some(true);
        }
    }

    pub fn clear_sync_meta(&mut self) -> Result<(), CoreError> {
        if self.config.sync_meta.take().is_some() {
            self.save()?;
        }
        Ok(())
    }
}

/// 先解析为 Value 以支持 v1 迁移；解析/校验失败整体回退默认空配置。
fn parse_and_migrate(raw: &str) -> ConfigFile {
    let mut v: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return ConfigFile::empty(),
    };
    if v.get("version").and_then(|x| x.as_str()) == Some("1.0.0") {
        let active = v
            .get("activeProfile")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let obj = v.as_object_mut().unwrap();
        obj.remove("activeProfile");
        let mut coders = serde_json::Map::new();
        coders.insert(
            "claude".into(),
            serde_json::json!({ "activeProfile": active }),
        );
        obj.insert("coders".into(), coders.into());
        obj.insert("version".into(), CONFIG_VERSION.into());
        obj.entry("groups".to_string())
            .or_insert_with(|| serde_json::json!({}));
    }
    let cfg: ConfigFile = match serde_json::from_value(v) {
        Ok(c) => c,
        Err(_) => return ConfigFile::empty(),
    };
    if cfg.version.is_empty() {
        return ConfigFile::empty();
    }
    match crate::validate::validate_config(&cfg) {
        Ok(()) => cfg,
        Err(_) => ConfigFile::empty(),
    }
}

// 注：本测试与 presets/groups 测试一样依赖磁盘临时目录，不含共享环境变量；
// 涉及 SWIXTER_CONFIG_PATH 的测试见 presets.rs，需 `cargo test -- --test-threads=1`。
#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::Profile;

    fn mgr() -> (tempfile::TempDir, ConfigManager) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.json");
        let m = ConfigManager::load_from(path);
        (dir, m)
    }

    fn profile(name: &str) -> Profile {
        Profile {
            name: name.into(),
            provider_id: "ollama".into(),
            api_key: "k".into(),
            created_at: "2025-01-01T00:00:00.000Z".into(),
            updated_at: "2025-01-01T00:00:00.000Z".into(),
            ..Default::default()
        }
    }

    #[test]
    fn upsert_first_profile_auto_activates() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), Some("claude")).unwrap();
        assert_eq!(m.config().coders["claude"].active_profile, "p1");
        m.upsert_profile(profile("p2"), Some("claude")).unwrap();
        assert_eq!(m.config().coders["claude"].active_profile, "p1"); // 不改已激活
    }

    #[test]
    fn upsert_preserves_created_at() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), None).unwrap();
        let mut p2 = profile("p1");
        p2.created_at = "1999-01-01T00:00:00.000Z".into();
        m.upsert_profile(p2, None).unwrap();
        assert_eq!(
            m.config().profiles["p1"].created_at,
            "2025-01-01T00:00:00.000Z"
        );
    }

    #[test]
    fn delete_clears_active_and_refuses_group_members() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), Some("claude")).unwrap();
        m.config_mut_for_test()
            .groups
            .insert("g1".into(), crate::types::Group {
                id: "g1".into(),
                name: "g".into(),
                profiles: vec!["p1".into()],
                is_default: true,
                created_at: "t".into(),
                updated_at: "t".into(),
            });
        assert!(matches!(m.delete_profile("p1"), Err(CoreError::InUse(_))));
        m.config_mut_for_test().groups.clear();
        m.delete_profile("p1").unwrap();
        assert_eq!(m.config().coders["claude"].active_profile, "");
    }

    #[test]
    fn save_is_atomic_and_indented() {
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), None).unwrap();
        m.save().unwrap();
        let raw = std::fs::read_to_string(m.path()).unwrap();
        assert!(raw.contains("\n  \"profiles\": {")); // 2 空格缩进
        assert!(!dir_has_tmp(m.path())); // 无残留临时文件
    }

    fn dir_has_tmp(p: &std::path::Path) -> bool {
        std::fs::read_dir(p.parent().unwrap())
            .unwrap()
            .any(|e| e.unwrap().file_name().to_string_lossy().contains(".tmp-"))
    }

    #[test]
    fn mark_dirty_and_clear_sync_meta() {
        let (_d, mut m) = mgr();
        m.config_mut_for_test().sync_meta = Some(crate::types::SyncMeta {
            last_sync_at: "t".into(),
            config_version: 1,
            providers_version: 1,
            local_updated_at: "t".into(),
            dirty: Some(false),
        });
        m.mark_dirty();
        assert_eq!(m.config().sync_meta.as_ref().unwrap().dirty, Some(true));
        m.clear_sync_meta().unwrap();
        assert!(m.config().sync_meta.is_none());
    }
}
