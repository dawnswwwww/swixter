use crate::types::{ConfigFile, ProviderPreset};
use crate::CoreError;

/// zod 等价校验：任一失败则调用方整体回退默认配置。
pub fn validate_config(c: &ConfigFile) -> Result<(), CoreError> {
    for p in c.profiles.values() {
        validate_profile(p)?;
    }
    for g in c.groups.values() {
        if g.id.is_empty() || g.name.is_empty() || g.profiles.is_empty() {
            return Err(CoreError::Validation(format!("invalid group: {}", g.id)));
        }
    }
    Ok(())
}

/// 单条 profile 校验（load 整批校验与 import 逐条收集错误共用）。
/// TS ClaudeCodeProfileSchema：name 非空；baseURL optional 但非 None 必须合法 URL。
pub fn validate_profile(p: &crate::types::Profile) -> Result<(), CoreError> {
    if p.name.is_empty() {
        return Err(CoreError::Validation(
            "profile name must be non-empty".into(),
        ));
    }
    if let Some(u) = &p.base_url {
        url::Url::parse(u)
            .map_err(|_| CoreError::Validation(format!("invalid profile baseURL: {u}")))?;
    }
    Ok(())
}

pub fn validate_preset(p: &ProviderPreset) -> Result<(), CoreError> {
    url::Url::parse(&p.base_url)
        .map_err(|_| CoreError::Validation(format!("invalid preset baseURL: {}", p.base_url)))?;
    // TS ProviderPresetSchema: docs 为 z.string().url().optional() —— 空串同样非法
    if let Some(d) = &p.docs {
        url::Url::parse(d)
            .map_err(|_| CoreError::Validation(format!("invalid preset docs url: {d}")))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn preset() -> ProviderPreset {
        ProviderPreset {
            id: "p".into(),
            name: "p".into(),
            display_name: "P".into(),
            base_url: "https://api.example.com".into(),
            ..Default::default()
        }
    }

    #[test]
    fn preset_docs_empty_string_rejected() {
        // TS zod `.url()`：optional 但非 None 必须合法 URL，空串拒绝
        let mut p = preset();
        p.docs = Some(String::new());
        assert!(matches!(validate_preset(&p), Err(CoreError::Validation(_))));
        p.docs = Some("not a url".into());
        assert!(matches!(validate_preset(&p), Err(CoreError::Validation(_))));
        p.docs = Some("https://docs.example.com".into());
        assert!(validate_preset(&p).is_ok());
        p.docs = None;
        assert!(validate_preset(&p).is_ok());
    }

    #[test]
    fn profile_base_url_rules() {
        let mut p = crate::types::Profile {
            name: "p".into(),
            ..Default::default()
        };
        assert!(validate_profile(&p).is_ok()); // baseURL 缺省放行
        p.base_url = Some(String::new());
        assert!(matches!(
            validate_profile(&p),
            Err(CoreError::Validation(_))
        )); // 空串非合法 URL
        p.base_url = Some("https://api.example.com".into());
        assert!(validate_profile(&p).is_ok());
        p.name = String::new();
        assert!(matches!(
            validate_profile(&p),
            Err(CoreError::Validation(_))
        )); // name 必填
    }
}
