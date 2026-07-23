use bytes::Bytes;
use serde_json::Value;
use swixter_core::types::Profile;

use crate::{
    SWIXTER_CLAUDE_HAIKU_MODEL, SWIXTER_CLAUDE_MODEL, SWIXTER_CLAUDE_OPUS_MODEL,
    SWIXTER_CLAUDE_SONNET_MODEL,
};

pub fn is_swixter_claude_proxy_marker(model: &str) -> bool {
    matches!(
        model,
        SWIXTER_CLAUDE_MODEL
            | SWIXTER_CLAUDE_HAIKU_MODEL
            | SWIXTER_CLAUDE_SONNET_MODEL
            | SWIXTER_CLAUDE_OPUS_MODEL
    )
}

/// TS: resolveSwixterClaudeProxyMarker（事实表 §model 改写）：
/// HAIKU→defaultHaikuModel||anthropicModel||model；SONNET/OPUS 同理；主 marker→anthropicModel||model
pub fn resolve_swixter_claude_proxy_marker(model: &str, profile: &Profile) -> Option<String> {
    let models = profile.models.as_ref();
    let anthropic = models.and_then(|m| m.anthropic_model.as_deref());
    let resolved = match model {
        SWIXTER_CLAUDE_MODEL => anthropic.or(profile.model.as_deref()),
        SWIXTER_CLAUDE_HAIKU_MODEL => models
            .and_then(|m| m.default_haiku_model.as_deref())
            .or(anthropic)
            .or(profile.model.as_deref()),
        SWIXTER_CLAUDE_SONNET_MODEL => models
            .and_then(|m| m.default_sonnet_model.as_deref())
            .or(anthropic)
            .or(profile.model.as_deref()),
        SWIXTER_CLAUDE_OPUS_MODEL => models
            .and_then(|m| m.default_opus_model.as_deref())
            .or(anthropic)
            .or(profile.model.as_deref()),
        _ => return None,
    };
    resolved.filter(|s| !s.is_empty()).map(str::to_string)
}

/// TS: getGeneralProxyModel = models?.anthropicModel || model
pub fn general_proxy_model(profile: &Profile) -> Option<String> {
    profile
        .models
        .as_ref()
        .and_then(|m| m.anthropic_model.as_deref())
        .or(profile.model.as_deref())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// TS: rewriteRequestBodyForProfile —— marker 解析失败/坏 JSON/非对象 → 原样透传
/// （Global Constraints 已知偏差：TS 的 marker 错误 rethrow 是死分支，不保留）
pub fn rewrite_request_body_for_profile(body: &Bytes, profile: &Profile) -> Bytes {
    let Ok(mut parsed) = serde_json::from_slice::<Value>(body) else {
        return body.clone();
    };
    let Some(obj) = parsed.as_object_mut() else {
        return body.clone();
    };
    let current = obj.get("model").and_then(Value::as_str).unwrap_or("");
    let replacement = if is_swixter_claude_proxy_marker(current) {
        resolve_swixter_claude_proxy_marker(current, profile)
    } else {
        general_proxy_model(profile)
    };
    let Some(new_model) = replacement else {
        return body.clone();
    };
    obj.insert("model".into(), Value::String(new_model));
    Bytes::from(serde_json::to_vec(&parsed).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;
    use swixter_core::types::ModelsConfig;

    #[test]
    fn marker_resolution_priority() {
        let p = Profile {
            models: Some(ModelsConfig {
                anthropic_model: Some("main".into()),
                default_haiku_model: Some("h".into()),
                default_sonnet_model: None,
                default_opus_model: None,
            }),
            model: Some("fallback".into()),
            ..Default::default()
        };
        assert_eq!(
            resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_MODEL, &p).as_deref(),
            Some("main")
        );
        assert_eq!(
            resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_HAIKU_MODEL, &p).as_deref(),
            Some("h")
        );
        // sonnet 缺 → anthropicModel
        assert_eq!(
            resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_SONNET_MODEL, &p).as_deref(),
            Some("main")
        );
        let p2 = Profile {
            model: Some("m".into()),
            ..Default::default()
        };
        // 全缺 → model
        assert_eq!(
            resolve_swixter_claude_proxy_marker(SWIXTER_CLAUDE_HAIKU_MODEL, &p2).as_deref(),
            Some("m")
        );
    }

    #[test]
    fn rewrite_marker_and_forced_override() {
        let p = Profile {
            models: Some(ModelsConfig {
                anthropic_model: Some("real-model".into()),
                ..Default::default()
            }),
            ..Default::default()
        };
        let body = Bytes::from(r#"{"model":"SWIXTER_CLAUDE_MODEL","messages":[]}"#);
        let out = rewrite_request_body_for_profile(&body, &p);
        assert_eq!(
            serde_json::from_slice::<Value>(&out).unwrap()["model"],
            "real-model"
        );
        // 非 marker → 强制覆盖
        let body2 = Bytes::from(r#"{"model":"claude-3-5-sonnet","messages":[]}"#);
        let out2 = rewrite_request_body_for_profile(&body2, &p);
        assert_eq!(
            serde_json::from_slice::<Value>(&out2).unwrap()["model"],
            "real-model"
        );
        // 无 general model → 原样；坏 JSON → 原样
        let p3 = Profile::default();
        assert_eq!(rewrite_request_body_for_profile(&body2, &p3), body2);
        let bad = Bytes::from("{bad");
        assert_eq!(rewrite_request_body_for_profile(&bad, &p), bad);
    }
}
