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
        Some(GroupCommand::Create { name, profiles }) => create(name, profiles),
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
        let ok = dialoguer::Confirm::new()
            .with_prompt(format!("Delete group \"{name}\"?"))
            .default(false)
            .interact()
            .unwrap_or(false);
        if !ok {
            // TS: 确认框 cancel → exit 130
            return EXIT_CANCELLED;
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
