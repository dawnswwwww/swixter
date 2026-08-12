use std::path::PathBuf;

/// home 目录解析：SWIXTER_HOME 环境变量优先（测试隔离用）。
/// Windows 上 dirs::home_dir() 走 Known Folder API（FOLDERID_Profile），
/// 不读 HOME 环境变量——只改测试的 HOME 在 Windows 上起不到隔离作用。
fn home_dir() -> PathBuf {
    if let Ok(p) = std::env::var("SWIXTER_HOME") {
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    dirs::home_dir().expect("cannot determine home directory")
}

/// TS: constants/paths.ts — SWIXTER_CONFIG_PATH 优先；
/// Windows: ~/swixter；Unix/macOS: ~/.config/swixter（硬编码，不读 XDG_CONFIG_HOME）
pub fn swixter_config_dir() -> PathBuf {
    let home = home_dir();
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
    home_dir().join(".claude").join("settings.json")
}

pub fn codex_config_path() -> PathBuf {
    home_dir().join(".codex").join("config.toml")
}

pub fn continue_config_path() -> PathBuf {
    home_dir().join(".continue").join("config.yaml")
}
