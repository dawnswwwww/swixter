use crate::types::{ConfigFile, CONFIG_VERSION};
use std::path::{Path, PathBuf};

pub struct ConfigManager {
    path: PathBuf,
    config: ConfigFile,
}

impl ConfigManager {
    // 注：load()（走 paths::config_path()）在 Task 3 随 paths.rs 一起加入。

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
