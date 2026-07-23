use crate::types::{ConfigFile, ProviderPreset};
use crate::CoreError;

/// zod 等价校验：任一失败则调用方整体回退默认配置。
pub fn validate_config(c: &ConfigFile) -> Result<(), CoreError> {
    for p in c.profiles.values() {
        if p.name.is_empty() {
            return Err(CoreError::Validation(
                "profile name must be non-empty".into(),
            ));
        }
        if let Some(u) = &p.base_url {
            url::Url::parse(u)
                .map_err(|_| CoreError::Validation(format!("invalid profile baseURL: {u}")))?;
        }
    }
    for g in c.groups.values() {
        if g.id.is_empty() || g.name.is_empty() || g.profiles.is_empty() {
            return Err(CoreError::Validation(format!("invalid group: {}", g.id)));
        }
    }
    Ok(())
}

pub fn validate_preset(p: &ProviderPreset) -> Result<(), CoreError> {
    url::Url::parse(&p.base_url)
        .map_err(|_| CoreError::Validation(format!("invalid preset baseURL: {}", p.base_url)))?;
    if let Some(d) = &p.docs {
        if !d.is_empty() {
            url::Url::parse(d)
                .map_err(|_| CoreError::Validation(format!("invalid preset docs url: {d}")))?;
        }
    }
    Ok(())
}
