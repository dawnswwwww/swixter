pub mod claude;
pub mod codex;
pub mod continue_;

use crate::coder::AdapterKind;
use crate::types::{Profile, ProviderPreset};
use crate::CoreError;
use std::path::Path;

pub trait CoderAdapter {
    fn name(&self) -> &'static str;
    fn config_path(&self) -> &Path;
    fn apply(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> Result<(), CoreError>;
    fn verify(&self, profile: &Profile, preset: Option<&ProviderPreset>) -> bool;
    fn remove(&self, profile_name: &str) -> Result<(), CoreError>;
}

pub fn get_adapter(kind: AdapterKind) -> Box<dyn CoderAdapter> {
    match kind {
        AdapterKind::Claude => Box::new(claude::ClaudeCodeAdapter::new()),
        AdapterKind::Codex => Box::new(codex::CodexAdapter::new()),
        AdapterKind::Continue => Box::new(continue_::ContinueAdapter::new()),
    }
}
