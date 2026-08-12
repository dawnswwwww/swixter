use crate::types::{ModelsConfig, Profile, ProviderPreset};

// Claude proxy marker 模型名：proxy 请求体里的占位 model，handler 侧再解析回真实模型。
// Task 10 从 swixter-proxy 上移到 core（proxy profile 构造需要），
// swixter-proxy lib.rs re-export 保持既有引用不变。
pub const SWIXTER_CLAUDE_MODEL: &str = "SWIXTER_CLAUDE_MODEL";
pub const SWIXTER_CLAUDE_HAIKU_MODEL: &str = "SWIXTER_CLAUDE_HAIKU_MODEL";
pub const SWIXTER_CLAUDE_SONNET_MODEL: &str = "SWIXTER_CLAUDE_SONNET_MODEL";
pub const SWIXTER_CLAUDE_OPUS_MODEL: &str = "SWIXTER_CLAUDE_OPUS_MODEL";

/// TS: buildClaudeProxyMarkerModels —— 有对应真实模型才写 marker；全无可配 → None。
/// 各条件均为 TS 真值判断（`models?.anthropicModel || model` 等）：空串视为未配置，
/// 故 `.or`/`.map` 前先 filter 掉空串（Rust Option 只判 None，需显式对齐 `||` 语义）
pub fn build_claude_proxy_marker_models(p: &Profile) -> Option<ModelsConfig> {
    let m = ModelsConfig {
        anthropic_model: if p
            .models
            .as_ref()
            .and_then(|x| x.anthropic_model.as_deref())
            .filter(|s| !s.is_empty())
            .or(p.model.as_deref().filter(|s| !s.is_empty()))
            .is_some()
        {
            Some(SWIXTER_CLAUDE_MODEL.into())
        } else {
            None
        },
        default_haiku_model: p
            .models
            .as_ref()
            .and_then(|x| x.default_haiku_model.as_deref())
            .filter(|s| !s.is_empty())
            .map(|_| SWIXTER_CLAUDE_HAIKU_MODEL.into()),
        default_sonnet_model: p
            .models
            .as_ref()
            .and_then(|x| x.default_sonnet_model.as_deref())
            .filter(|s| !s.is_empty())
            .map(|_| SWIXTER_CLAUDE_SONNET_MODEL.into()),
        default_opus_model: p
            .models
            .as_ref()
            .and_then(|x| x.default_opus_model.as_deref())
            .filter(|s| !s.is_empty())
            .map(|_| SWIXTER_CLAUDE_OPUS_MODEL.into()),
    };
    if m.anthropic_model.is_none()
        && m.default_haiku_model.is_none()
        && m.default_sonnet_model.is_none()
        && m.default_opus_model.is_none()
    {
        None
    } else {
        Some(m)
    }
}

/// TS: model-helper.ts getOpenAIModel — 有 models 对象时返回 None。
/// `profile.model || profile.openaiModel`：model 为空串同样回退 openaiModel，
/// 故 filter 必须放在 `.or` 之前（而非只过滤最终结果）
pub fn get_openai_model(p: &Profile) -> Option<&str> {
    if p.models.is_some() {
        return None;
    }
    p.model
        .as_deref()
        .filter(|s| !s.is_empty())
        .or(p.openai_model.as_deref())
        .filter(|s| !s.is_empty())
}

/// TS: env-key-helper.ts — profile.envKey > preset.env_key > OPENAI_API_KEY
pub fn resolve_env_key<'a>(p: &'a Profile, preset: Option<&'a ProviderPreset>) -> &'a str {
    p.env_key
        .as_deref()
        .filter(|s| !s.is_empty())
        .or_else(|| {
            preset
                .and_then(|x| x.env_key.as_deref())
                .filter(|s| !s.is_empty())
        })
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
    for k in [
        m.auth_token,
        m.anthropic_model,
        m.default_haiku_model,
        m.default_opus_model,
        m.default_sonnet_model,
    ]
    .into_iter()
    .flatten()
    {
        v.push(k);
    }
    v
}

/// TS: model-helper.ts buildProfileEnv — 只写非空值
pub fn build_profile_env(p: &Profile, m: &EnvVarMapping, base_url: &str) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = Vec::new();
    let mut push = |k: &'static str, v: &str| {
        if !v.is_empty() {
            env.push((k.to_string(), v.to_string()));
        }
    };
    push(m.base_url, base_url);
    push(m.api_key, &p.api_key);
    if let (Some(k), Some(v)) = (m.auth_token, p.auth_token.as_deref()) {
        push(k, v);
    }
    if let Some(models) = &p.models {
        if let Some(k) = m.anthropic_model {
            if let Some(v) = models.anthropic_model.as_deref() {
                push(k, v);
            }
        }
        if let Some(k) = m.default_haiku_model {
            if let Some(v) = models.default_haiku_model.as_deref() {
                push(k, v);
            }
        }
        if let Some(k) = m.default_opus_model {
            if let Some(v) = models.default_opus_model.as_deref() {
                push(k, v);
            }
        }
        if let Some(k) = m.default_sonnet_model {
            if let Some(v) = models.default_sonnet_model.as_deref() {
                push(k, v);
            }
        }
    }
    env
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(model: Option<&str>, models: Option<ModelsConfig>) -> Profile {
        Profile {
            model: model.map(Into::into),
            models,
            ..Default::default()
        }
    }

    #[test]
    fn marker_models_follow_available_real_models() {
        // 只有 model 字段 → 只有主 marker
        let m = build_claude_proxy_marker_models(&profile(Some("glm-4"), None)).unwrap();
        assert_eq!(m.anthropic_model.as_deref(), Some(SWIXTER_CLAUDE_MODEL));
        assert!(m.default_haiku_model.is_none());

        // models 全配 → 4 个 marker 全写
        let full = ModelsConfig {
            anthropic_model: Some("a".into()),
            default_haiku_model: Some("h".into()),
            default_sonnet_model: Some("s".into()),
            default_opus_model: Some("o".into()),
        };
        let m = build_claude_proxy_marker_models(&profile(None, Some(full))).unwrap();
        assert_eq!(m.anthropic_model.as_deref(), Some(SWIXTER_CLAUDE_MODEL));
        assert_eq!(
            m.default_haiku_model.as_deref(),
            Some(SWIXTER_CLAUDE_HAIKU_MODEL)
        );
        assert_eq!(
            m.default_sonnet_model.as_deref(),
            Some(SWIXTER_CLAUDE_SONNET_MODEL)
        );
        assert_eq!(
            m.default_opus_model.as_deref(),
            Some(SWIXTER_CLAUDE_OPUS_MODEL)
        );

        // 部分配置：只有 sonnet → 只有 sonnet marker
        let partial = ModelsConfig {
            default_sonnet_model: Some("s".into()),
            ..Default::default()
        };
        let m = build_claude_proxy_marker_models(&profile(None, Some(partial))).unwrap();
        assert!(m.anthropic_model.is_none());
        assert_eq!(
            m.default_sonnet_model.as_deref(),
            Some(SWIXTER_CLAUDE_SONNET_MODEL)
        );
    }

    #[test]
    fn marker_models_none_when_nothing_configurable() {
        assert!(build_claude_proxy_marker_models(&profile(None, None)).is_none());
        assert!(
            build_claude_proxy_marker_models(&profile(None, Some(ModelsConfig::default())))
                .is_none()
        );
    }

    #[test]
    fn marker_models_treat_empty_string_as_unset() {
        // TS `||` 真值语义：空串等同未配置
        assert!(build_claude_proxy_marker_models(&profile(Some(""), None)).is_none());
        // anthropicModel 空串 → 回退 model
        let m = ModelsConfig {
            anthropic_model: Some("".into()),
            default_haiku_model: Some("".into()), // 空串 → 不写 marker
            ..Default::default()
        };
        let m = build_claude_proxy_marker_models(&profile(Some("glm-4"), Some(m))).unwrap();
        assert_eq!(m.anthropic_model.as_deref(), Some(SWIXTER_CLAUDE_MODEL));
        assert!(m.default_haiku_model.is_none());
    }

    #[test]
    fn openai_model_empty_string_falls_back() {
        // TS `profile.model || profile.openaiModel`：model 空串回退 openaiModel
        let mut p = profile(Some(""), None);
        p.openai_model = Some("gpt-4o".into());
        assert_eq!(get_openai_model(&p), Some("gpt-4o"));
        // 两者皆空串 → None
        let mut p = profile(Some(""), None);
        p.openai_model = Some("".into());
        assert_eq!(get_openai_model(&p), None);
    }
}
