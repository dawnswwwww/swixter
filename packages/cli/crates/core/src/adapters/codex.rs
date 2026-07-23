// 占位：Task 7 实现完整 Codex adapter。
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::{Path, PathBuf};

pub struct CodexAdapter {
    config_path: PathBuf,
}

impl CodexAdapter {
    pub fn new() -> Self { Self { config_path: crate::paths::codex_config_path() } }
}

impl Default for CodexAdapter {
    fn default() -> Self { Self::new() }
}

impl super::CoderAdapter for CodexAdapter {
    fn name(&self) -> &'static str { "codex" }
    fn config_path(&self) -> &Path { &self.config_path }
    fn apply(&self, _profile: &Profile, _preset: Option<&ProviderPreset>) -> Result<(), CoreError> { Ok(()) }
    fn verify(&self, _profile: &Profile, _preset: Option<&ProviderPreset>) -> bool { false }
    fn remove(&self, _profile_name: &str) -> Result<(), CoreError> { Ok(()) }
}
