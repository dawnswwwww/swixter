use crate::cli::RunArgs;
use crate::{EXIT_GENERAL, EXIT_NOT_FOUND};
use std::process::Command;
use swixter_core::adapters::get_adapter;
use swixter_core::coder::CoderSpec;
use swixter_core::config::ConfigManager;
use swixter_core::model::{
    build_profile_env, get_openai_model, resolve_env_key, CLAUDE_ENV_MAPPING,
};
use swixter_core::presets;

pub fn run(coder: &CoderSpec, args: RunArgs) -> i32 {
    let mgr = ConfigManager::load();
    let profile = match &args.profile {
        Some(name) => mgr.get_profile(name),
        None => mgr.active_profile(coder.id),
    };
    let profile = match profile {
        Some(p) => p.clone(),
        None => {
            eprintln!(
                "✗ No profile available (create one with: swixter {} create)",
                coder.id
            );
            return EXIT_NOT_FOUND;
        }
    };
    let preset = presets::find_provider(&profile.provider_id);

    let mut cmd = Command::new(coder.executable);
    cmd.args(&args.args)
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());

    // claude：临时 settings 文件 + --yolo 重写
    let mut tmp_settings: Option<std::path::PathBuf> = None;
    match coder.id {
        "claude" => {
            let base_url = profile
                .base_url
                .as_deref()
                .or(preset.as_ref().map(|p| p.base_url.as_str()))
                .unwrap_or("");
            let env = build_profile_env(&profile, &CLAUDE_ENV_MAPPING, base_url);
            let millis = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis();
            // millis + 6 位随机后缀，避免并发/残留冲突
            let rand6: u32 = rand::random::<u32>() % 1_000_000;
            let tmp =
                std::env::temp_dir().join(format!("swixter-settings-{millis}-{rand6:06}.json"));
            let env_map: serde_json::Map<String, serde_json::Value> = env
                .into_iter()
                .map(|(k, v)| (k, serde_json::Value::String(v)))
                .collect();
            // 有意偏差（比 TS 更安全）：临时 settings 只写当前 profile 的 env，
            // 不合并用户已有 settings.json 的其他段
            let json = serde_json::json!({ "env": env_map });
            if let Err(e) = std::fs::write(&tmp, serde_json::to_string_pretty(&json).unwrap()) {
                eprintln!("✗ failed to write temp settings: {e}");
                return EXIT_GENERAL;
            }
            // 内含 API key，权限收紧为 0600（unix）
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600));
            }
            cmd.arg("--settings").arg(&tmp);
            if args.yolo {
                cmd.arg("--dangerously-skip-permissions");
            }
            tmp_settings = Some(tmp);
        }
        "codex" => {
            // TS: codex run 先 apply 再注入 env
            let adapter = get_adapter(coder.adapter);
            if let Err(e) = adapter.apply(&profile, preset.as_ref()) {
                eprintln!("✗ {e}");
                return EXIT_GENERAL;
            }
            if !profile.api_key.is_empty() {
                cmd.env(resolve_env_key(&profile, preset.as_ref()), &profile.api_key);
            }
            if let Some(m) = get_openai_model(&profile) {
                cmd.env("OPENAI_MODEL", m);
            }
        }
        "qwen" => {
            // TS cli/qwen.ts: base 回退链 profile.baseURL || preset.baseURLChat || preset.baseURL
            let base = profile
                .base_url
                .as_deref()
                .or(preset.as_ref().and_then(|p| p.base_url_chat.as_deref()))
                .or(preset.as_ref().map(|p| p.base_url.as_str()))
                .unwrap_or("");
            // qwen 场景 model 直接取 model/openaiModel 字段（不看 models 对象，
            // 与 get_openai_model 不同，对齐 TS `profile.model || profile.openaiModel`）
            let model = profile
                .model
                .as_deref()
                .or(profile.openai_model.as_deref())
                .filter(|s| !s.is_empty());
            // TS: 同时注入三个 openai 参数（在透传参数之前）
            let mut pre: Vec<String> = vec![];
            if !profile.api_key.is_empty() {
                pre.extend(["--openai-api-key".into(), profile.api_key.clone()]);
            }
            if !base.is_empty() {
                pre.extend(["--openai-base-url".into(), base.to_string()]);
            }
            if let Some(m) = model {
                pre.extend(["--model".into(), m.to_string()]);
            }
            // 重建参数顺序：注入参数在前
            let mut cmd2 = Command::new(coder.executable);
            cmd2.args(&pre)
                .args(&args.args)
                .stdin(std::process::Stdio::inherit())
                .stdout(std::process::Stdio::inherit())
                .stderr(std::process::Stdio::inherit());
            // 注入子进程 env
            if !profile.api_key.is_empty() {
                cmd2.env("OPENAI_API_KEY", &profile.api_key);
            }
            if !base.is_empty() {
                cmd2.env("OPENAI_BASE_URL", base);
            }
            if let Some(m) = model {
                cmd2.env("OPENAI_MODEL", m);
            }
            cmd = cmd2;
        }
        _ => {}
    }

    let status = match cmd.status() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("✗ Failed to launch {}: {e}", coder.executable);
            eprintln!("  Is it installed? Try: swixter {} install", coder.id);
            if let Some(t) = &tmp_settings {
                let _ = std::fs::remove_file(t);
            }
            return EXIT_NOT_FOUND;
        }
    };
    if let Some(t) = &tmp_settings {
        let _ = std::fs::remove_file(t);
    }
    status.code().unwrap_or(EXIT_GENERAL)
}
