use swixter_core::config::ConfigManager;
use swixter_core::types::{ApiFormat, ConfigFile};

fn fixture(name: &str) -> String {
    let p = format!(
        "{}/tests/fixtures/compat/{}",
        env!("CARGO_MANIFEST_DIR"),
        name
    );
    std::fs::read_to_string(p).unwrap()
}

#[test]
fn full_fixture_roundtrip() {
    let raw = fixture("full.json");
    let cfg: ConfigFile = serde_json::from_str(&raw).unwrap();
    assert_eq!(cfg.version, "2.0.0");
    let p = &cfg.profiles["work-kimi"];
    assert_eq!(p.provider_id, "kimi-coding");
    assert_eq!(p.api_format, Some(ApiFormat::AnthropicMessages));
    assert_eq!(
        p.models.as_ref().unwrap().default_haiku_model.as_deref(),
        Some("h1")
    );
    assert_eq!(cfg.coders["claude"].active_profile, "work-kimi");
    assert!(cfg.sync_meta.as_ref().unwrap().dirty.unwrap());
    let g = &cfg.groups["grp_1735689600000_abc123"];
    assert!(g.is_default);
    // 序列化后语义相等（字段顺序不要求一致）
    let back: serde_json::Value =
        serde_json::from_str(&serde_json::to_string_pretty(&cfg).unwrap()).unwrap();
    let orig: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(back, orig);
}

#[test]
fn v1_fixture_migrates_on_load() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, fixture("v1-legacy.json")).unwrap();
    let mgr = ConfigManager::load_from(path);
    assert_eq!(mgr.config().version, "2.0.0");
    assert_eq!(mgr.config().coders["claude"].active_profile, "work-kimi");
    assert!(mgr.config().groups.is_empty());
}

#[test]
fn v2_without_groups_keeps_profiles() {
    // v0.0.x 写的 2.0.0 配置没有 groups 字段（v0.0.12 createDefaultConfig 无 groups）。
    // groups 兜底必须对所有配置生效（TS manager.ts:67 在迁移分支之外），
    // 否则严格校验缺键 → 整体回退空配置，profiles 全部丢失
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, fixture("v2-no-groups.json")).unwrap();
    let mgr = ConfigManager::load_from(path);
    assert_eq!(mgr.config().profiles.len(), 2);
    assert!(mgr.config().profiles.contains_key("work-kimi"));
    assert_eq!(mgr.config().coders["claude"].active_profile, "work-kimi");
    assert!(mgr.config().groups.is_empty()); // 兜底为空表
}

#[test]
fn unknown_profile_fields_are_preserved() {
    // Profile 带 flatten extra：profile 内未知字段 roundtrip 保留
    // （REST 更新 / sync push 不再剥掉用户手加或未来版本的字段）；
    // ConfigFile 顶层未知字段仍被剥掉
    let cfg: ConfigFile = serde_json::from_str(&fixture("unknown-fields.json")).unwrap();
    let back: serde_json::Value =
        serde_json::from_str(&serde_json::to_string(&cfg).unwrap()).unwrap();
    assert!(back.get("futureField").is_none());
    assert_eq!(
        back["profiles"]["work-kimi"].get("futureProfileField"),
        Some(&serde_json::Value::Bool(true))
    );
}

#[test]
fn invalid_url_falls_back_to_default() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.json");
    std::fs::write(&path, fixture("invalid-url.json")).unwrap();
    let mgr = ConfigManager::load_from(path);
    assert!(mgr.config().profiles.is_empty()); // zod 等价行为：整体回退默认
}
