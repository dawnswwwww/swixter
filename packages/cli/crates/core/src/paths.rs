use std::path::PathBuf;

/// TS: constants/paths.ts — SWIXTER_CONFIG_PATH 优先；
/// Windows: ~/swixter；Unix/macOS: ~/.config/swixter（硬编码，不读 XDG_CONFIG_HOME）
pub fn swixter_config_dir() -> PathBuf {
    let home = dirs::home_dir().expect("cannot determine home directory");
    if cfg!(windows) {
        home.join("swixter")
    } else {
        home.join(".config").join("swixter")
    }
}

pub fn config_path() -> PathBuf {
    if let Ok(p) = std::env::var("SWIXTER_CONFIG_PATH") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    swixter_config_dir().join("config.json")
}

pub fn providers_path() -> PathBuf {
    config_path().parent().unwrap().join("providers.json")
}

pub fn claude_settings_path() -> PathBuf {
    dirs::home_dir()
        .unwrap()
        .join(".claude")
        .join("settings.json")
}

pub fn codex_config_path() -> PathBuf {
    dirs::home_dir().unwrap().join(".codex").join("config.toml")
}

pub fn continue_config_path() -> PathBuf {
    dirs::home_dir()
        .unwrap()
        .join(".continue")
        .join("config.yaml")
}
