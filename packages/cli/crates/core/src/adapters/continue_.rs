// 占位：Task 8 实现完整 Continue adapter。
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::{Path, PathBuf};

pub struct ContinueAdapter {
    path: PathBuf,
}

impl ContinueAdapter {
    pub fn new() -> Self { Self { path: crate::paths::continue_config_path() } }
}

impl Default for ContinueAdapter {
    fn default() -> Self { Self::new() }
}

impl super::CoderAdapter for ContinueAdapter {
    fn name(&self) -> &'static str { "continue" }
    fn config_path(&self) -> &Path { &self.path }
    fn apply(&self, _profile: &Profile, _preset: Option<&ProviderPreset>) -> Result<(), CoreError> { Ok(()) }
    fn verify(&self, _profile: &Profile, _preset: Option<&ProviderPreset>) -> bool { false }
    fn remove(&self, _profile_name: &str) -> Result<(), CoreError> { Ok(()) }
}
