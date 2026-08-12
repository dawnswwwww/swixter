use crate::config::ConfigManager;
use crate::types::{now_iso, Group};
use crate::CoreError;

pub fn generate_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis();
    // 6 位 base36 随机（TS: Math.random().toString(36)）
    let n: u32 = rand::random::<u32>() % 36u32.pow(6);
    let mut s = String::new();
    let mut v = n;
    for _ in 0..6 {
        let d = (v % 36) as u8;
        s.push(if d < 10 {
            (b'0' + d) as char
        } else {
            (b'a' + d - 10) as char
        });
        v /= 36;
    }
    format!("grp_{millis}_{s}")
}

/// TS: cli/group.ts validateGroupNameOrExit → utils/validation.ts validateProfileName
/// （group 复用 profile name 校验规则）：trim 后为空 / 长度 < 2 / 字符集外字符均拒绝。
/// 字符集 ^[a-zA-Z0-9_-]+$（VALIDATION_RULES.profileNamePattern），最小长度 2。
fn validate_group_name(trimmed: &str) -> Result<(), CoreError> {
    if trimmed.is_empty() {
        return Err(CoreError::Validation("Profile name cannot be empty".into()));
    }
    if trimmed.chars().count() < 2 {
        return Err(CoreError::Validation(
            "Profile name must be at least 2 characters".into(),
        ));
    }
    if !trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(CoreError::Validation(
            "Can only contain letters, numbers, underscores and hyphens".into(),
        ));
    }
    Ok(())
}

/// TS: cli/group.ts normalizeAndValidateProfiles —— 组内重复 profile 拒绝
fn validate_no_duplicate_profiles(profiles: &[String]) -> Result<(), CoreError> {
    let mut seen = std::collections::HashSet::new();
    let mut duplicates: Vec<&str> = Vec::new();
    for p in profiles {
        if !seen.insert(p.as_str()) && !duplicates.contains(&p.as_str()) {
            duplicates.push(p.as_str());
        }
    }
    if !duplicates.is_empty() {
        return Err(CoreError::Validation(format!(
            "Duplicate profiles are not allowed: {}",
            duplicates.join(", ")
        )));
    }
    Ok(())
}

pub fn create(
    mgr: &mut ConfigManager,
    name: &str,
    profiles: Vec<String>,
) -> Result<Group, CoreError> {
    // TS validateGroupNameOrExit 返回 trim 后的名字并以其存储
    let name = name.trim();
    validate_group_name(name)?;
    if profiles.is_empty() {
        return Err(CoreError::Validation(
            "group must contain at least one profile".into(),
        ));
    }
    validate_no_duplicate_profiles(&profiles)?;
    // TS cli/group.ts:76 —— 重名拒绝（exit 2 由 CLI 层映射）
    if mgr.config().groups.values().any(|g| g.name == name) {
        return Err(CoreError::Validation(format!(
            "Group \"{name}\" already exists"
        )));
    }
    for p in &profiles {
        if !mgr.config().profiles.contains_key(p) {
            return Err(CoreError::NotFound(format!(
                "Profile \"{p}\" does not exist"
            )));
        }
    }
    let now = now_iso();
    let group = Group {
        id: generate_id(),
        name: name.to_string(),
        profiles,
        is_default: false,
        created_at: now.clone(),
        updated_at: now,
    };
    let is_first = mgr.config().groups.is_empty();
    mgr.config_mut_for_test()
        .groups
        .insert(group.id.clone(), group.clone());
    if is_first {
        mgr.config_mut_for_test().active_group = Some(group.id.clone());
    }
    mgr.mark_dirty();
    mgr.save()?;
    Ok(group)
}

pub fn update(
    mgr: &mut ConfigManager,
    id: &str,
    name: Option<&str>,
    profiles: Option<Vec<String>>,
) -> Result<Group, CoreError> {
    // 先完成存在性与 profiles 校验，再取可变借用（计划代码的借用顺序无法过 borrowck）
    if !mgr.config().groups.contains_key(id) {
        return Err(CoreError::NotFound(format!("Group \"{id}\" not found")));
    }
    let name = name.map(str::trim);
    if let Some(n) = name {
        validate_group_name(n)?;
        // TS validateGroupNameOrExit(name, currentGroupName) —— 排除自身后拒绝与现有组重名
        let is_current = mgr.config().groups[id].name == n;
        if !is_current && mgr.config().groups.values().any(|g| g.name == n) {
            return Err(CoreError::Validation(format!(
                "Group \"{n}\" already exists"
            )));
        }
    }
    if let Some(ps) = &profiles {
        if ps.is_empty() {
            return Err(CoreError::Validation(
                "group must contain at least one profile".into(),
            ));
        }
        validate_no_duplicate_profiles(ps)?;
        for p in ps {
            if !mgr.config().profiles.contains_key(p) {
                return Err(CoreError::NotFound(format!(
                    "Profile \"{p}\" does not exist"
                )));
            }
        }
    }
    let groups = &mut mgr.config_mut_for_test().groups;
    let g = groups.get_mut(id).unwrap();
    if let Some(n) = name {
        g.name = n.to_string(); // n 已 trim
    }
    if let Some(ps) = profiles {
        g.profiles = ps;
    }
    g.updated_at = now_iso();
    let out = g.clone();
    mgr.mark_dirty();
    mgr.save()?;
    Ok(out)
}

pub fn delete(mgr: &mut ConfigManager, id: &str) -> Result<(), CoreError> {
    // shift_remove 保持剩余键的插入序（对齐 TS 对象 delete 后的键序）
    if mgr.config_mut_for_test().groups.shift_remove(id).is_none() {
        return Err(CoreError::NotFound(format!("Group \"{id}\" not found")));
    }
    if mgr.config().active_group.as_deref() == Some(id) {
        // 回退到剩余第一个（IndexMap 插入序首个，确定性）；无剩余则移除字段（序列化时省略，与 TS 一致）
        let fallback = mgr.config().groups.keys().next().cloned();
        mgr.config_mut_for_test().active_group = fallback;
    }
    mgr.mark_dirty();
    mgr.save()
}

pub fn set_default(mgr: &mut ConfigManager, id: &str) -> Result<(), CoreError> {
    if !mgr.config().groups.contains_key(id) {
        return Err(CoreError::NotFound(format!("Group \"{id}\" not found")));
    }
    // TS groups/manager.ts:72-79 —— 只刷新目标 group 的 updatedAt，
    // 其余 group 仅就地置 is_default=false
    for g in mgr.config_mut_for_test().groups.values_mut() {
        if g.id == id {
            g.is_default = true;
            g.updated_at = now_iso();
        } else {
            g.is_default = false;
        }
    }
    mgr.mark_dirty();
    mgr.save()
}

/// TS: groups/manager.ts setActiveGroup —— 设置 activeGroup（Web UI PUT /:id/active 用）
pub fn set_active(mgr: &mut ConfigManager, id: &str) -> Result<(), CoreError> {
    if !mgr.config().groups.contains_key(id) {
        return Err(CoreError::NotFound(format!("Group \"{id}\" not found")));
    }
    mgr.config_mut_for_test().active_group = Some(id.to_string());
    mgr.mark_dirty();
    mgr.save()
}

/// TS: groups/manager.ts getGroup —— id 或 name 均可命中
pub fn find_by_id_or_name(mgr: &ConfigManager, id_or_name: &str) -> Option<Group> {
    if let Some(g) = mgr.config().groups.get(id_or_name) {
        return Some(g.clone());
    }
    find_by_name(mgr, id_or_name)
}

pub fn find_by_name(mgr: &ConfigManager, name: &str) -> Option<Group> {
    mgr.config()
        .groups
        .values()
        .find(|g| g.name == name)
        .cloned()
}

#[cfg(test)]
mod tests {
    use crate::config::ConfigManager;
    use crate::types::Profile;

    fn mgr_with_profiles() -> (tempfile::TempDir, ConfigManager) {
        let dir = tempfile::tempdir().unwrap();
        let mut m = ConfigManager::load_from(dir.path().join("config.json"));
        for n in ["p1", "p2", "p3"] {
            m.upsert_profile(
                Profile {
                    name: n.into(),
                    provider_id: "ollama".into(),
                    api_key: "k".into(),
                    created_at: "t".into(),
                    updated_at: "t".into(),
                    ..Default::default()
                },
                None,
            )
            .unwrap();
        }
        (dir, m)
    }

    #[test]
    fn first_group_becomes_active() {
        let (_d, mut m) = mgr_with_profiles();
        let g = crate::groups::create(&mut m, "main", vec!["p1".into(), "p2".into()]).unwrap();
        assert!(g.id.starts_with("grp_"));
        assert_eq!(m.config().active_group.as_deref(), Some(g.id.as_str()));
        assert!(!g.is_default);
    }

    #[test]
    fn create_rejects_unknown_profile() {
        let (_d, mut m) = mgr_with_profiles();
        assert!(matches!(
            crate::groups::create(&mut m, "gx", vec!["nope".into()]),
            Err(crate::CoreError::NotFound(_))
        ));
    }

    #[test]
    fn create_rejects_duplicate_name() {
        let (_d, mut m) = mgr_with_profiles();
        crate::groups::create(&mut m, "main", vec!["p1".into()]).unwrap();
        let err = crate::groups::create(&mut m, "main", vec!["p2".into()]).unwrap_err();
        match err {
            crate::CoreError::Validation(msg) => {
                assert_eq!(msg, "Group \"main\" already exists");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
    }

    #[test]
    fn create_and_update_reject_duplicate_profiles() {
        let (_d, mut m) = mgr_with_profiles();
        // create
        let err = crate::groups::create(&mut m, "dup", vec!["p1".into(), "p1".into()]).unwrap_err();
        match err {
            crate::CoreError::Validation(msg) => {
                assert_eq!(msg, "Duplicate profiles are not allowed: p1");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        // update
        let g = crate::groups::create(&mut m, "ok", vec!["p1".into()]).unwrap();
        let err = crate::groups::update(
            &mut m,
            &g.id,
            None,
            Some(vec!["p2".into(), "p3".into(), "p2".into()]),
        )
        .unwrap_err();
        match err {
            crate::CoreError::Validation(msg) => {
                assert_eq!(msg, "Duplicate profiles are not allowed: p2");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        // 校验失败不得落盘
        assert_eq!(m.config().groups[&g.id].profiles, vec!["p1"]);
    }

    #[test]
    fn create_and_update_reject_blank_name() {
        let (_d, mut m) = mgr_with_profiles();
        // create
        let err = crate::groups::create(&mut m, "   ", vec!["p1".into()]).unwrap_err();
        match err {
            crate::CoreError::Validation(msg) => {
                assert_eq!(msg, "Profile name cannot be empty");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        assert!(m.config().groups.is_empty());
        // update
        let g = crate::groups::create(&mut m, "keep", vec!["p1".into()]).unwrap();
        let err = crate::groups::update(&mut m, &g.id, Some("  "), None).unwrap_err();
        match err {
            crate::CoreError::Validation(msg) => {
                assert_eq!(msg, "Profile name cannot be empty");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        assert_eq!(m.config().groups[&g.id].name, "keep");
    }

    #[test]
    fn create_and_update_trim_name() {
        // TS validateGroupNameOrExit 返回 trim 后的名字，以其存储
        let (_d, mut m) = mgr_with_profiles();
        let g = crate::groups::create(&mut m, "  main  ", vec!["p1".into()]).unwrap();
        assert_eq!(g.name, "main");
        assert_eq!(m.config().groups[&g.id].name, "main");
        let g = crate::groups::update(&mut m, &g.id, Some("  renamed "), None).unwrap();
        assert_eq!(g.name, "renamed");
        assert_eq!(m.config().groups[&g.id].name, "renamed");
    }

    #[test]
    fn create_rejects_short_and_invalid_char_names() {
        // TS VALIDATION_RULES：最小长度 2，字符集 ^[a-zA-Z0-9_-]+$
        let (_d, mut m) = mgr_with_profiles();
        let err = crate::groups::create(&mut m, "x", vec!["p1".into()]).unwrap_err();
        match err {
            crate::CoreError::Validation(msg) => {
                assert_eq!(msg, "Profile name must be at least 2 characters");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        for bad in ["has space", "中文名", "a.b", "a/b"] {
            let err = crate::groups::create(&mut m, bad, vec!["p1".into()]).unwrap_err();
            match err {
                crate::CoreError::Validation(msg) => {
                    assert_eq!(
                        msg,
                        "Can only contain letters, numbers, underscores and hyphens"
                    );
                }
                other => panic!("expected Validation, got {other:?}"),
            }
        }
        assert!(m.config().groups.is_empty()); // 校验失败不得落盘
                                               // 合法字符集：字母/数字/下划线/连字符
        crate::groups::create(&mut m, "ok_name-1", vec!["p1".into()]).unwrap();
    }

    #[test]
    fn update_rejects_duplicate_name_excluding_self() {
        // TS validateGroupNameOrExit(name, currentGroupName)：排除自身后重名拒绝
        let (_d, mut m) = mgr_with_profiles();
        let g1 = crate::groups::create(&mut m, "ga", vec!["p1".into()]).unwrap();
        crate::groups::create(&mut m, "gb", vec!["p2".into()]).unwrap();
        // 改名为其他组名 → 拒绝
        let err = crate::groups::update(&mut m, &g1.id, Some("gb"), None).unwrap_err();
        match err {
            crate::CoreError::Validation(msg) => {
                assert_eq!(msg, "Group \"gb\" already exists");
            }
            other => panic!("expected Validation, got {other:?}"),
        }
        assert_eq!(m.config().groups[&g1.id].name, "ga"); // 未落盘
                                                          // 改名为自身（含 trim 后相同）→ 放行
        crate::groups::update(&mut m, &g1.id, Some("ga"), None).unwrap();
        crate::groups::update(&mut m, &g1.id, Some(" ga "), None).unwrap();
    }

    #[test]
    fn set_default_is_exclusive() {
        let (_d, mut m) = mgr_with_profiles();
        let g1 = crate::groups::create(&mut m, "ga", vec!["p1".into()]).unwrap();
        let g2 = crate::groups::create(&mut m, "gb", vec!["p2".into()]).unwrap();
        crate::groups::set_default(&mut m, &g1.id).unwrap();
        // 哨兵值：若第二次 set_default 误刷新非目标 group 的 updated_at，哨兵会被覆盖
        m.config_mut_for_test()
            .groups
            .get_mut(&g1.id)
            .unwrap()
            .updated_at = "sentinel".into();
        crate::groups::set_default(&mut m, &g2.id).unwrap();
        assert!(!m.config().groups[&g1.id].is_default);
        assert!(m.config().groups[&g2.id].is_default);
        // 只对目标 group 刷新 updated_at；其余仅就地置 is_default=false
        assert_eq!(m.config().groups[&g1.id].updated_at, "sentinel");
    }

    #[test]
    fn delete_active_group_falls_back() {
        let (_d, mut m) = mgr_with_profiles();
        let g1 = crate::groups::create(&mut m, "ga", vec!["p1".into()]).unwrap();
        let g2 = crate::groups::create(&mut m, "gb", vec!["p2".into()]).unwrap();
        assert_eq!(m.config().active_group.as_deref(), Some(g1.id.as_str()));
        crate::groups::delete(&mut m, &g1.id).unwrap();
        assert!(m.config().active_group.is_some()); // 回退到剩余第一个
        crate::groups::delete(&mut m, &g2.id).unwrap();
        assert!(m.config().active_group.is_none()); // 无剩余则移除字段
    }
}
