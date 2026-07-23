use crate::types::ProviderPreset;
use std::sync::OnceLock;

static PRESETS: OnceLock<Vec<ProviderPreset>> = OnceLock::new();

pub fn builtin_presets() -> &'static [ProviderPreset] {
    PRESETS.get_or_init(|| {
        serde_json::from_str(include_str!("presets.json"))
            .expect("bundled presets.json must be valid")
    })
}

pub fn find_builtin(id: &str) -> Option<&'static ProviderPreset> {
    builtin_presets().iter().find(|p| p.id == id)
}

/// TS: presets.ts getProviderById — 用户自定义优先，可按 id 覆盖内置
pub fn find_provider(id: &str) -> Option<ProviderPreset> {
    if let Some(p) = crate::user_providers::load()
        .into_iter()
        .find(|p| p.id == id)
    {
        return Some(p);
    }
    find_builtin(id).cloned()
}

// 注：`user_provider_overrides_builtin` 依赖 SWIXTER_CONFIG_PATH 环境变量，
// 必须串行运行：`cargo test -p swixter-core -- --test-threads=1`
#[cfg(test)]
mod tests {
    #[test]
    fn builtins_loaded() {
        let presets = crate::presets::builtin_presets();
        // 实际内置 preset 为 42 个（Task 1 codegen 确认），计划中的 43 为笔误
        assert_eq!(presets.len(), 42);
        let anthropic = crate::presets::find_builtin("anthropic").unwrap();
        assert_eq!(anthropic.base_url, "https://api.anthropic.com");
        assert_eq!(anthropic.wire_api, Some(crate::types::WireApi::Responses));
        assert!(anthropic.model_families.as_ref().unwrap().len() >= 3);
        let custom = crate::presets::find_builtin("custom").unwrap();
        assert_eq!(custom.base_url, ""); // custom preset 空 baseURL，不可走 validate_preset
        let ollama = crate::presets::find_builtin("ollama").unwrap();
        assert_eq!(ollama.auth_type, crate::types::AuthType::Custom);
    }

    #[test]
    fn user_provider_overrides_builtin() {
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("SWIXTER_CONFIG_PATH", dir.path().join("config.json"));
        let p = crate::types::ProviderPreset {
            id: "ollama".into(),
            name: "ollama".into(),
            display_name: "My Ollama".into(),
            base_url: "http://192.168.1.10:11434".into(),
            default_models: vec![],
            auth_type: crate::types::AuthType::Custom,
            ..Default::default()
        };
        crate::user_providers::add(p).unwrap();
        let found = crate::presets::find_provider("ollama").unwrap();
        assert_eq!(found.display_name, "My Ollama");
        std::env::remove_var("SWIXTER_CONFIG_PATH");
    }
}
