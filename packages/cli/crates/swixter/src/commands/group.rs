use crate::cli::{GroupArgs, GroupCommand};
use crate::{EXIT_CANCELLED, EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use swixter_core::config::ConfigManager;
use swixter_core::groups;

pub fn dispatch(args: GroupArgs) -> i32 {
    match args.command {
        None => {
            eprintln!("Usage: swixter group <list|create|edit|delete|set-default|show>");
            EXIT_INVALID_ARG
        }
        Some(GroupCommand::List) => list(),
        Some(GroupCommand::Create {
            name,
            name_flag,
            profiles,
        }) => create(name.or(name_flag), profiles),
        Some(GroupCommand::Edit {
            name,
            new_name,
            profiles,
        }) => edit(name, new_name, profiles),
        Some(GroupCommand::Delete { name, force }) => delete(&name, force),
        Some(GroupCommand::SetDefault { name }) => set_default(&name),
        Some(GroupCommand::Show { name }) => show(&name),
    }
}

fn list() -> i32 {
    let mgr = ConfigManager::load();
    if mgr.config().groups.is_empty() {
        println!("No groups.");
        return EXIT_SUCCESS;
    }
    for g in mgr.config().groups.values() {
        let marker = if g.is_default { "✓" } else { " " };
        println!("{marker} {} ({})", g.name, g.profiles.join(" → "));
    }
    EXIT_SUCCESS
}

fn create(name: Option<String>, profiles: Option<String>) -> i32 {
    let (name, profile_names) = match (name, profiles) {
        (Some(n), Some(ps)) => (
            n,
            ps.split(',')
                .map(|s| s.trim().to_string())
                .collect::<Vec<_>>(),
        ),
        _ => {
            eprintln!(
                "Interactive group creation is not supported yet; pass name and --profiles a,b,c"
            );
            return EXIT_INVALID_ARG;
        }
    };
    let mut mgr = ConfigManager::load();
    match groups::create(&mut mgr, &name, profile_names) {
        Ok(g) => {
            println!("✓ Group \"{}\" created ({})", g.name, g.id);
            EXIT_SUCCESS
        }
        Err(swixter_core::CoreError::NotFound(e)) => {
            eprintln!("✗ {e}");
            EXIT_NOT_FOUND
        }
        Err(swixter_core::CoreError::Validation(e)) => {
            eprintln!("✗ {e}");
            EXIT_INVALID_ARG
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}

fn edit(name: Option<String>, new_name: Option<String>, profiles: Option<String>) -> i32 {
    let name = match name {
        Some(n) => n,
        None => {
            eprintln!("Usage: swixter group edit <name> [--name new] [--profiles a,b,c]");
            return EXIT_INVALID_ARG;
        }
    };
    let mut mgr = ConfigManager::load();
    let group = match groups::find_by_name(&mgr, &name) {
        Some(g) => g,
        None => {
            eprintln!("✗ Group \"{name}\" not found");
            return EXIT_NOT_FOUND;
        }
    };
    let profile_names = profiles.map(|ps| ps.split(',').map(|s| s.trim().to_string()).collect());
    match groups::update(&mut mgr, &group.id, new_name.as_deref(), profile_names) {
        Ok(_) => {
            println!("✓ Group updated");
            EXIT_SUCCESS
        }
        Err(swixter_core::CoreError::NotFound(e)) => {
            eprintln!("✗ {e}");
            EXIT_NOT_FOUND
        }
        Err(swixter_core::CoreError::Validation(e)) => {
            eprintln!("✗ {e}");
            EXIT_INVALID_ARG
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}

fn delete(name: &str, force: bool) -> i32 {
    let mut mgr = ConfigManager::load();
    let group = match groups::find_by_name(&mgr, name) {
        Some(g) => g,
        None => {
            eprintln!("✗ Group \"{name}\" not found");
            return EXIT_NOT_FOUND;
        }
    };
    if !force {
        let confirm = dialoguer::Confirm::with_theme(&crate::theme::swixter_theme())
            .with_prompt(format!("Delete group \"{name}\"?"))
            .default(false)
            .interact();
        match delete_confirm_action(confirm) {
            DeleteConfirm::Delete => {}
            // TS: 选 No → 静默 exit 0（不删除）
            DeleteConfirm::Declined => return EXIT_SUCCESS,
            // TS: Esc/Ctrl+C（含非 TTY 无法交互）→ exit 130
            DeleteConfirm::Cancelled => return EXIT_CANCELLED,
        }
    }
    match groups::delete(&mut mgr, &group.id) {
        Ok(()) => {
            println!("✓ Group \"{name}\" deleted");
            EXIT_SUCCESS
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}

/// TS cmdDelete 确认框三态（纯函数便于单测）：
/// Yes → 删除；No → 静默 exit 0；取消（Esc/Ctrl+C/非 TTY）→ exit 130
#[derive(Debug, PartialEq, Eq)]
enum DeleteConfirm {
    Delete,
    Declined,
    Cancelled,
}

fn delete_confirm_action(r: Result<bool, dialoguer::Error>) -> DeleteConfirm {
    match r {
        Ok(true) => DeleteConfirm::Delete,
        Ok(false) => DeleteConfirm::Declined,
        Err(_) => DeleteConfirm::Cancelled,
    }
}

fn set_default(name: &str) -> i32 {
    let mut mgr = ConfigManager::load();
    let group = match groups::find_by_name(&mgr, name) {
        Some(g) => g,
        None => {
            eprintln!("✗ Group \"{name}\" not found");
            return EXIT_NOT_FOUND;
        }
    };
    match groups::set_default(&mut mgr, &group.id) {
        Ok(()) => {
            println!("✓ Group \"{name}\" set as default");
            EXIT_SUCCESS
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}

fn show(name: &str) -> i32 {
    let mgr = ConfigManager::load();
    match groups::find_by_name(&mgr, name) {
        Some(g) => {
            println!("{} ({})", g.name, g.id);
            println!("  default: {}", g.is_default);
            println!("  profiles: {}", g.profiles.join(" → "));
            EXIT_SUCCESS
        }
        None => {
            eprintln!("✗ Group \"{name}\" not found");
            EXIT_NOT_FOUND
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delete_confirm_three_way() {
        // Yes → 删除
        assert_eq!(delete_confirm_action(Ok(true)), DeleteConfirm::Delete);
        // No → 静默 exit 0（TS 对齐：此前被错当成 cancel 返回 130）
        assert_eq!(delete_confirm_action(Ok(false)), DeleteConfirm::Declined);
        // Esc/Ctrl+C/非 TTY → exit 130
        let err = dialoguer::Error::IO(std::io::Error::other("not a terminal"));
        assert_eq!(delete_confirm_action(Err(err)), DeleteConfirm::Cancelled);
    }
}
