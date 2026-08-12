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

    /// 底层 ConfigFile 的可变引用（逃生舱）。
    /// 名字里的 for_test 已名不副实：除 crate 内部 mutator（groups/export 等）
    /// 与测试外，server 的 sync flow/auto_sync、groups 路由等生产路径也在用。
    /// 新增代码优先走具体 mutator 方法，无对应方法时才用本方法。
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

    /// TS: upsertProfile — createdAt 保留旧值，updatedAt 统一刷新为 now；
    /// coder 指定时：首个 profile 或当前无激活 → 自动设为激活
    pub fn upsert_profile(
        &mut self,
        mut profile: Profile,
        coder: Option<&str>,
    ) -> Result<(), CoreError> {
        // TS manager.ts:173 —— updatedAt 由 upsert 统一设置，
        // 调用方即便自己塞了值也会被覆盖（重复设置无害，值同为 now）
        profile.updated_at = crate::types::now_iso();
        // TS manager.ts upsertProfile —— `existing?.createdAt || now`：
        // 已有 profile 的 createdAt 为空串时同样回退 now（updated_at 上面已刷新为 now）
        match self.config.profiles.get(&profile.name) {
            Some(existing) if !existing.created_at.is_empty() => {
                profile.created_at = existing.created_at.clone();
            }
            Some(_) => profile.created_at = profile.updated_at.clone(),
            None => {}
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
        // shift_remove 保持剩余键的插入序（对齐 TS 对象 delete 后的键序）
        self.config.profiles.shift_remove(name);
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

    /// TS: manager.ts resetAllData —— 重置为默认空配置并保存
    /// （各 coder 的 adapter 清理由调用方在调用本方法前执行）
    pub fn reset(&mut self) -> Result<(), CoreError> {
        self.config = ConfigFile::empty();
        self.save()
    }
}

/// 先解析为 Value 以支持 v1 迁移与严格校验；解析/校验失败整体回退默认空配置。
fn parse_and_migrate(raw: &str) -> ConfigFile {
    let mut v: serde_json::Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => return fallback_default(format!("invalid JSON: {e}")),
    };
    // TS manager.ts:57 —— 仅当 version=="1.0.0" 且存在顶层 activeProfile（非空）才迁移；
    // v1 但无 activeProfile → 后续严格校验不过，整体回退默认空配置
    if v.get("version").and_then(|x| x.as_str()) == Some("1.0.0")
        && v.get("activeProfile")
            .and_then(|x| x.as_str())
            .is_some_and(|s| !s.is_empty())
    {
        // TS manager.ts:58 —— 迁移时打印提示
        eprintln!(
            "Detected old version configuration, automatically upgrading to {CONFIG_VERSION}..."
        );
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
    }
    // TS manager.ts:67 —— `if (!data.groups) data.groups = {}` 对所有配置生效
    // （在 v1 迁移分支之外）：v0.0.x 写的 2.0.0 配置没有 groups 字段，
    // 缺了会被下面的严格校验当作缺键而整体回退空配置（profiles 数据丢失）
    if let Some(obj) = v.as_object_mut() {
        obj.entry("groups".to_string())
            .or_insert_with(|| serde_json::json!({}));
    }
    // 对齐 TS zod schema 的必填项，缺失则整体回退默认：
    // 顶层 version/profiles/coders/groups；每个 profile 的
    // name/providerId/apiKey/createdAt/updatedAt（均须为 string）
    if !has_required_keys(&v) {
        return fallback_default("missing required keys".into());
    }
    let cfg: ConfigFile = match serde_json::from_value(v) {
        Ok(c) => c,
        Err(e) => return fallback_default(format!("schema mismatch: {e}")),
    };
    if cfg.version.is_empty() {
        return fallback_default("empty version".into());
    }
    match crate::validate::validate_config(&cfg) {
        Ok(()) => cfg,
        Err(e) => fallback_default(e.to_string()),
    }
}

/// TS manager.ts loadConfig catch —— 加载失败打印原因（console.error）后回退默认配置
fn fallback_default(reason: String) -> ConfigFile {
    eprintln!("Failed to load configuration, using default config: {reason}");
    ConfigFile::empty()
}

/// serde 解析前的必需键检查（TS zod 严格性；serde 的 default 会静默容忍缺失）
fn has_required_keys(v: &serde_json::Value) -> bool {
    let Some(obj) = v.as_object() else {
        return false;
    };
    for k in ["version", "profiles", "coders", "groups"] {
        if !obj.contains_key(k) {
            return false;
        }
    }
    let Some(profiles) = obj.get("profiles").and_then(|p| p.as_object()) else {
        return false;
    };
    profiles.values().all(|p| {
        ["name", "providerId", "apiKey", "createdAt", "updatedAt"]
            .iter()
            .all(|k| p.get(*k).and_then(|x| x.as_str()).is_some())
    })
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
        m.config_mut_for_test().groups.insert(
            "g1".into(),
            crate::types::Group {
                id: "g1".into(),
                name: "g".into(),
                profiles: vec!["p1".into()],
                is_default: true,
                created_at: "t".into(),
                updated_at: "t".into(),
            },
        );
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

    #[test]
    fn upsert_refreshes_updated_at() {
        // TS manager.ts:173 —— updatedAt 由 upsert 统一刷新，调用方给的旧值被覆盖
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), None).unwrap();
        let mut p2 = profile("p1");
        p2.updated_at = "1999-01-01T00:00:00.000Z".into();
        m.upsert_profile(p2, None).unwrap();
        let saved = &m.config().profiles["p1"];
        assert_eq!(saved.created_at, "2025-01-01T00:00:00.000Z"); // createdAt 保留
        assert_ne!(saved.updated_at, "1999-01-01T00:00:00.000Z");
        assert_ne!(saved.updated_at, "2025-01-01T00:00:00.000Z"); // 已是刷新后的 now
    }

    #[test]
    fn v1_without_active_profile_falls_back_to_default() {
        // TS manager.ts:57 —— version=="1.0.0" 且存在 activeProfile 才迁移
        let raw = r#"{
            "version": "1.0.0",
            "profiles": {"p1": {"name":"p1","providerId":"ollama","apiKey":"k",
                "createdAt":"2025-01-01T00:00:00.000Z","updatedAt":"2025-01-01T00:00:00.000Z"}},
            "groups": {}
        }"#;
        let cfg = parse_and_migrate(raw);
        assert_eq!(cfg.version, CONFIG_VERSION);
        assert!(cfg.profiles.is_empty()); // 整体回退默认空配置
    }

    #[test]
    fn upsert_empty_created_at_falls_back_to_now() {
        // TS manager.ts upsertProfile —— `existing?.createdAt || now`：空串同样回退 now
        let (_d, mut m) = mgr();
        m.upsert_profile(profile("p1"), None).unwrap();
        m.config_mut_for_test()
            .profiles
            .get_mut("p1")
            .unwrap()
            .created_at = String::new();
        let mut p2 = profile("p1");
        p2.created_at = "1999-01-01T00:00:00.000Z".into(); // 调用方值应被空串兜底覆盖
        m.upsert_profile(p2, None).unwrap();
        let saved = &m.config().profiles["p1"];
        assert!(!saved.created_at.is_empty());
        assert_ne!(saved.created_at, "1999-01-01T00:00:00.000Z");
        assert_eq!(saved.created_at, saved.updated_at); // 同为本次 upsert 的 now
    }

    #[test]
    fn v2_missing_groups_still_loads() {
        // groups 兜底在 v1 迁移分支之外：v2 配置缺 groups 字段照常加载（TS manager.ts:67）
        let raw = r#"{
            "version": "2.0.0",
            "profiles": {"p1": {"name":"p1","providerId":"ollama","apiKey":"k",
                "createdAt":"2025-01-01T00:00:00.000Z","updatedAt":"2025-01-01T00:00:00.000Z"}},
            "coders": {"claude": {"activeProfile": "p1"}}
        }"#;
        let cfg = parse_and_migrate(raw);
        assert!(cfg.profiles.contains_key("p1"));
        assert_eq!(cfg.coders["claude"].active_profile, "p1");
        assert!(cfg.groups.is_empty());
    }

    #[test]
    fn v1_with_active_profile_migrates() {
        let raw = r#"{
            "version": "1.0.0",
            "activeProfile": "p1",
            "profiles": {"p1": {"name":"p1","providerId":"ollama","apiKey":"k",
                "createdAt":"2025-01-01T00:00:00.000Z","updatedAt":"2025-01-01T00:00:00.000Z"}}
        }"#;
        let cfg = parse_and_migrate(raw);
        assert_eq!(cfg.version, CONFIG_VERSION);
        assert_eq!(cfg.coders["claude"].active_profile, "p1");
        assert!(cfg.profiles.contains_key("p1"));
        assert!(cfg.groups.is_empty());
    }

    #[test]
    fn v2_missing_coders_falls_back_to_default() {
        // TS zod：顶层 version/profiles/coders/groups 必填
        let raw = r#"{
            "version": "2.0.0",
            "profiles": {},
            "groups": {}
        }"#;
        let cfg = parse_and_migrate(raw);
        assert!(cfg.profiles.is_empty());
        assert!(cfg.coders.is_empty());
        assert_eq!(cfg.version, CONFIG_VERSION);
    }

    #[test]
    fn profile_missing_api_key_falls_back_to_default() {
        // TS zod：profile 的 name/providerId/apiKey/createdAt/updatedAt 必填
        let raw = r#"{
            "version": "2.0.0",
            "profiles": {"p1": {"name":"p1","providerId":"ollama",
                "createdAt":"2025-01-01T00:00:00.000Z","updatedAt":"2025-01-01T00:00:00.000Z"}},
            "coders": {},
            "groups": {}
        }"#;
        let cfg = parse_and_migrate(raw);
        assert!(cfg.profiles.is_empty()); // 整体回退，而非宽容地接受
    }
}
