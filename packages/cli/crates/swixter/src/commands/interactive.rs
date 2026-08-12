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
    crate::theme::print_header(&format!("Swixter — {}", coder.display_name));
    let items: Vec<&str> = MENU.iter().map(|(_, label)| *label).collect();
    let sel = match Select::with_theme(&crate::theme::swixter_theme())
        .with_prompt(format!(
            "{} — what would you like to do?",
            coder.display_name
        ))
        .items(&items)
        .default(0)
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
                let ok = Confirm::with_theme(&crate::theme::swixter_theme())
                    .with_prompt(format!("Delete profile \"{name}\"?"))
                    .default(false)
                    .interact()
                    .unwrap_or(false);
                if ok {
                    crate::commands::coder::dispatch(
                        coder.id,
                        crate::cli::CoderArgs {
                            command: Some(crate::cli::CoderCommand::Delete { name, force: false }),
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

/// TS: `apiKey.slice(0, 10) + "..."` 掩码。按字符取前 10 个，避免多字节字符按字节切片 panic
fn mask_secret(s: &str) -> String {
    format!("{}...", s.chars().take(10).collect::<String>())
}

/// TS ProfileValidators.url：空（可选）放行；非空必须能解析为 URL（对齐 `new URL()` 规则）
fn validate_url(s: &str) -> Result<(), &'static str> {
    if s.trim().is_empty() || url::Url::parse(s).is_ok() {
        Ok(())
    } else {
        Err("Invalid URL format")
    }
}

/// 合并内置与用户 provider 列表（TS getAllPresets 语义，纯函数便于单测）：
/// user 按 id 覆盖 builtin——不去重的话同 id 出现两条，选 builtin 条目实际解析到用户覆盖版
fn merge_providers(
    builtin: Vec<(String, String)>,
    user: Vec<(String, String)>,
) -> Vec<(String, String)> {
    // 拥有所有权的 id 集合，避免借用与 chain(user) 的移动冲突
    let overridden: std::collections::HashSet<String> =
        user.iter().map(|(id, _)| id.clone()).collect();
    builtin
        .into_iter()
        .filter(|(id, _)| !overridden.contains(id))
        .chain(user)
        .collect()
}

pub fn pick_profile(mgr: &ConfigManager, prompt: &str) -> Option<String> {
    let names: Vec<&String> = mgr.config().profiles.keys().collect();
    if names.is_empty() {
        println!("No profiles yet. Create one first.");
        return None;
    }
    Select::with_theme(&crate::theme::swixter_theme())
        .with_prompt(prompt)
        .items(&names.iter().map(|s| s.as_str()).collect::<Vec<_>>())
        .default(0)
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
    crate::theme::print_header(&format!(
        "Create {} Configuration Profile",
        coder.display_name
    ));
    let name: String = match Input::with_theme(&crate::theme::swixter_theme())
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
    crate::theme::print_rail();

    let user_providers = swixter_core::user_providers::load();
    let providers = merge_providers(
        presets::builtin_presets()
            .iter()
            .filter(|p| {
                coder.id != "qwen"
                    || (p.wire_api != Some(swixter_core::types::WireApi::Responses)
                        && p.id != "anthropic")
            })
            .map(|p| (p.id.clone(), p.display_name.clone()))
            .collect(),
        user_providers
            .into_iter()
            .map(|p| (p.id, p.display_name))
            .collect(),
    );
    let labels: Vec<String> = providers.iter().map(|(_, d)| d.clone()).collect();
    let pi = match Select::with_theme(&crate::theme::swixter_theme())
        .with_prompt("Provider")
        .items(&labels)
        .default(0)
        .interact()
    {
        Ok(i) => i,
        Err(_) => return Err(EXIT_CANCELLED),
    };
    let provider_id = providers[pi].0.clone();
    let preset = presets::find_provider(&provider_id);
    crate::theme::print_rail();

    let input_opt = |prompt: &str| -> Result<Option<String>, i32> {
        let v: String = Input::with_theme(&crate::theme::swixter_theme())
            .with_prompt(prompt)
            .allow_empty(true)
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)?;
        crate::theme::print_rail();
        Ok(if v.is_empty() { None } else { Some(v) })
    };
    let input_req = |prompt: &str| -> Result<String, i32> {
        let v = Input::with_theme(&crate::theme::swixter_theme())
            .with_prompt(prompt)
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)?;
        crate::theme::print_rail();
        Ok(v)
    };
    // Base URL 专用：带 TS 向导的 URL 格式校验（空放行）
    let input_url = |prompt: &str| -> Result<Option<String>, i32> {
        let v: String = Input::with_theme(&crate::theme::swixter_theme())
            .with_prompt(prompt)
            .allow_empty(true)
            .validate_with(|s: &String| validate_url(s))
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)?;
        crate::theme::print_rail();
        Ok(if v.is_empty() { None } else { Some(v) })
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
            args.base_url = input_url("Base URL (optional)")?;
            if args.provider.as_deref() == Some("custom") {
                let formats = [
                    "openai_chat",
                    "anthropic_messages",
                    "openai_responses",
                    "anthropic_responses",
                    "gemini_native",
                ];
                let fi = Select::with_theme(&crate::theme::swixter_theme())
                    .with_prompt("API format")
                    .items(&formats)
                    .default(0)
                    .interact()
                    .map_err(|_| EXIT_CANCELLED)?;
                args.api_format = Some(formats[fi].into());
                crate::theme::print_rail();
            }
            let configure_models = Confirm::with_theme(&crate::theme::swixter_theme())
                .with_prompt("Configure models?")
                .default(false)
                .interact()
                .map_err(|_| EXIT_CANCELLED)?;
            crate::theme::print_rail();
            if configure_models {
                args.anthropic_model = input_opt("ANTHROPIC_MODEL (optional)")?;
                args.default_haiku_model = input_opt("Default Haiku model (optional)")?;
                args.default_opus_model = input_opt("Default Opus model (optional)")?;
                args.default_sonnet_model = input_opt("Default Sonnet model (optional)")?;
            }
        }
        "codex" => {
            args.base_url = input_url("Base URL (optional)")?;
            let mut model_choices: Vec<String> = preset
                .as_ref()
                .map(|p| p.default_models.clone())
                .unwrap_or_default();
            model_choices.push("Custom...".into());
            if !model_choices.is_empty() {
                let mi = Select::with_theme(&crate::theme::swixter_theme())
                    .with_prompt("Model")
                    .items(&model_choices)
                    .default(0)
                    .interact()
                    .map_err(|_| EXIT_CANCELLED)?;
                args.model = if model_choices[mi] == "Custom..." {
                    Some(input_req("Model name")?)
                } else {
                    crate::theme::print_rail();
                    Some(model_choices[mi].clone())
                };
            }
            args.env_key = input_opt("Env key for API key (optional, default OPENAI_API_KEY)")?;
        }
        "qwen" => {
            args.model = Some(input_req("Model")?);
            args.base_url = input_url("Base URL (optional)")?;
        }
        _ => {}
    }

    // TS 顺序：先确认"是否立即 apply"，再创建并落库；
    // 确认框取消 → 130 且不创建 profile（此前 Rust 先落库再返回 130，留下半成品）
    let do_apply = Confirm::with_theme(&crate::theme::swixter_theme())
        .with_prompt(format!("Apply this profile to {} now?", coder.display_name))
        .default(true)
        .interact()
        .map_err(|_| EXIT_CANCELLED)?;
    crate::theme::print_rail();

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
    crate::theme::print_step_done(&format!("Profile \"{}\" created", profile.name));
    crate::theme::print_rail();
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
        let v: String = Input::with_theme(&crate::theme::swixter_theme())
            .with_prompt(prompt)
            .default(cur.unwrap_or("").to_string())
            .allow_empty(true)
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)?;
        crate::theme::print_rail();
        Ok(if v.is_empty() { None } else { Some(v) })
    };
    // 密钥类输入（TS edit 向导）：prompt 只给掩码占位（前 10 字符 + "..."），
    // 完整密钥不进 dialoguer——否则 .default() 会在 prompt 回显并留在终端 scrollback；
    // 空输入保留原值
    let input_secret = |prompt: &str, cur: Option<&str>| -> Result<Option<String>, i32> {
        let prompt = match cur.filter(|s| !s.is_empty()) {
            Some(s) => format!("{prompt} (current: {})", mask_secret(s)),
            None => prompt.to_string(),
        };
        let v: String = Input::with_theme(&crate::theme::swixter_theme())
            .with_prompt(prompt)
            .allow_empty(true)
            .interact_text()
            .map_err(|_| EXIT_CANCELLED)?;
        crate::theme::print_rail();
        Ok(if v.is_empty() {
            cur.map(String::from)
        } else {
            Some(v)
        })
    };
    let mut p: Profile = profile;
    p.api_key = input_secret("API Key", Some(&p.api_key))?.unwrap_or_default();
    p.auth_token = input_secret("Auth Token", p.auth_token.as_deref())?;
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
    let do_apply = Confirm::with_theme(&crate::theme::swixter_theme())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mask_secret_keeps_first_10_chars() {
        assert_eq!(mask_secret("sk-ant-abcdefghij-rest"), "sk-ant-abc...");
        assert_eq!(mask_secret("short"), "short...");
        // 多字节字符不按字节切片（TS slice(0,10) 语义按字符计）
        assert_eq!(mask_secret("密钥测试abcdefgh额外"), "密钥测试abcdef...");
    }

    #[test]
    fn validate_url_rules() {
        // TS ProfileValidators.url：空/纯空白放行（可选字段）
        assert!(validate_url("").is_ok());
        assert!(validate_url("   ").is_ok());
        assert!(validate_url("https://api.example.com/v1").is_ok());
        assert!(validate_url("http://127.0.0.1:11434").is_ok());
        assert!(validate_url("not a url").is_err());
        assert!(validate_url("//missing-scheme").is_err());
    }

    #[test]
    fn merge_providers_user_overrides_builtin() {
        let builtin = vec![
            ("anthropic".to_string(), "Anthropic".to_string()),
            ("ollama".to_string(), "Ollama".to_string()),
        ];
        let user = vec![("ollama".to_string(), "My Ollama".to_string())];
        let merged = merge_providers(builtin, user);
        // user 覆盖内置 ollama：列表只有两条，ollama 取用户版
        assert_eq!(merged.len(), 2);
        assert_eq!(merged[0].0, "anthropic");
        assert_eq!(merged[1], ("ollama".to_string(), "My Ollama".to_string()));
    }
}
