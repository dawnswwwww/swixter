use crate::cli::{ProviderAddArgs, ProvidersArgs, ProvidersCommand};
use crate::{EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use swixter_core::presets;
use swixter_core::types::{AuthType, ProviderPreset};
use swixter_core::user_providers;

pub fn dispatch(args: ProvidersArgs) -> i32 {
    match args.command {
        None | Some(ProvidersCommand::List) => list(),
        Some(ProvidersCommand::Add(a)) => add(a),
        Some(ProvidersCommand::Remove { id, quiet }) => remove(id, quiet),
        Some(ProvidersCommand::Show { id }) => show(&id),
    }
}

fn list() -> i32 {
    println!("Built-in providers:");
    for p in presets::builtin_presets() {
        println!("  {} — {}", p.id, p.display_name);
    }
    let user = user_providers::load();
    if !user.is_empty() {
        println!("User-defined providers:");
        for p in &user {
            println!("  {} — {}", p.id, p.display_name);
        }
    }
    EXIT_SUCCESS
}

fn add(a: ProviderAddArgs) -> i32 {
    if !a.quiet {
        eprintln!("Interactive provider add is not supported yet; use --quiet with flags.");
        return EXIT_INVALID_ARG;
    }
    let (id, name, display, base_url) = match (a.id, a.name, a.display_name, a.base_url) {
        (Some(i), Some(n), Some(d), Some(u)) => (i, n, d, u),
        _ => {
            eprintln!("✗ --id --name --display-name --base-url are required with --quiet");
            return EXIT_INVALID_ARG;
        }
    };
    if !id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        || id.is_empty()
    {
        eprintln!("✗ Invalid provider id ([a-z0-9-] only)");
        return EXIT_INVALID_ARG;
    }
    if presets::find_builtin(&id).is_some() {
        eprintln!("⚠ Overriding built-in provider \"{id}\"");
    }
    let auth_type = match a.auth_type.as_deref().unwrap_or("api-key") {
        "api-key" => AuthType::ApiKey,
        "bearer" => AuthType::Bearer,
        "custom" => AuthType::Custom,
        other => {
            eprintln!("✗ Invalid --auth-type: {other}");
            return EXIT_INVALID_ARG;
        }
    };
    let models = a
        .models
        .map(|m| {
            m.split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let preset = ProviderPreset {
        id: id.clone(),
        name,
        display_name: display,
        base_url,
        default_models: models,
        auth_type,
        ..Default::default()
    };
    match user_providers::add(preset) {
        Ok(()) => {
            println!("✓ Provider \"{id}\" added");
            EXIT_SUCCESS
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}

fn remove(id: Option<String>, quiet: bool) -> i32 {
    let id = match id {
        Some(i) => i,
        None => {
            let user = user_providers::load();
            if user.is_empty() {
                println!("No user-defined providers.");
                return EXIT_SUCCESS;
            }
            let items: Vec<&str> = user.iter().map(|p| p.id.as_str()).collect();
            match dialoguer::Select::new()
                .with_prompt("Remove which provider?")
                .items(&items)
                .interact()
            {
                Ok(i) => user[i].id.clone(),
                // TS: 交互选择 cancel → exit 0
                Err(_) => return EXIT_SUCCESS,
            }
        }
    };
    if !quiet {
        let ok = dialoguer::Confirm::new()
            .with_prompt(format!("Remove provider \"{id}\"?"))
            .default(false)
            .interact()
            .unwrap_or(false);
        if !ok {
            return EXIT_SUCCESS;
        }
    }
    match user_providers::remove(&id) {
        Ok(true) => {
            println!("✓ Provider \"{id}\" removed");
            EXIT_SUCCESS
        }
        Ok(false) => {
            eprintln!("✗ Provider \"{id}\" not found");
            EXIT_NOT_FOUND
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}

fn show(id: &str) -> i32 {
    match presets::find_provider(id) {
        Some(p) => {
            println!("{} — {}", p.id, p.display_name);
            println!("  baseURL: {}", p.base_url);
            if let Some(c) = &p.base_url_chat {
                println!("  baseURLChat: {c}");
            }
            println!("  authType: {:?}", p.auth_type);
            if !p.default_models.is_empty() {
                println!("  models: {}", p.default_models.join(", "));
            }
            if let Some(k) = &p.env_key {
                println!("  env_key: {k}");
            }
            EXIT_SUCCESS
        }
        None => {
            eprintln!("✗ Provider \"{id}\" not found");
            EXIT_NOT_FOUND
        }
    }
}
