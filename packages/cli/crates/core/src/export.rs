use crate::config::ConfigManager;
use crate::types::{now_iso, ConfigFile, Profile};
use crate::CoreError;
use serde::{Deserialize, Serialize};
use std::path::Path;

pub const EXPORT_VERSION: &str = "1.0.0";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFile {
    pub profiles: Vec<Profile>,
    pub exported_at: String,
    pub version: String,
    // 早期导出文件可能缺 sanitized 字段；缺省按 false 处理以便导入
    #[serde(default)]
    pub sanitized: bool,
}

#[derive(Debug)]
pub struct ImportStats {
    pub imported: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

pub struct ExportFileInfo {
    pub profile_count: usize,
    pub sanitized: bool,
}

/// TS: API_KEY_FORMAT sanitizeLength=8, prefixLength=4, suffixLength=4
/// 按字符数切片（对齐 TS slice(0,4)/slice(-4) 语义）——按字节切非 ASCII key 会 panic
pub fn sanitize_api_key(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 8 {
        return "***".into();
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{head}***{tail}")
}

pub fn export_config(
    config: &ConfigFile,
    path: &Path,
    sanitize: bool,
    names: Option<&[String]>,
) -> Result<(), CoreError> {
    let mut profiles: Vec<Profile> = match names {
        Some(ns) if !ns.is_empty() => ns
            .iter()
            .filter_map(|n| config.profiles.get(n).cloned())
            .collect(),
        _ => config.profiles.values().cloned().collect(),
    };
    if profiles.is_empty() {
        return Err(CoreError::Validation(
            "No profiles available to export".into(),
        ));
    }
    if sanitize {
        for p in &mut profiles {
            p.api_key = sanitize_api_key(&p.api_key);
        }
    }
    let data = ExportFile {
        profiles,
        exported_at: now_iso(),
        version: EXPORT_VERSION.into(),
        sanitized: sanitize,
    };
    std::fs::write(path, serde_json::to_string_pretty(&data)?)?;
    Ok(())
}

pub fn import_config(
    mgr: &mut ConfigManager,
    path: &Path,
    overwrite: bool,
    skip_sanitized: bool,
) -> Result<ImportStats, CoreError> {
    if !path.exists() {
        return Err(CoreError::InvalidImport(format!(
            "File does not exist: {}",
            path.display()
        )));
    }
    let raw = std::fs::read_to_string(path)?;
    let data: ExportFile = serde_json::from_str(&raw)
        .map_err(|e| CoreError::InvalidImport(format!("Invalid import file format: {e}")))?;
    if data.sanitized && skip_sanitized {
        return Err(CoreError::InvalidImport(
            "Import file contains sanitized API Keys and cannot be imported. \
             Please use the complete configuration file or set skipSanitized=false"
                .into(),
        ));
    }
    let mut stats = ImportStats {
        imported: 0,
        skipped: 0,
        errors: vec![],
    };
    let now = now_iso();
    for profile in data.profiles {
        // TS export.ts importConfig —— 逐条 try/catch：失败项收集进 errors（含原因），
        // 不中断整体导入；消息格式对齐 TS `Failed to import "<name>": <error>`
        if let Err(e) = crate::validate::validate_profile(&profile) {
            stats
                .errors
                .push(format!("Failed to import \"{}\": {e}", profile.name));
            continue;
        }
        let existing = mgr.config().profiles.get(&profile.name);
        if existing.is_some() && !overwrite {
            stats.skipped += 1;
            continue;
        }
        let mut p = profile.clone();
        p.created_at = existing
            .map(|e| e.created_at.clone())
            .unwrap_or_else(|| now.clone());
        p.updated_at = now.clone();
        mgr.config_mut_for_test().profiles.insert(p.name.clone(), p);
        stats.imported += 1;
    }
    if stats.imported > 0 {
        mgr.mark_dirty();
        mgr.save()?;
    }
    Ok(stats)
}

pub fn validate_export_file(path: &Path) -> Result<ExportFileInfo, CoreError> {
    let raw = std::fs::read_to_string(path)
        .map_err(|_| CoreError::InvalidImport("File does not exist".into()))?;
    let data: ExportFile =
        serde_json::from_str(&raw).map_err(|e| CoreError::InvalidImport(e.to_string()))?;
    Ok(ExportFileInfo {
        profile_count: data.profiles.len(),
        sanitized: data.sanitized,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ConfigManager;
    use crate::types::Profile;

    fn profile(name: &str, key: &str) -> Profile {
        Profile {
            name: name.into(),
            provider_id: "ollama".into(),
            api_key: key.into(),
            created_at: "2025-01-01T00:00:00.000Z".into(),
            updated_at: "2025-01-01T00:00:00.000Z".into(),
            ..Default::default()
        }
    }

    #[test]
    fn sanitize_rules() {
        assert_eq!(sanitize_api_key("short"), "***"); // ≤8
        assert_eq!(sanitize_api_key("12345678"), "***"); // 恰好 8
        assert_eq!(sanitize_api_key("sk-1234567890abcd"), "sk-1***abcd");
    }

    #[test]
    fn sanitize_non_ascii_key_no_panic() {
        // 非 ASCII key 按字符切片（TS slice(0,4)/slice(-4) 语义），不得按字节 panic
        assert_eq!(sanitize_api_key("sk-中文密钥测试-key-abcd"), "sk-中***abcd");
        assert_eq!(sanitize_api_key("中文密钥测试12345"), "中文密钥***2345");
        assert_eq!(sanitize_api_key("中文密钥"), "***"); // 4 字符 ≤ 8
    }

    #[test]
    fn import_collects_per_profile_errors() {
        // 逐条校验：非法 profile 进 errors（含名称与原因），合法 profile 照常导入
        let dir = tempfile::tempdir().unwrap();
        let mut mgr = ConfigManager::load_from(dir.path().join("config.json"));
        let out = dir.path().join("export.json");
        let mut bad = profile("bad", "k-123456789");
        bad.base_url = Some("not a url".into());
        std::fs::write(
            &out,
            serde_json::json!({
                "profiles": [
                    serde_json::to_value(profile("good", "k-000000000")).unwrap(),
                    serde_json::to_value(bad).unwrap(),
                ],
                "exportedAt": "2025-01-01T00:00:00.000Z",
                "version": "1.0.0"
            })
            .to_string(),
        )
        .unwrap();
        let stats = import_config(&mut mgr, &out, false, true).unwrap();
        assert_eq!(stats.imported, 1);
        assert_eq!(stats.errors.len(), 1);
        assert!(stats.errors[0].starts_with("Failed to import \"bad\":"));
        assert!(stats.errors[0].contains("invalid profile baseURL"));
        assert!(mgr.get_profile("good").is_some());
        assert!(mgr.get_profile("bad").is_none());
    }

    #[test]
    fn export_sanitized_roundtrip_and_skip() {
        let dir = tempfile::tempdir().unwrap();
        let mut mgr = ConfigManager::load_from(dir.path().join("config.json"));
        mgr.upsert_profile(profile("p1", "sk-1234567890abcd"), None)
            .unwrap();
        let out = dir.path().join("export.json");
        export_config(mgr.config(), &out, true, None).unwrap();
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        assert_eq!(raw["version"], "1.0.0");
        assert_eq!(raw["sanitized"], true);
        assert_eq!(raw["profiles"][0]["apiKey"], "sk-1***abcd");
        // sanitized + skip_sanitized → 拒绝导入
        let err = import_config(&mut mgr, &out, false, true).unwrap_err();
        assert!(matches!(err, CoreError::InvalidImport(_)));
    }

    #[test]
    fn import_without_sanitized_field_defaults_false() {
        // 缺 sanitized 字段的导出文件可导入（按 false 处理）
        let dir = tempfile::tempdir().unwrap();
        let mut mgr = ConfigManager::load_from(dir.path().join("config.json"));
        let out = dir.path().join("export.json");
        std::fs::write(
            &out,
            serde_json::json!({
                "profiles": [serde_json::to_value(profile("p1", "sk-1234567890abcd")).unwrap()],
                "exportedAt": "2025-01-01T00:00:00.000Z",
                "version": "1.0.0"
            })
            .to_string(),
        )
        .unwrap();
        let stats = import_config(&mut mgr, &out, false, true).unwrap();
        assert_eq!(stats.imported, 1);
        assert_eq!(mgr.get_profile("p1").unwrap().api_key, "sk-1234567890abcd");
        assert!(!validate_export_file(&out).unwrap().sanitized);
    }

    #[test]
    fn export_import_roundtrip_preserves_extra_fields() {
        // 未知字段随 profile 一并导出/导入（flatten extra）；
        // apiKey 是已知字段仍正常走 sanitize，extra 无法绕过脱敏
        let dir = tempfile::tempdir().unwrap();
        let mut mgr = ConfigManager::load_from(dir.path().join("config.json"));
        let mut p = profile("p1", "sk-1234567890abcd");
        p.extra
            .insert("customField".into(), serde_json::json!({"x": 1}));
        mgr.upsert_profile(p, None).unwrap();
        let out = dir.path().join("export.json");
        export_config(mgr.config(), &out, true, None).unwrap();
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        assert_eq!(
            raw["profiles"][0]["customField"],
            serde_json::json!({"x": 1})
        );
        assert_eq!(raw["profiles"][0]["apiKey"], "sk-1***abcd");
        let mut mgr2 = ConfigManager::load_from(dir.path().join("config2.json"));
        let stats = import_config(&mut mgr2, &out, false, false).unwrap();
        assert_eq!(stats.imported, 1);
        assert_eq!(
            mgr2.get_profile("p1").unwrap().extra.get("customField"),
            Some(&serde_json::json!({"x": 1}))
        );
    }

    #[test]
    fn import_skip_existing_and_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let mut mgr = ConfigManager::load_from(dir.path().join("config.json"));
        mgr.upsert_profile(profile("p1", "old-key-00000000"), None)
            .unwrap();
        let out = dir.path().join("export.json");
        // 导出（不 sanitize），改 key 后重新导入
        export_config(mgr.config(), &out, false, None).unwrap();
        let mut data: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        data["profiles"][0]["apiKey"] = "new-key-11111111".into();
        data["profiles"]
            .as_array_mut()
            .unwrap()
            .push(serde_json::to_value(profile("p2", "k2-22222222")).unwrap());
        std::fs::write(&out, serde_json::to_string_pretty(&data).unwrap()).unwrap();

        let stats = import_config(&mut mgr, &out, false, true).unwrap();
        assert_eq!((stats.imported, stats.skipped), (1, 1)); // p2 导入，p1 跳过
        assert_eq!(mgr.get_profile("p1").unwrap().api_key, "old-key-00000000");

        let stats = import_config(&mut mgr, &out, true, true).unwrap();
        assert_eq!((stats.imported, stats.skipped), (2, 0));
        assert_eq!(mgr.get_profile("p1").unwrap().api_key, "new-key-11111111");
        // createdAt 保留，updatedAt 更新
        assert_eq!(
            mgr.get_profile("p1").unwrap().created_at,
            "2025-01-01T00:00:00.000Z"
        );
        assert_ne!(
            mgr.get_profile("p1").unwrap().updated_at,
            "2025-01-01T00:00:00.000Z"
        );
    }
}
