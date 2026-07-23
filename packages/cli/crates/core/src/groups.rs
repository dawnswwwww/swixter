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

pub fn create(
    mgr: &mut ConfigManager,
    name: &str,
    profiles: Vec<String>,
) -> Result<Group, CoreError> {
    if profiles.is_empty() {
        return Err(CoreError::Validation(
            "group must contain at least one profile".into(),
        ));
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
    if let Some(ps) = &profiles {
        if ps.is_empty() {
            return Err(CoreError::Validation(
                "group must contain at least one profile".into(),
            ));
        }
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
        g.name = n.to_string();
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
    if mgr.config_mut_for_test().groups.remove(id).is_none() {
        return Err(CoreError::NotFound(format!("Group \"{id}\" not found")));
    }
    if mgr.config().active_group.as_deref() == Some(id) {
        // 回退到剩余第一个；无剩余则移除字段（序列化时省略，与 TS 一致）
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
    for g in mgr.config_mut_for_test().groups.values_mut() {
        g.is_default = g.id == id;
        g.updated_at = now_iso();
    }
    mgr.mark_dirty();
    mgr.save()
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
            crate::groups::create(&mut m, "x", vec!["nope".into()]),
            Err(crate::CoreError::NotFound(_))
        ));
    }

    #[test]
    fn set_default_is_exclusive() {
        let (_d, mut m) = mgr_with_profiles();
        let g1 = crate::groups::create(&mut m, "a", vec!["p1".into()]).unwrap();
        let g2 = crate::groups::create(&mut m, "b", vec!["p2".into()]).unwrap();
        crate::groups::set_default(&mut m, &g1.id).unwrap();
        crate::groups::set_default(&mut m, &g2.id).unwrap();
        assert!(!m.config().groups[&g1.id].is_default);
        assert!(m.config().groups[&g2.id].is_default);
    }

    #[test]
    fn delete_active_group_falls_back() {
        let (_d, mut m) = mgr_with_profiles();
        let g1 = crate::groups::create(&mut m, "a", vec!["p1".into()]).unwrap();
        let g2 = crate::groups::create(&mut m, "b", vec!["p2".into()]).unwrap();
        assert_eq!(m.config().active_group.as_deref(), Some(g1.id.as_str()));
        crate::groups::delete(&mut m, &g1.id).unwrap();
        assert!(m.config().active_group.is_some()); // 回退到剩余第一个
        crate::groups::delete(&mut m, &g2.id).unwrap();
        assert!(m.config().active_group.is_none()); // 无剩余则移除字段
    }
}
