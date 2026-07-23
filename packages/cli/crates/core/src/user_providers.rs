use crate::types::ProviderPreset;
use crate::CoreError;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct ProvidersFile {
    version: String,
    #[serde(default)]
    providers: Vec<ProviderPreset>,
}

/// TS: user-providers.ts — 任一条目校验失败则整个文件回退空数组
pub fn load() -> Vec<ProviderPreset> {
    let path = crate::paths::providers_path();
    let raw = match std::fs::read_to_string(&path) {
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
    let path = crate::paths::providers_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let file = ProvidersFile {
        version: "1.0.0".into(),
        providers: providers.to_vec(),
    };
    std::fs::write(&path, serde_json::to_string_pretty(&file)?)?;
    Ok(())
}

pub fn add(p: ProviderPreset) -> Result<(), CoreError> {
    crate::validate::validate_preset(&p)?;
    let mut all = load();
    all.retain(|x| x.id != p.id);
    all.push(p);
    save(&all)
}

pub fn remove(id: &str) -> Result<bool, CoreError> {
    let mut all = load();
    let before = all.len();
    all.retain(|x| x.id != id);
    if all.len() != before {
        save(&all)?;
        Ok(true)
    } else {
        Ok(false)
    }
}
