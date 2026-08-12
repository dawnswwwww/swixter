use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallMethod {
    pub label: String,
    pub command: String,
    /// Node 风格平台名：darwin / linux / win32；空 = 全平台
    #[serde(default)]
    pub platforms: Vec<String>,
    #[serde(default)]
    pub recommended: bool,
    /// 执行解释器：bash / powershell / cmd（缺失时按平台默认）
    #[serde(default)]
    pub shell: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoderInstallConfig {
    pub methods: Vec<InstallMethod>,
    #[serde(default)]
    pub post_install_note: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallData {
    pub install_configs: std::collections::HashMap<String, CoderInstallConfig>,
    #[serde(default)]
    pub update_commands:
        std::collections::HashMap<String, std::collections::HashMap<String, String>>,
}

static DATA: OnceLock<InstallData> = OnceLock::new();

pub fn install_data() -> &'static InstallData {
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("install.json"))
            .expect("bundled install.json must be valid")
    })
}

fn current_platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
}

pub fn methods_for(coder_id: &str) -> Vec<&'static InstallMethod> {
    install_data()
        .install_configs
        .get(coder_id)
        .map(|c| {
            c.methods
                .iter()
                .filter(|m| {
                    m.platforms.is_empty() || m.platforms.iter().any(|p| p == current_platform())
                })
                .collect()
        })
        .unwrap_or_default()
}

/// TS: 更新命令映射缺失时回退原 install 命令
pub fn update_command_for(coder_id: &str, install_command: &str) -> Option<String> {
    install_data()
        .update_commands
        .get(coder_id)?
        .get(install_command)
        .cloned()
}
