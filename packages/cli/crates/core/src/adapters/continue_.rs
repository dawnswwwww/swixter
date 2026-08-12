use crate::model::get_openai_model;
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use serde_yaml_ng::{Mapping, Value};
use std::path::{Path, PathBuf};

/// TS: continue.ts PROVIDER_MAP + 未知 providerId 回退 "openai"
pub fn map_provider(id: &str) -> &'static str {
    match id {
        "anthropic" => "anthropic",
        "ollama" => "ollama",
        _ => "openai", // openai / openrouter / custom / 未知
    }
}

pub struct ContinueAdapter {
    path: PathBuf,
}

impl ContinueAdapter {
    pub fn new() -> Self {
        Self {
            path: crate::paths::continue_config_path(),
        }
    }
    pub fn with_path(path: PathBuf) -> Self {
        Self { path }
    }

    fn read_config(&self) -> Mapping {
        // TS: 读取失败 → warn + {}
        std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|raw| serde_yaml_ng::from_str::<Value>(&raw).ok())
            .and_then(|v| v.as_mapping().cloned())
            .unwrap_or_default()
    }

    fn write_config(&self, m: &Mapping) -> Result<(), CoreError> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::write(
            &self.path,
            serde_yaml_ng::to_string(&Value::Mapping(m.clone()))?,
        )?;
        Ok(())
    }

    fn build_entry(profile: &Profile, preset: Option<&ProviderPreset>) -> Mapping {
        let mut e = Mapping::new();
        e.insert("title".into(), profile.name.clone().into());
        e.insert("provider".into(), map_provider(&profile.provider_id).into());
        // base_url 回退链同 TS `profile.baseURL || preset?.baseURL || ""`；
        // baseURL 空串在 load 校验阶段即被拒（URL 解析失败），`.or` 前无需 filter
        let base = profile
            .base_url
            .as_deref()
            .or(preset.map(|p| p.base_url.as_str()))
            .unwrap_or("");
        e.insert("apiBase".into(), base.into());
        // model/apiKey 仅非空才写（TS: continue.ts:57-58）
        if let Some(m) = get_openai_model(profile) {
            e.insert("model".into(), m.into());
        }
        if !profile.api_key.is_empty() {
            e.insert("apiKey".into(), profile.api_key.clone().into());
        }
        e.insert(
            "roles".into(),
            Value::Sequence(
                vec!["chat", "edit", "apply"]
                    .into_iter()
                    .map(|s| Value::String(s.into()))
                    .collect(),
            ),
        );
        e
    }
}

impl Default for ContinueAdapter {
    fn default() -> Self {
        Self::new()
    }
}

impl super::CoderAdapter for ContinueAdapter {
    fn name(&self) -> &'static str {
        "continue"
    }
    fn config_path(&self) -> &Path {
        &self.path
    }

    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError> {
        let mut config = self.read_config();
        let entry = Value::Mapping(Self::build_entry(profile, preset));
        let mut models: Vec<Value> = config
            .get("models")
            .and_then(|m| m.as_sequence().cloned())
            .unwrap_or_default();
        // upsert：title 匹配则整体替换，否则 push
        if let Some(slot) = models
            .iter_mut()
            .find(|m| m.get("title").and_then(|t| t.as_str()) == Some(profile.name.as_str()))
        {
            *slot = entry;
        } else {
            models.push(entry);
        }
        config.insert("models".into(), Value::Sequence(models));
        self.write_config(&config)
    }

    fn verify(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> bool {
        // TS: 只比对 apiBase 与非空的 model，不检查 provider/apiKey
        let check = (|| {
            let config = self.read_config();
            let models = config.get("models")?.as_sequence()?;
            let entry = models
                .iter()
                .find(|m| m.get("title").and_then(|t| t.as_str()) == Some(profile.name.as_str()))?;
            // 同 build_entry：baseURL 空串不可达（load 校验拒绝），保持 `.or` 即可
            let expected_base = profile
                .base_url
                .as_deref()
                .or(preset.map(|p| p.base_url.as_str()))
                .unwrap_or("");
            if entry.get("apiBase").and_then(|v| v.as_str()) != Some(expected_base) {
                return Some(false);
            }
            if let Some(expected_model) = get_openai_model(profile) {
                if entry.get("model").and_then(|v| v.as_str()) != Some(expected_model) {
                    return Some(false);
                }
            }
            Some(true)
        })();
        check.unwrap_or(false)
    }

    fn remove(&self, profile_name: &str) -> Result<(), CoreError> {
        // TS: 仅当数组变短才写回；异常仅 warn
        let result = (|| -> Result<(), CoreError> {
            if !self.path.exists() {
                return Ok(());
            }
            let mut config = self.read_config();
            let models: Vec<Value> = config
                .get("models")
                .and_then(|m| m.as_sequence().cloned())
                .unwrap_or_default();
            let filtered: Vec<Value> = models
                .into_iter()
                .filter(|m| m.get("title").and_then(|t| t.as_str()) != Some(profile_name))
                .collect();
            let original_len = config
                .get("models")
                .and_then(|m| m.as_sequence())
                .map(|s| s.len())
                .unwrap_or(0);
            if filtered.len() != original_len {
                config.insert("models".into(), Value::Sequence(filtered));
                self.write_config(&config)?;
            }
            Ok(())
        })();
        if let Err(e) = result {
            eprintln!("Warning: failed to cleanup continue config: {e}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapters::CoderAdapter;
    use crate::types::Profile;

    fn profile() -> Profile {
        Profile {
            name: "my-qwen".into(),
            provider_id: "ollama".into(),
            api_key: "k".into(),
            base_url: Some("http://localhost:11434".into()),
            model: Some("qwen2.5-coder:7b".into()),
            created_at: "t".into(),
            updated_at: "t".into(),
            ..Default::default()
        }
    }

    fn setup() -> (tempfile::TempDir, ContinueAdapter) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config.yaml");
        (dir, ContinueAdapter::with_path(path))
    }

    #[test]
    fn apply_upserts_model_entry() {
        let (dir, a) = setup();
        std::fs::write(
            dir.path().join("config.yaml"),
            "name: my-assistant\nmodels:\n  - title: other\n    provider: openai\n",
        )
        .unwrap();
        a.apply(&profile(), None).unwrap();
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(
            &std::fs::read_to_string(dir.path().join("config.yaml")).unwrap(),
        )
        .unwrap();
        assert_eq!(v["name"], "my-assistant"); // 其他字段保留
        let models = v["models"].as_sequence().unwrap();
        assert_eq!(models.len(), 2); // other 保留，my-qwen 新增
        let entry = models.iter().find(|m| m["title"] == "my-qwen").unwrap();
        assert_eq!(entry["provider"], "ollama");
        assert_eq!(entry["apiBase"], "http://localhost:11434");
        assert_eq!(entry["model"], "qwen2.5-coder:7b");
        assert_eq!(entry["apiKey"], "k");
        assert_eq!(
            entry["roles"],
            serde_yaml_ng::to_value(vec!["chat", "edit", "apply"]).unwrap()
        );
    }

    #[test]
    fn apply_replaces_existing_entry() {
        let (dir, a) = setup();
        a.apply(&profile(), None).unwrap();
        let mut p2 = profile();
        p2.api_key = "k2".into();
        a.apply(&p2, None).unwrap();
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(
            &std::fs::read_to_string(dir.path().join("config.yaml")).unwrap(),
        )
        .unwrap();
        let models = v["models"].as_sequence().unwrap();
        assert_eq!(models.len(), 1);
        assert_eq!(models[0]["apiKey"], "k2");
    }

    #[test]
    fn verify_and_remove() {
        let (dir, a) = setup();
        assert!(!a.verify(&profile(), None));
        a.apply(&profile(), None).unwrap();
        assert!(a.verify(&profile(), None));
        a.remove("my-qwen").unwrap();
        let v: serde_yaml_ng::Value = serde_yaml_ng::from_str(
            &std::fs::read_to_string(dir.path().join("config.yaml")).unwrap(),
        )
        .unwrap();
        assert!(v["models"].as_sequence().unwrap().is_empty());
        assert!(!a.verify(&profile(), None));
    }

    #[test]
    fn provider_mapping_fallback() {
        assert_eq!(map_provider("anthropic"), "anthropic");
        assert_eq!(map_provider("openrouter"), "openai");
        assert_eq!(map_provider("some-future-provider"), "openai");
    }
}
