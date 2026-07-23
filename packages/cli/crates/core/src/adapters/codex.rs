use crate::model::{get_openai_model, resolve_env_key};
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::{Path, PathBuf};
use toml_edit::{value, DocumentMut, InlineTable, Item, Table};

pub struct CodexAdapter {
    config_path: PathBuf,
}

impl CodexAdapter {
    pub fn new() -> Self { Self { config_path: crate::paths::codex_config_path() } }
    /// 测试用：注入 config.toml 路径；独立 profile 文件在其同目录。
    pub fn with_paths(config_path: PathBuf) -> Self { Self { config_path } }

    fn key(profile_name: &str) -> String { format!("swixter-{profile_name}") }

    fn profile_file_path(&self, profile_name: &str) -> PathBuf {
        self.config_path.parent().unwrap()
            .join(format!("swixter-{profile_name}.config.toml"))
    }

    fn read_doc(&self) -> DocumentMut {
        // TS: 解析失败 → 备份 config.toml.backup.<millis>，warn，从 {} 重来
        let raw = match std::fs::read_to_string(&self.config_path) {
            Ok(r) => r,
            Err(_) => return DocumentMut::new(),
        };
        match raw.parse::<DocumentMut>() {
            Ok(doc) => doc,
            Err(_) => {
                let millis = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap().as_millis();
                let backup = self.config_path.with_file_name(format!(
                    "{}.backup.{millis}",
                    self.config_path.file_name().unwrap().to_string_lossy()
                ));
                let _ = std::fs::write(&backup, &raw);
                eprintln!("Warning: config.toml is corrupted, backed up to {}", backup.display());
                DocumentMut::new()
            }
        }
    }

    fn write_doc(&self, doc: &DocumentMut) -> Result<(), CoreError> {
        if let Some(dir) = self.config_path.parent() { std::fs::create_dir_all(dir)?; }
        std::fs::write(&self.config_path, doc.to_string())?;
        Ok(())
    }

    /// TS: 清理旧版 swixter 遗留的 config.profile 与 [profiles.swixter-<name>]；空表整删。
    /// 返回是否有修改（计划 Task 7 里 remove 用 `modified || true` 总是写回，
    /// 这里改为精确追踪：clean_legacy 返回修改标记，remove 仅在有变化时写回）。
    fn clean_legacy(doc: &mut DocumentMut, key: &str) -> bool {
        let mut modified = false;
        if doc.get("profile").and_then(|v| v.as_str()) == Some(key) {
            doc.remove("profile");
            modified = true;
        }
        let mut drop_profiles = false;
        if let Some(profiles) = doc.get_mut("profiles").and_then(|p| p.as_table_like_mut()) {
            if profiles.remove(key).is_some() { modified = true; }
            if profiles.is_empty() { drop_profiles = true; }
        }
        if drop_profiles { doc.remove("profiles"); modified = true; }
        modified
    }
}

impl Default for CodexAdapter {
    fn default() -> Self { Self::new() }
}

impl super::CoderAdapter for CodexAdapter {
    fn name(&self) -> &'static str { "codex" }
    fn config_path(&self) -> &Path { &self.config_path }

    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError> {
        let preset = preset.ok_or_else(|| CoreError::UnknownProvider(format!(
            "Failed to apply Codex configuration: Unknown provider: {}", profile.provider_id
        )))?;
        let key = Self::key(&profile.name);

        let mut doc = self.read_doc();
        Self::clean_legacy(&mut doc, &key);

        // base_url 回退链：profile.baseURL || preset.baseURLChat || preset.baseURL
        let base_url = profile.base_url.as_deref()
            .or(preset.base_url_chat.as_deref())
            .unwrap_or(&preset.base_url);

        doc["model_provider"] = value(&key);
        // 直接索引赋值会生成 inline table（`model_providers = { ... }`），
        // 与 Codex 惯例的 [model_providers.<key>] 标准表不符；显式建 Table。
        // 已有条目（含用户手写的 inline table）用 table_like 保留。
        if doc.get("model_providers").is_none() {
            doc.insert("model_providers", Item::Table(Table::new()));
        }
        {
            // Item 只有不可变 Index（缺失时 panic），全程走 table_like 的 get/insert/get_mut
            let providers = doc.get_mut("model_providers")
                .and_then(|i| i.as_table_like_mut())
                .expect("model_providers must be a table");
            if providers.get(&key).is_none() {
                providers.insert(&key, Item::Table(Table::new()));
            }
            let provider = providers.get_mut(&key)
                .and_then(|p| p.as_table_like_mut())
                .expect("provider entry must be a table");
            provider.insert("name", value(&preset.display_name));
            provider.insert("base_url", value(base_url));
            provider.insert("wire_api", value("responses")); // TS 硬编码
            provider.insert("env_key", value(resolve_env_key(profile, Some(preset))));
            if let Some(headers) = &preset.headers {
                let mut tbl = InlineTable::new();
                for (k, v) in headers { tbl.insert(k, v.as_str().into()); }
                provider.insert("http_headers", value(tbl));
            }
        }
        self.write_doc(&doc)?;

        // 独立 profile 文件（Codex 0.134.0+）：顶层键，非 [profiles.x] 嵌套
        let mut pf = DocumentMut::new();
        pf["model_provider"] = value(&key);
        // model 回退链：get_openai_model → preset.default_models[0] → 省略
        let model = get_openai_model(profile).map(|s| s.to_string())
            .or_else(|| preset.default_models.first().cloned());
        if let Some(m) = model { pf["model"] = value(m); }
        let pf_path = self.profile_file_path(&profile.name);
        if let Some(dir) = pf_path.parent() { std::fs::create_dir_all(dir)?; }
        std::fs::write(&pf_path, pf.to_string())?;
        Ok(())
    }

    fn verify(&self, profile: &Profile, _preset: Option<&ProviderPreset>) -> bool {
        let key = Self::key(&profile.name);
        let ok = (|| {
            let raw = std::fs::read_to_string(&self.config_path).ok()?;
            let doc = raw.parse::<DocumentMut>().ok()?;
            if doc.get("model_provider").and_then(|v| v.as_str()) != Some(key.as_str()) { return Some(false); }
            doc.get("model_providers")?.get(&key)?;
            let pf_raw = std::fs::read_to_string(self.profile_file_path(&profile.name)).ok()?;
            let pf = pf_raw.parse::<DocumentMut>().ok()?;
            Some(pf.get("model_provider").and_then(|v| v.as_str()) == Some(key.as_str()))
        })();
        ok.unwrap_or(false)
    }

    fn remove(&self, profile_name: &str) -> Result<(), CoreError> {
        // TS: 先无条件删独立文件（失败忽略）；config 修改只在有变化时写回；异常仅 warn
        let _ = std::fs::remove_file(self.profile_file_path(profile_name));
        let key = Self::key(profile_name);
        let result = (|| -> Result<(), CoreError> {
            if !self.config_path.exists() { return Ok(()); }
            let mut doc = self.read_doc();
            let mut modified = false;
            if let Some(providers) = doc.get_mut("model_providers").and_then(|p| p.as_table_like_mut()) {
                if providers.remove(&key).is_some() { modified = true; }
            }
            // legacy profiles/profile 清理；clean_legacy 返回自身修改标记
            if Self::clean_legacy(&mut doc, &key) { modified = true; }
            if doc.get("model_provider").and_then(|v| v.as_str()) == Some(key.as_str()) {
                doc.remove("model_provider");
                modified = true;
            }
            if modified { self.write_doc(&doc)?; }
            Ok(())
        })();
        if let Err(e) = result { eprintln!("Warning: failed to cleanup codex config: {e}"); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::CoderAdapter;
    use crate::types::{Profile, ProviderPreset};

    fn preset() -> ProviderPreset {
        ProviderPreset {
            id: "ollama".into(), name: "ollama".into(), display_name: "Ollama (Local models)".into(),
            base_url: "http://localhost:11434".into(), env_key: Some("OLLAMA_API_KEY".into()),
            default_models: vec!["qwen2.5-coder:7b".into()],
            auth_type: crate::types::AuthType::Custom, ..Default::default()
        }
    }

    fn profile() -> Profile {
        Profile { name: "test".into(), provider_id: "ollama".into(), api_key: "".into(),
                  model: Some("qwen2.5-coder:7b".into()),
                  created_at: "t".into(), updated_at: "t".into(), ..Default::default() }
    }

    fn setup() -> (tempfile::TempDir, CodexAdapter) {
        let dir = tempfile::tempdir().unwrap();
        let a = CodexAdapter::with_paths(dir.path().join("config.toml"));
        (dir, a)
    }

    #[test]
    fn apply_writes_provider_table_and_profile_file() {
        let (dir, a) = setup();
        a.apply(&profile(), Some(&preset())).unwrap();
        let doc = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        let parsed: toml_edit::DocumentMut = doc.parse().unwrap();
        assert_eq!(parsed["model_provider"].as_str(), Some("swixter-test"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["name"].as_str(), Some("Ollama (Local models)"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["base_url"].as_str(), Some("http://localhost:11434"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["wire_api"].as_str(), Some("responses"));
        assert_eq!(parsed["model_providers"]["swixter-test"]["env_key"].as_str(), Some("OLLAMA_API_KEY"));
        let pf = std::fs::read_to_string(dir.path().join("swixter-test.config.toml")).unwrap();
        assert!(pf.contains("model_provider = \"swixter-test\""));
        assert!(pf.contains("model = \"qwen2.5-coder:7b\""));
    }

    #[test]
    fn apply_preserves_unrelated_content() {
        let (dir, a) = setup();
        std::fs::write(dir.path().join("config.toml"),
            "# user comment\napproval_policy = \"never\"\n\n[mcp_servers.fs]\ncommand = \"npx\"\n").unwrap();
        a.apply(&profile(), Some(&preset())).unwrap();
        let doc = std::fs::read_to_string(dir.path().join("config.toml")).unwrap();
        assert!(doc.contains("# user comment"));            // 注释保留（toml_edit）
        assert!(doc.contains("approval_policy = \"never\""));
        assert!(doc.contains("[mcp_servers.fs]"));
    }

    #[test]
    fn apply_cleans_legacy_profiles_table() {
        let (dir, a) = setup();
        std::fs::write(dir.path().join("config.toml"),
            "profile = \"swixter-test\"\n\n[profiles.swixter-test]\nmodel = \"x\"\n").unwrap();
        a.apply(&profile(), Some(&preset())).unwrap();
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert!(parsed.get("profile").is_none());
        assert!(parsed.get("profiles").is_none()); // 清空后整表删除
    }

    #[test]
    fn corrupt_config_is_backed_up() {
        let (dir, a) = setup();
        std::fs::write(dir.path().join("config.toml"), "not [valid toml").unwrap();
        a.apply(&profile(), Some(&preset())).unwrap();
        let backups: Vec<_> = std::fs::read_dir(dir.path()).unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("config.toml.backup."))
            .collect();
        assert_eq!(backups.len(), 1);
        assert!(a.verify(&profile(), Some(&preset())));
    }

    #[test]
    fn unknown_provider_errors() {
        let (_dir, a) = setup();
        let err = a.apply(&profile(), None).unwrap_err();
        assert!(matches!(err, CoreError::UnknownProvider(_)));
    }

    #[test]
    fn env_key_fallback_chain() {
        let (dir, a) = setup();
        let mut p = profile();
        p.env_key = Some("MY_KEY".into());
        a.apply(&p, Some(&preset())).unwrap();
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert_eq!(parsed["model_providers"]["swixter-test"]["env_key"].as_str(), Some("MY_KEY"));
        // profile.envKey 为空串 → 落回 preset.env_key
        p.env_key = Some("".into());
        a.apply(&p, Some(&preset())).unwrap();
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert_eq!(parsed["model_providers"]["swixter-test"]["env_key"].as_str(), Some("OLLAMA_API_KEY"));
    }

    #[test]
    fn remove_cleans_everything() {
        let (dir, a) = setup();
        a.apply(&profile(), Some(&preset())).unwrap();
        a.remove("test").unwrap();
        assert!(!dir.path().join("swixter-test.config.toml").exists());
        let parsed: toml_edit::DocumentMut = std::fs::read_to_string(dir.path().join("config.toml"))
            .unwrap().parse().unwrap();
        assert!(parsed["model_providers"].get("swixter-test").is_none());
        assert!(parsed.get("model_provider").is_none());
    }
}
