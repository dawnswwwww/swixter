use crate::types::ProviderPreset;
use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
struct ProvidersFile {
    version: String,
    #[serde(default)]
    providers: Vec<ProviderPreset>,
}

/// TS: user-providers.ts — 任一条目校验失败则整个文件回退空数组
pub fn load() -> Vec<ProviderPreset> {
    load_from(&crate::paths::providers_path())
}

/// 路径注入版（Web UI server 用 AppState.config_path 隔离，测试不依赖全局路径）
pub fn load_from(path: &Path) -> Vec<ProviderPreset> {
    let raw = match std::fs::read_to_string(path) {
        Ok(r) => r,
        Err(_) => return vec![],
    };
    let file: ProvidersFile = match serde_json::from_str(&raw) {
        Ok(f) => f,
        Err(_) => return vec![],
    };
    if file
        .providers
        .iter()
        .any(|p| crate::validate::validate_preset(p).is_err())
    {
        return vec![];
    }
    file.providers
}

/// TS: 非原子写，version 固定 "1.0.0"，2 空格缩进
pub fn save(providers: &[ProviderPreset]) -> Result<(), CoreError> {
    save_to(&crate::paths::providers_path(), providers)
}

/// 路径注入版 save
pub fn save_to(path: &Path, providers: &[ProviderPreset]) -> Result<(), CoreError> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let file = ProvidersFile {
        version: "1.0.0".into(),
        providers: providers.to_vec(),
    };
    std::fs::write(path, serde_json::to_string_pretty(&file)?)?;
    Ok(())
}

pub fn add(p: ProviderPreset) -> Result<(), CoreError> {
    add_to(&crate::paths::providers_path(), p)
}

/// 路径注入版 add
pub fn add_to(path: &Path, p: ProviderPreset) -> Result<(), CoreError> {
    crate::validate::validate_preset(&p)?;
    let mut all = load_from(path);
    all.retain(|x| x.id != p.id);
    all.push(p);
    save_to(path, &all)
}

pub fn remove(id: &str) -> Result<bool, CoreError> {
    remove_from(&crate::paths::providers_path(), id)
}

/// 路径注入版 remove
pub fn remove_from(path: &Path, id: &str) -> Result<bool, CoreError> {
    let mut all = load_from(path);
    let before = all.len();
    all.retain(|x| x.id != id);
    if all.len() != before {
        save_to(path, &all)?;
        Ok(true)
    } else {
        Ok(false)
    }
}
