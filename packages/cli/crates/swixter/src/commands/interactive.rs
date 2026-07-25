use crate::cli::CreateArgs;
use crate::commands::coder::{apply_active, create_quiet};
use crate::{EXIT_CANCELLED, EXIT_GENERAL, EXIT_SUCCESS};
use dialoguer::{Confirm, Input, Select};
use swixter_core::coder::CoderSpec;
use swixter_core::config::ConfigManager;
use swixter_core::presets;
use swixter_core::types::Profile;

const MENU: &[(&str, &str)] = &[
    ("run", "Run"),
    ("create", "Create profile"),
    ("list", "List profiles"),
    ("switch", "Switch profile"),
    ("edit", "Edit profile"),
    ("apply", "Apply profile"),
    ("current", "Show current profile"),
    ("delete", "Delete profile"),
    ("install", "Install CLI"),
    ("update-cli", "Update CLI"),
    ("exit", "Exit"),
];

pub fn main_menu(coder: &CoderSpec) -> i32 {
    // TS cli/claude.ts:1018-1052 —— 执行一个子命令后即返回（exit 子命令的码），不循环
    let items: Vec<&str> = MENU.iter().map(|(_, label)| *label).collect();
    let sel = match Select::new()
        .with_prompt(format!(
            "{} — what would you like to do?",
            coder.display_name
        ))
        .items(&items)
        .interact()
    {
        Ok(i) => i,
        Err(_) => return EXIT_CANCELLED,
    };
    let (cmd, _) = MENU[sel];
    match cmd {
        "run" => crate::commands::run::run(
            coder,
            crate::cli::RunArgs {
                profile: None,
                yolo: false,
                args: vec![],
            },
        ),
        "create" => create_wizard(
            coder,
            CreateArgs {
                name: None,
                provider: None,
                api_key: None,
                auth_token: None,
                base_url: None,
                model: None,
                env_key: None,
                anthropic_model: None,
                default_haiku_model: None,
                default_opus_model: None,
                default_sonnet_model: None,
                api_format: None,
                quiet: false,
                apply: false,
            },
        ),
        "list" => crate::commands::coder::dispatch(
            coder.id,
            crate::cli::CoderArgs {
                command: Some(crate::cli::CoderCommand::List),
            },
        ),
        "switch" => match pick_profile(&ConfigManager::load(), "Switch to which profile?") {
            Some(name) => crate::commands::coder::dispatch(
                coder.id,
                crate::cli::CoderArgs {
                    command: Some(crate::cli::CoderCommand::Switch {
                        name,
                        apply: false,
                        no_apply: false,
                    }),
                },
            ),
            None => EXIT_CANCELLED,
        },
        "edit" => edit_wizard(coder, None),
        "apply" => match apply_active(coder) {
            Ok(()) => {
                println!("✓ Applied to {}", coder.display_name);
                EXIT_SUCCESS
            }
            Err(e) => {
                eprintln!("✗ {e}");
                EXIT_GENERAL
            }
        },
        "current" => crate::commands::coder::dispatch(
            coder.id,
            crate::cli::CoderArgs {
                command: Some(crate::cli::CoderCommand::Current),
            },
        ),
        "delete" => match pick_profile(&ConfigManager::load(), "Delete which profile?") {
            Some(name) => {
                let ok = Confirm::new()
                    .with_prompt(format!("Delete profile \"{name}\"?"))
                    .default(false)
                    .interact()
                    .unwrap_or(false);
                if ok {
                    crate::commands::coder::dispatch(
                        coder.id,
                        crate::cli::CoderArgs {
                            command: Some(crate::cli::CoderCommand::Delete { name }),
                        },
                    )
                } else {
                    EXIT_SUCCESS
                }
            }
            None => EXIT_CANCELLED,
        },
        "install" => crate::commands::install::install(coder, None, false),
        "update-cli" => crate::commands::install::update(coder),
        _ => {
            println!("Goodbye!");
            EXIT_CANCELLED
        } // "exit"
    }
}

pub fn pick_profile(mgr: &ConfigManager, prompt: &str) -> Option<String> {
    let names: Vec<&String> = mgr.config().profiles.keys().collect();
    if names.is_empty() {
        println!("No profiles yet. Create one first.");
        return None;
    }
    Select::new()
        .with_prompt(prompt)
        .items(&names.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .interact()
        .ok()
        .map(|i| names[i].clone())
}

pub fn create_wizard(coder: &CoderSpec, _prefill: CreateArgs) -> i32 {
    // 计划代码在返回 i32 的函数里对 Result<_, i32> 闭包用 `?`，无法编译；
    // 拆出返回 Result<i32, i32> 的 inner 函数（Ok/Err 均为退出码），主体保持不变
    match create_wizard_impl(coder) {
        Ok(code) | Err(code) => code,
    }
}

fn create_wizard_impl(coder: &CoderSpec) -> Result<i32, i32> {
    // 各步 cancel → 返回 EXIT_CANCELLED（TS: p.cancel + exit 130）
    let name: String = match Input::new()
        .with_prompt("Profile name")
        .validate_with(|s: &String| {
            if s.len() >= 2
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                Ok(())
            } else {
                Err("Min 2 chars, [a-zA-Z0-9_-] only")
            }
        })
        .interact_text()
    {
        Ok(v) => v,
        Err(_) => return Err(EXIT_CANCELLED),
    };

    let providers = presets::builtin_presets()
        .iter()
        .filter(|p| {
            coder.id != "qwen"
                || (p.wire_api != Some(swixter_core::types::WireApi::Responses)
                    && p.id != "anthropic")
        })
        .map(|p| (p.id.clone(), p.display_name.clone()))
        .chain(
            swixter_core::user_providers::load()
                .into_iter()
                .map(|p| (p.id, p.display_name)),
        )
        .collect::<Vec<_>>();
    let labels: Vec<String> = providers.iter().map(|(_, d)| d.clone()).collect();
    let pi = match Select::new()
        .with_prompt("Provider")
        .items(&labels)
        .interact()
    {
        Ok(i) => i,
        Err(_) => return Err(EXIT_CANCELLED),
    };
    let provider_id = providers[pi].0.clone();
    let preset = presets::find_provider(&provider_id);

    let input_opt = |prompt: &str| -> Result<Option<String>, i32> {
        let v: String = Input::new()
            .with_prompt(prompt)
            .allow_empty(true)
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)?;
        Ok(if v.is_empty() { None } else { Some(v) })
    };
    let input_req = |prompt: &str| -> Result<String, i32> {
        Input::new()
            .with_prompt(prompt)
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)
    };

    // apiKey 必填只对 codex/qwen 且 provider != ollama 生效；claude 一律可选
    let needs_key = coder.id != "claude" && provider_id != "ollama";
    let api_key = if needs_key {
        input_req("API Key")?
    } else {
        input_opt("API Key (optional)")?.unwrap_or_default()
    };

    let mut args = CreateArgs {
        name: Some(name),
        provider: Some(provider_id),
        api_key: Some(api_key),
        auth_token: None,
        base_url: None,
        model: None,
        env_key: None,
        anthropic_model: None,
        default_haiku_model: None,
        default_opus_model: None,
        default_sonnet_model: None,
        api_format: None,
        quiet: true,
        apply: false,
    };

    match coder.id {
        "claude" => {
            args.auth_token = input_opt("Auth Token (optional)")?;
            args.base_url = input_opt("Base URL (optional)")?;
            if args.provider.as_deref() == Some("custom") {
                let formats = [
                    "openai_chat",
                    "anthropic_messages",
                    "openai_responses",
                    "anthropic_responses",
                    "gemini_native",
                ];
                let fi = Select::new()
                    .with_prompt("API format")
                    .items(&formats)
                    .interact()
                    .map_err(|_| EXIT_CANCELLED)?;
                args.api_format = Some(formats[fi].into());
            }
            let configure_models = Confirm::new()
                .with_prompt("Configure models?")
                .default(false)
                .interact()
                .map_err(|_| EXIT_CANCELLED)?;
            if configure_models {
                args.anthropic_model = input_opt("ANTHROPIC_MODEL (optional)")?;
                args.default_haiku_model = input_opt("Default Haiku model (optional)")?;
                args.default_opus_model = input_opt("Default Opus model (optional)")?;
                args.default_sonnet_model = input_opt("Default Sonnet model (optional)")?;
            }
        }
        "codex" => {
            args.base_url = input_opt("Base URL (optional)")?;
            let mut model_choices: Vec<String> = preset
                .as_ref()
                .map(|p| p.default_models.clone())
                .unwrap_or_default();
            model_choices.push("Custom...".into());
            if !model_choices.is_empty() {
                let mi = Select::new()
                    .with_prompt("Model")
                    .items(&model_choices)
                    .interact()
                    .map_err(|_| EXIT_CANCELLED)?;
                args.model = if model_choices[mi] == "Custom..." {
                    Some(input_req("Model name")?)
                } else {
                    Some(model_choices[mi].clone())
                };
            }
            args.env_key = input_opt("Env key for API key (optional, default OPENAI_API_KEY)")?;
        }
        "qwen" => {
            args.model = Some(input_req("Model")?);
            args.base_url = input_opt("Base URL (optional)")?;
        }
        _ => {}
    }

    let profile = match create_quiet(coder, &args) {
        Ok(p) => p,
        Err((msg, code)) => {
            eprintln!("✗ {msg}");
            return Err(code);
        }
    };
    let mut mgr = ConfigManager::load();
    if let Err(e) = mgr.upsert_profile(profile.clone(), Some(coder.id)) {
        eprintln!("✗ {e}");
        return Err(EXIT_GENERAL);
    }
    println!("✓ Profile \"{}\" created", profile.name);
    let do_apply = Confirm::new()
        .with_prompt(format!("Apply this profile to {} now?", coder.display_name))
        .default(true)
        .interact()
        .map_err(|_| EXIT_CANCELLED)?;
    if do_apply {
        // 同 cmd_create --apply：先显式切换到新 profile 再 apply
        if let Err(e) = mgr.set_active_profile(coder.id, &profile.name) {
            eprintln!("✗ {e}");
            return Err(EXIT_GENERAL);
        }
        match apply_active(coder) {
            Ok(()) => println!("✓ Applied to {}", coder.display_name),
            Err(e) => {
                eprintln!("✗ {e}");
                return Err(EXIT_GENERAL);
            }
        }
    }
    Ok(EXIT_SUCCESS)
}

pub fn edit_wizard(coder: &CoderSpec, name: Option<String>) -> i32 {
    // 同 create_wizard：inner 函数承载 `?`，Ok/Err 均为退出码
    match edit_wizard_impl(coder, name) {
        Ok(code) | Err(code) => code,
    }
}

fn edit_wizard_impl(coder: &CoderSpec, name: Option<String>) -> Result<i32, i32> {
    let mgr = ConfigManager::load();
    let name = match name {
        Some(n) => n,
        None => match pick_profile(&mgr, "Edit which profile?") {
            Some(n) => n,
            None => return Err(EXIT_CANCELLED),
        },
    };
    let profile = match mgr.get_profile(&name) {
        Some(p) => p.clone(),
        None => {
            eprintln!("✗ Profile \"{name}\" does not exist");
            return Err(EXIT_GENERAL);
        }
    };
    let input_default = |prompt: &str, cur: Option<&str>| -> Result<Option<String>, i32> {
        let v: String = Input::new()
            .with_prompt(prompt)
            .default(cur.unwrap_or("").to_string())
            .allow_empty(true)
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)?;
        Ok(if v.is_empty() { None } else { Some(v) })
    };
    let mut p: Profile = profile;
    p.api_key = input_default("API Key", Some(&p.api_key))?.unwrap_or_default();
    p.auth_token = input_default("Auth Token", p.auth_token.as_deref())?;
    p.base_url = input_default("Base URL", p.base_url.as_deref())?;
    if coder.id != "claude" {
        p.model = input_default("Model", p.model.as_deref())?;
    }
    let mut mgr = ConfigManager::load();
    if let Err(e) = mgr.upsert_profile(p.clone(), None) {
        eprintln!("✗ {e}");
        return Err(EXIT_GENERAL);
    }
    println!("✓ Profile \"{}\" updated", p.name);
    // TS: edit 后 apply 确认默认 false
    let do_apply = Confirm::new()
        .with_prompt(format!("Apply to {} now?", coder.display_name))
        .default(false)
        .interact()
        .unwrap_or(false);
    if do_apply {
        match apply_active(coder) {
            Ok(()) => println!("✓ Applied"),
            Err(e) => {
                eprintln!("✗ {e}");
                return Err(EXIT_GENERAL);
            }
        }
    }
    Ok(EXIT_SUCCESS)
}
