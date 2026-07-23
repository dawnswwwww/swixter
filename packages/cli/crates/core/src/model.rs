use crate::types::{Profile, ProviderPreset};

/// TS: model-helper.ts getOpenAIModel — 有 models 对象时返回 None
pub fn get_openai_model(p: &Profile) -> Option<&str> {
    if p.models.is_some() { return None; }
    p.model.as_deref().or(p.openai_model.as_deref()).filter(|s| !s.is_empty())
}

/// TS: env-key-helper.ts — profile.envKey > preset.env_key > OPENAI_API_KEY
pub fn resolve_env_key<'a>(p: &'a Profile, preset: Option<&'a ProviderPreset>) -> &'a str {
    p.env_key.as_deref().filter(|s| !s.is_empty())
        .or_else(|| preset.and_then(|x| x.env_key.as_deref()).filter(|s| !s.is_empty()))
        .unwrap_or("OPENAI_API_KEY")
}

/// TS: constants/coders.ts envVarMapping
pub struct EnvVarMapping {
    pub api_key: &'static str,
    pub auth_token: Option<&'static str>,
    pub base_url: &'static str,
    pub anthropic_model: Option<&'static str>,
    pub default_haiku_model: Option<&'static str>,
    pub default_opus_model: Option<&'static str>,
    pub default_sonnet_model: Option<&'static str>,
}

pub const CLAUDE_ENV_MAPPING: EnvVarMapping = EnvVarMapping {
    api_key: "ANTHROPIC_API_KEY",
    auth_token: Some("ANTHROPIC_AUTH_TOKEN"),
    base_url: "ANTHROPIC_BASE_URL",
    anthropic_model: Some("ANTHROPIC_MODEL"),
    default_haiku_model: Some("ANTHROPIC_DEFAULT_HAIKU_MODEL"),
    default_opus_model: Some("ANTHROPIC_DEFAULT_OPUS_MODEL"),
    default_sonnet_model: Some("ANTHROPIC_DEFAULT_SONNET_MODEL"),
};

pub fn managed_keys(m: &EnvVarMapping) -> Vec<&'static str> {
    let mut v = vec![m.api_key, m.base_url];
    for k in [m.auth_token, m.anthropic_model, m.default_haiku_model,
              m.default_opus_model, m.default_sonnet_model].into_iter().flatten() {
        v.push(k);
    }
    v
}

/// TS: model-helper.ts buildProfileEnv — 只写非空值
pub fn build_profile_env(p: &Profile, m: &EnvVarMapping, base_url: &str) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    let mut push = |k: &'static str, v: &str| {
        if !v.is_empty() { env.push((k.to_string(), v.to_string())); }
    };
    push(m.base_url, base_url);
    push(m.api_key, &p.api_key);
    if let (Some(k), Some(v)) = (m.auth_token, p.auth_token.as_deref()) { push(k, v); }
    if let Some(models) = &p.models {
        if let Some(k) = m.anthropic_model { if let Some(v) = models.anthropic_model.as_deref() { push(k, v); } }
        if let Some(k) = m.default_haiku_model { if let Some(v) = models.default_haiku_model.as_deref() { push(k, v); } }
        if let Some(k) = m.default_opus_model { if let Some(v) = models.default_opus_model.as_deref() { push(k, v); } }
        if let Some(k) = m.default_sonnet_model { if let Some(v) = models.default_sonnet_model.as_deref() { push(k, v); } }
    }
    env
}
