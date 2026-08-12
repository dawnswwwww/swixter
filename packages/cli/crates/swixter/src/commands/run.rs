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

/// （纯函数）coder CLI 启动参数：Windows 下 npm 全局安装的是 .cmd shim，
/// CreateProcess 只解析 .exe，必须经 `cmd /C` 启动（TS spawnCLI 的 shell: isWin32）；
/// 其余平台直接启动。返回 (program, 前置 args)，调用方继续追加自身参数。
/// 抽成纯函数便于在非 Windows 主机上单测 Windows 分支。
pub fn launch_spec(exe: &str, windows: bool) -> (String, Vec<String>) {
    if windows {
        ("cmd".into(), vec!["/C".into(), exe.into()])
    } else {
        (exe.into(), vec![])
    }
}

/// 按当前平台构造 coder 启动命令
pub fn coder_command(exe: &str) -> Command {
    let (prog, pre) = launch_spec(exe, cfg!(windows));
    let mut c = Command::new(prog);
    c.args(pre);
    c
}

/// run 系列 flag 提取结果
pub struct ExtractedRunFlags {
    pub profile: Option<String>,
    pub yolo: bool,
    pub rest: Vec<String>,
}

/// 对透传参数预扫描提取 swixter 自有 flag（TS parseFlags 全局提取 + spawn*WithEnv 过滤的合并语义）：
/// - `--profile X` / `--profile=X` 两种形式都提取（TS parseFlags 均支持），提取后从透传列表移除
///   （TS 对 `--profile=X` 只提取不过滤、会把 flag 传给 coder 本体，属 TS 瑕疵，此处提取即移除）
/// - `--yolo` 仅 claude 提取（TS 中 codex/qwen 的 --yolo 原样透传给 coder）
/// - 重复出现时后者覆盖前者（TS parseFlags 后写覆盖）
pub fn extract_run_flags(args: &[String], is_claude: bool) -> ExtractedRunFlags {
    let mut profile = None;
    let mut yolo = false;
    let mut rest = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        if a == "--profile" {
            // 后跟非 flag 值才算带值（TS parseFlags：下一个参数以 - 开头则视为布尔）
            if i + 1 < args.len() && !args[i + 1].starts_with('-') {
                profile = Some(args[i + 1].clone());
                i += 2;
                continue;
            }
            rest.push(a.clone());
            i += 1;
            continue;
        }
        if let Some(v) = a.strip_prefix("--profile=") {
            profile = Some(v.to_string());
            i += 1;
            continue;
        }
        if is_claude && a == "--yolo" {
            yolo = true;
            i += 1;
            continue;
        }
        rest.push(a.clone());
        i += 1;
    }
    ExtractedRunFlags {
        profile,
        yolo,
        rest,
    }
}

pub fn run(coder: &CoderSpec, args: RunArgs) -> i32 {
    // TS parseFlags 全局提取：透传列表里的 --profile/--yolo 也先提取再透传剩余；
    // 命令行上透传参数位于 clap 已解析 flag 之后，提取到的覆盖 clap 值（TS 后写覆盖）
    let extracted = extract_run_flags(&args.args, coder.id == "claude");
    let profile_name = extracted.profile.or(args.profile);
    let yolo = args.yolo || extracted.yolo;
    let rest = extracted.rest;

    let mgr = ConfigManager::load();
    let profile = match &profile_name {
        Some(name) => match mgr.get_profile(name) {
            Some(p) => p.clone(),
            None => {
                // TS: Error: Profile "X" not found / Run 'swixter <coder> list' ...
                eprintln!("✗ Profile \"{name}\" not found");
                eprintln!("  Run 'swixter {} list' to see all profiles", coder.id);
                return EXIT_NOT_FOUND;
            }
        },
        None => match mgr.active_profile(coder.id) {
            Some(p) => p.clone(),
            None => {
                eprintln!("✗ No active profile for {}", coder.display_name);
                eprintln!(
                    "  Run 'swixter {} create' to create a profile, or use --profile to specify one",
                    coder.id
                );
                return EXIT_NOT_FOUND;
            }
        },
    };
    let preset = presets::find_provider(&profile.provider_id);

    let mut cmd = coder_command(coder.executable);
    cmd.args(&rest)
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
            if yolo {
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
            let mut cmd2 = coder_command(coder.executable);
            cmd2.args(&pre)
                .args(&rest)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_spec_windows_uses_cmd_shim() {
        // Windows：npm 全局 CLI 是 .cmd shim，必须经 cmd /C 启动
        let (prog, pre) = launch_spec("claude", true);
        assert_eq!(prog, "cmd");
        assert_eq!(pre, vec!["/C".to_string(), "claude".to_string()]);
    }

    #[test]
    fn launch_spec_non_windows_direct() {
        let (prog, pre) = launch_spec("claude", false);
        assert_eq!(prog, "claude");
        assert!(pre.is_empty());
    }

    #[test]
    fn extract_profile_both_forms() {
        // --profile X：提取并移除两个 token
        let e = extract_run_flags(&["chat".into(), "--profile".into(), "t1".into()], true);
        assert_eq!(e.profile.as_deref(), Some("t1"));
        assert_eq!(e.rest, vec!["chat".to_string()]);
        // --profile=X：提取并移除（TS 只提取不过滤，此处修正 TS 瑕疵）
        let e = extract_run_flags(&["chat".into(), "--profile=t2".into()], true);
        assert_eq!(e.profile.as_deref(), Some("t2"));
        assert_eq!(e.rest, vec!["chat".to_string()]);
    }

    #[test]
    fn extract_yolo_only_for_claude() {
        let e = extract_run_flags(&["chat".into(), "--yolo".into()], true);
        assert!(e.yolo);
        assert_eq!(e.rest, vec!["chat".to_string()]);
        // codex/qwen：--yolo 原样透传（TS 语义）
        let e = extract_run_flags(&["chat".into(), "--yolo".into()], false);
        assert!(!e.yolo);
        assert_eq!(e.rest, vec!["chat".to_string(), "--yolo".to_string()]);
    }

    #[test]
    fn extract_last_profile_wins() {
        // TS parseFlags：后写覆盖
        let e = extract_run_flags(
            &[
                "--profile".into(),
                "a".into(),
                "chat".into(),
                "--profile".into(),
                "b".into(),
            ],
            true,
        );
        assert_eq!(e.profile.as_deref(), Some("b"));
        assert_eq!(e.rest, vec!["chat".to_string()]);
    }

    #[test]
    fn extract_profile_without_value_passes_through() {
        // --profile 后无值（TS parseFlags 视为布尔）→ 原样透传
        let e = extract_run_flags(&["chat".into(), "--profile".into()], true);
        assert_eq!(e.profile, None);
        assert_eq!(e.rest, vec!["chat".to_string(), "--profile".to_string()]);
    }
}
