use crate::cli::{CoderArgs, CoderCommand, CreateArgs};
use crate::{EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use swixter_core::adapters::get_adapter;
use swixter_core::coder::{get_coder, CoderSpec};
use swixter_core::config::ConfigManager;
use swixter_core::presets;
use swixter_core::types::{now_iso, ApiFormat, ModelsConfig, Profile};

pub fn dispatch(coder_id: &str, args: CoderArgs) -> i32 {
    let coder = match get_coder(coder_id) {
        Some(c) => c,
        None => {
            eprintln!("Unknown coder: {coder_id}");
            return EXIT_INVALID_ARG;
        }
    };
    match args.command {
        None => crate::commands::interactive::main_menu(coder), // Task 14
        Some(CoderCommand::Create(a)) => cmd_create(coder, a),
        Some(CoderCommand::List) => cmd_list(coder),
        Some(CoderCommand::Switch {
            name,
            apply,
            no_apply,
        }) => cmd_switch(coder, &name, apply, no_apply),
        Some(CoderCommand::Edit { name }) => crate::commands::interactive::edit_wizard(coder, name),
        Some(CoderCommand::Delete { name }) => cmd_delete(coder, &name),
        Some(CoderCommand::Apply) => match apply_active(coder) {
            Ok(()) => {
                println!("✓ Applied to {}", coder.display_name);
                EXIT_SUCCESS
            }
            Err(e) => {
                eprintln!("✗ {e}");
                EXIT_GENERAL
            }
        },
        Some(CoderCommand::Current) => cmd_current(coder),
        Some(CoderCommand::Run(a)) => crate::commands::run::run(coder, a), // Task 12
        Some(CoderCommand::Install { method, force }) => {
            crate::commands::install::install(coder, method, force)
        } // Task 13
        Some(CoderCommand::UpdateCli) => crate::commands::install::update(coder),
    }
}

fn valid_profile_name(name: &str) -> bool {
    name.len() >= 2
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn parse_api_format(s: &str) -> Result<ApiFormat, String> {
    match s {
        "openai_chat" => Ok(ApiFormat::OpenaiChat),
        "anthropic_messages" => Ok(ApiFormat::AnthropicMessages),
        "openai_responses" => Ok(ApiFormat::OpenaiResponses),
        "anthropic_responses" => Ok(ApiFormat::AnthropicResponses),
        "gemini_native" => Ok(ApiFormat::GeminiNative),
        other => Err(format!("Invalid --api-format: {other} (valid: openai_chat, anthropic_messages, openai_responses, anthropic_responses, gemini_native)")),
    }
}

/// quiet 模式创建；返回构建好的 Profile（尚未入库）。
/// 校验规则（TS cli/{claude,codex,qwen}.ts）：
/// - 必填 --name --provider（qwen 另需 --model）；name 正则 ^[a-zA-Z0-9_-]+$ 且 ≥2
/// - provider 必须存在（presets::find_provider）
/// - 非 ollama provider 必须 --api-key（codex/qwen；claude 允许空）
/// - qwen 拒绝 provider=anthropic；qwen 同时写 model 和 openaiModel
pub fn create_quiet(coder: &CoderSpec, a: &CreateArgs) -> Result<Profile, (String, i32)> {
    let name = a.name.clone().ok_or_else(|| {
        (
            "--name is required in --quiet mode".into(),
            EXIT_INVALID_ARG,
        )
    })?;
    if !valid_profile_name(&name) {
        return Err((
            "Invalid profile name (min 2 chars, [a-zA-Z0-9_-])".into(),
            EXIT_INVALID_ARG,
        ));
    }
    let provider_id = a.provider.clone().ok_or_else(|| {
        (
            "--provider is required in --quiet mode".into(),
            EXIT_INVALID_ARG,
        )
    })?;
    // 仅做存在性校验，preset 本体在 apply/run 时才使用
    let _preset = presets::find_provider(&provider_id)
        .ok_or_else(|| (format!("Unknown provider: {provider_id}"), EXIT_GENERAL))?;
    if coder.id == "qwen" && provider_id == "anthropic" {
        return Err((
            "Provider 'anthropic' is not supported for qwen".into(),
            EXIT_INVALID_ARG,
        ));
    }
    let api_key = a.api_key.clone().unwrap_or_default();
    if coder.id != "claude" && provider_id != "ollama" && api_key.is_empty() {
        return Err((
            "--api-key is required for this provider".into(),
            EXIT_INVALID_ARG,
        ));
    }
    if coder.id == "qwen" && a.model.is_none() {
        return Err(("--model is required for qwen".into(), EXIT_INVALID_ARG));
    }
    let api_format = match &a.api_format {
        Some(s) => Some(parse_api_format(s).map_err(|e| (e, EXIT_INVALID_ARG))?),
        None => None,
    };
    let has_models = [
        &a.anthropic_model,
        &a.default_haiku_model,
        &a.default_opus_model,
        &a.default_sonnet_model,
    ]
    .iter()
    .any(|m| m.is_some());
    let now = now_iso();
    Ok(Profile {
        name,
        provider_id,
        api_key,
        auth_token: a.auth_token.clone().filter(|s| !s.is_empty()),
        base_url: a.base_url.clone().filter(|s| !s.is_empty()),
        model: a.model.clone(),
        openai_model: if coder.id == "qwen" {
            a.model.clone()
        } else {
            None
        },
        models: if has_models {
            Some(ModelsConfig {
                anthropic_model: a.anthropic_model.clone(),
                default_haiku_model: a.default_haiku_model.clone(),
                default_opus_model: a.default_opus_model.clone(),
                default_sonnet_model: a.default_sonnet_model.clone(),
            })
        } else {
            None
        },
        env_key: a.env_key.clone().filter(|s| !s.is_empty()),
        headers: None,
        api_format,
        created_at: now.clone(),
        updated_at: now,
    })
}

fn cmd_create(coder: &CoderSpec, a: CreateArgs) -> i32 {
    if !a.quiet {
        return crate::commands::interactive::create_wizard(coder, a); // Task 14
    }
    match create_quiet(coder, &a) {
        Ok(profile) => {
            let mut mgr = ConfigManager::load();
            if let Err(e) = mgr.upsert_profile(profile.clone(), Some(coder.id)) {
                eprintln!("✗ {e}");
                return EXIT_GENERAL;
            }
            println!("✓ Profile \"{}\" created", profile.name);
            if a.apply {
                match apply_active(coder) {
                    Ok(()) => println!("✓ Applied to {}", coder.display_name),
                    Err(e) => {
                        eprintln!("✗ {e}");
                        return EXIT_GENERAL;
                    }
                }
            }
            EXIT_SUCCESS
        }
        Err((msg, code)) => {
            eprintln!("✗ {msg}");
            code
        }
    }
}

fn cmd_list(coder: &CoderSpec) -> i32 {
    let mgr = ConfigManager::load();
    let active = mgr
        .config()
        .coders
        .get(coder.id)
        .map(|c| c.active_profile.as_str())
        .unwrap_or("");
    if mgr.config().profiles.is_empty() {
        println!("No profiles. Create one with: swixter {} create", coder.id);
        return EXIT_SUCCESS;
    }
    for (name, p) in &mgr.config().profiles {
        let marker = if name == active { "●" } else { " " };
        let model = swixter_core::model::get_openai_model(p)
            .or(p.models.as_ref().and_then(|m| m.anthropic_model.as_deref()))
            .unwrap_or("-");
        println!("{marker} {name}  ({}, model: {model})", p.provider_id);
    }
    EXIT_SUCCESS
}

fn cmd_current(coder: &CoderSpec) -> i32 {
    let mgr = ConfigManager::load();
    match mgr.active_profile(coder.id) {
        Some(p) => {
            println!("{} ({})", p.name, p.provider_id);
            EXIT_SUCCESS
        }
        None => {
            println!("No active profile for {}", coder.display_name);
            EXIT_SUCCESS
        }
    }
}

fn cmd_switch(coder: &CoderSpec, name: &str, apply: bool, no_apply: bool) -> i32 {
    let mut mgr = ConfigManager::load();
    match mgr.set_active_profile(coder.id, name) {
        Ok(()) => println!("✓ Switched to \"{name}\""),
        Err(swixter_core::CoreError::NotFound(e)) => {
            eprintln!("✗ {e}");
            return EXIT_NOT_FOUND;
        }
        Err(e) => {
            eprintln!("✗ {e}");
            return EXIT_GENERAL;
        }
    }
    handle_apply_prompt(coder, apply, no_apply)
}

/// TS: utils/commands.ts handleApplyPrompt 三模式
pub fn handle_apply_prompt(coder: &CoderSpec, apply: bool, no_apply: bool) -> i32 {
    if apply {
        return match apply_active(coder) {
            Ok(()) => {
                println!("✓ Applied to {}", coder.display_name);
                EXIT_SUCCESS
            }
            Err(e) => {
                eprintln!("✗ {e}");
                EXIT_GENERAL
            }
        };
    }
    if no_apply || !is_tty() {
        println!(
            "Tip: Run 'swixter {} apply' to apply profile to {}",
            coder.id, coder.display_name
        );
        return EXIT_SUCCESS;
    }
    match dialoguer::Confirm::new()
        .with_prompt(format!("Apply this profile to {} now?", coder.display_name))
        .default(true)
        .interact()
    {
        Ok(true) => match apply_active(coder) {
            Ok(()) => {
                println!("✓ Applied to {}", coder.display_name);
                EXIT_SUCCESS
            }
            Err(e) => {
                eprintln!("✗ {e}");
                EXIT_GENERAL
            }
        },
        Ok(false) => {
            println!(
                "Tip: Run 'swixter {} apply' to apply profile to {}",
                coder.id, coder.display_name
            );
            EXIT_SUCCESS
        }
        Err(_) => EXIT_SUCCESS, // TS: cancel 时优雅返回
    }
}

pub fn is_tty() -> bool {
    // 简单判定：stdin 是终端。用 std::io::IsTerminal（Rust 1.70+）。
    std::io::IsTerminal::is_terminal(&std::io::stdin())
}

pub fn apply_active(coder: &CoderSpec) -> Result<(), String> {
    let mgr = ConfigManager::load();
    let profile = mgr
        .active_profile(coder.id)
        .ok_or_else(|| format!("No active profile for {}", coder.display_name))?;
    let preset = presets::find_provider(&profile.provider_id);
    let adapter = get_adapter(coder.adapter);
    adapter
        .apply(profile, preset.as_ref())
        .map_err(|e| e.to_string())?;
    if !adapter.verify(profile, preset.as_ref()) {
        return Err(format!("Verification failed for {}", coder.display_name));
    }
    Ok(())
}

fn cmd_delete(_coder: &CoderSpec, name: &str) -> i32 {
    // TS: deleteProfile 先对所有 coder 做 adapter 清理（失败仅 warn），再删配置
    for c in swixter_core::coder::CODERS {
        let adapter = get_adapter(c.adapter);
        if let Err(e) = adapter.remove(name) {
            eprintln!(
                "Warning: failed to cleanup {} adapter configuration: {e}",
                c.id
            );
        }
    }
    let mut mgr = ConfigManager::load();
    match mgr.delete_profile(name) {
        Ok(()) => {
            println!("✓ Profile \"{name}\" deleted");
            EXIT_SUCCESS
        }
        Err(swixter_core::CoreError::NotFound(e)) => {
            eprintln!("✗ {e}");
            EXIT_NOT_FOUND
        }
        Err(swixter_core::CoreError::InUse(e)) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
        Err(e) => {
            eprintln!("✗ {e}");
            EXIT_GENERAL
        }
    }
}
