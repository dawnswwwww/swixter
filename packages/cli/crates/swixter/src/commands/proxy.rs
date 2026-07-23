use std::process::Stdio;
use std::time::Duration;

use swixter_core::adapters::get_adapter;
use swixter_core::coder::AdapterKind;
use swixter_core::config::ConfigManager;
use swixter_core::types::Profile;
use swixter_proxy::registry;
use swixter_proxy::server;
use swixter_proxy::types::{InstanceKind, ProxyServerConfig, ProxyStatus};
use swixter_proxy::{DEFAULT_PROXY_HOST, DEFAULT_PROXY_PORT, SWIXTER_PROXY_AUTH_TOKEN};

use crate::cli::{ProxyArgs, ProxyCommand, ProxyRunArgs, ProxyStartArgs};
use crate::{EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};

pub fn dispatch(args: ProxyArgs) -> i32 {
    match args.command {
        ProxyCommand::Start(a) => cmd_start(a),
        ProxyCommand::Stop { instance_id } => cmd_stop(instance_id.as_deref().unwrap_or("default")),
        ProxyCommand::Status => cmd_status(),
        ProxyCommand::Run(a) => cmd_run(a),
    }
}

fn runtime() -> tokio::runtime::Runtime {
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("tokio runtime")
}

/// group/profile 互斥 + 存在性校验（start/run 共用，TS cli/proxy.ts 同款）
fn validate_group_profile(
    mgr: &ConfigManager,
    group: Option<&str>,
    profile: Option<&str>,
) -> Result<(), i32> {
    if group.is_some() && profile.is_some() {
        eprintln!("Cannot specify both --group and --profile");
        return Err(EXIT_INVALID_ARG);
    }
    if let Some(g) = group {
        if mgr
            .config()
            .groups
            .values()
            .all(|x| x.name != *g && x.id != *g)
        {
            eprintln!("Group \"{g}\" not found");
            return Err(EXIT_NOT_FOUND);
        }
    }
    if let Some(p) = profile {
        if mgr.get_profile(p).is_none() {
            eprintln!("Profile \"{p}\" not found");
            return Err(EXIT_NOT_FOUND);
        }
    }
    Ok(())
}

fn cmd_start(a: ProxyStartArgs) -> i32 {
    let mgr = ConfigManager::load();
    if let Err(code) = validate_group_profile(&mgr, a.group.as_deref(), a.profile.as_deref()) {
        return code;
    }
    let default_status = registry::get_proxy_status("default");
    if default_status.running {
        println!(
            "Default proxy already running on {}:{}",
            default_status.host, default_status.port
        );
        return EXIT_SUCCESS;
    }
    // 未指定 group/profile 时用 active group
    let mut group = a.group.clone();
    if group.is_none() && a.profile.is_none() {
        if let Some(g) = mgr
            .config()
            .active_group
            .as_ref()
            .and_then(|id| mgr.config().groups.get(id))
        {
            println!("Using default group: {}", g.name);
            group = Some(g.name.clone());
        }
    }
    if a.daemon {
        cmd_start_daemon(&a, group.as_deref())
    } else {
        let config = ProxyServerConfig {
            instance_id: "default".into(),
            kind: InstanceKind::Service,
            host: a.host.clone(),
            port: a.port,
            timeout: Duration::from_millis(a.timeout),
            group_name: group,
            profile_name: a.profile.clone(),
            config_path: None,
        };
        runtime().block_on(async move {
            match server::start_proxy_server(config).await {
                Ok(s) => {
                    println!("✓ Proxy server started");
                    println!("  Instance: default (service)");
                    println!("  Address: {}:{}", s.host, s.port);
                    println!("  Press Ctrl+C to stop");
                    let _ = tokio::signal::ctrl_c().await;
                    server::stop_in_process_instance("default").await;
                    EXIT_SUCCESS
                }
                Err(e) => {
                    eprintln!("✗ {e}");
                    EXIT_GENERAL
                }
            }
        })
    }
}

fn cmd_start_daemon(a: &ProxyStartArgs, group: Option<&str>) -> i32 {
    // spawn 自身 detached：proxy start 同参（去掉 --daemon），stdio 全 null
    let exe = std::env::current_exe().expect("current exe");
    let mut cmd = std::process::Command::new(exe);
    cmd.args([
        "proxy",
        "start",
        "--host",
        &a.host,
        "--port",
        &a.port.to_string(),
        "--timeout",
        &a.timeout.to_string(),
    ]);
    if let Some(g) = group {
        cmd.args(["--group", g]);
    }
    if let Some(p) = &a.profile {
        cmd.args(["--profile", p]);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    unsafe {
        use std::os::unix::process::CommandExt;
        cmd.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        const DETACHED_PROCESS: u32 = 0x00000008;
        cmd.creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS);
    }
    if let Err(e) = cmd.spawn() {
        eprintln!("✗ Failed to spawn daemon: {e}");
        return EXIT_GENERAL;
    }
    // 轮询 /health（10×100ms）+ registry runtime（10×100ms）
    let ok = runtime().block_on(async {
        for _ in 0..10 {
            if server::health_check(&a.host, a.port).await {
                for _ in 0..10 {
                    let found = registry::list_proxy_instances()
                        .iter()
                        .any(|s| s.running && s.host == a.host && s.port == a.port);
                    if found {
                        return true;
                    }
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                return true; // health 通过即视为启动（runtime 轮询失败不致命）
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        false
    });
    if ok {
        println!("✓ Proxy server started in background");
        println!("  Address: {}:{}", a.host, a.port);
        EXIT_SUCCESS
    } else {
        eprintln!("✗ Failed to start proxy server in background");
        EXIT_GENERAL
    }
}

fn cmd_stop(instance_id: &str) -> i32 {
    let status = registry::get_proxy_status(instance_id);
    if !status.running {
        println!("Proxy instance \"{instance_id}\" is not running");
        return EXIT_SUCCESS;
    }
    runtime().block_on(async {
        if server::stop_in_process_instance(instance_id).await {
            println!("✓ Proxy instance \"{instance_id}\" stopped");
            return EXIT_SUCCESS;
        }
        // 跨进程：按 registry pid 发信号 kill（决策点 3，改进 TS 只删条目的现状）
        if let Some(pid) = status.pid {
            registry::terminate_process(pid);
        }
        registry::remove_instance(instance_id);
        println!("✓ Proxy instance \"{instance_id}\" stopped");
        EXIT_SUCCESS
    })
}

fn cmd_status() -> i32 {
    let instances = registry::list_proxy_instances();
    let running: Vec<_> = instances.iter().filter(|s| s.running).collect();
    println!();
    println!("Proxy Status:");
    println!();
    if running.is_empty() {
        println!("  ● No proxy instances running");
        println!();
        println!("  Start with: swixter proxy start");
        return EXIT_SUCCESS;
    }
    for s in running {
        let kind = if s.kind == InstanceKind::Service {
            "service"
        } else {
            "run"
        };
        println!("  ● {} ({kind})", s.instance_id);
        println!("    Address: {}:{}", s.host, s.port);
        println!("    Group: {}", s.group_name.as_deref().unwrap_or("none"));
        println!(
            "    Profile: {}",
            s.profile_name.as_deref().unwrap_or("none")
        );
        println!(
            "    Requests: {} | Errors: {}",
            s.request_count, s.error_count
        );
        if let Some(t) = &s.start_time {
            println!("    Started: {t}");
        }
        println!();
    }
    EXIT_SUCCESS
}

pub struct RuntimeBinding {
    pub host: String,
    pub port: u16,
    pub reuse_existing: bool,
    pub reuse_instance_id: Option<String>,
}

/// TS: resolveProxyRuntimeBinding
pub fn resolve_proxy_runtime_binding(
    group_name: Option<&str>,
    profile_name: Option<&str>,
    requested_port: Option<u16>,
    all_instances: &[ProxyStatus],
) -> RuntimeBinding {
    if let Some(port) = requested_port {
        return RuntimeBinding {
            host: DEFAULT_PROXY_HOST.into(),
            port,
            reuse_existing: false,
            reuse_instance_id: None,
        };
    }
    if let Some(existing) = all_instances.iter().find(|s| {
        s.running
            && ((group_name.is_some() && s.group_name.as_deref() == group_name)
                || (profile_name.is_some() && s.profile_name.as_deref() == profile_name))
    }) {
        return RuntimeBinding {
            host: existing.host.clone(),
            port: existing.port,
            reuse_existing: true,
            reuse_instance_id: Some(existing.instance_id.clone()),
        };
    }
    let occupied: std::collections::HashSet<u16> = all_instances
        .iter()
        .filter(|s| s.running)
        .map(|s| s.port)
        .collect();
    let mut port = DEFAULT_PROXY_PORT;
    while occupied.contains(&port) {
        port += 1;
    }
    RuntimeBinding {
        host: DEFAULT_PROXY_HOST.into(),
        port,
        reuse_existing: false,
        reuse_instance_id: None,
    }
}

/// TS: buildCoderProxyEnv
pub fn build_coder_proxy_env(
    coder: &str,
    base: &[(String, String)],
    port: u16,
) -> Vec<(String, String)> {
    let base_url = format!("http://{DEFAULT_PROXY_HOST}:{port}");
    let mut env: Vec<(String, String)> = base.to_vec();
    let set = |env: &mut Vec<(String, String)>, k: &str, v: &str| {
        env.retain(|(key, _)| key != k);
        env.push((k.to_string(), v.to_string()));
    };
    let unset = |env: &mut Vec<(String, String)>, k: &str| env.retain(|(key, _)| key != k);
    match coder {
        "claude" => {
            set(&mut env, "ANTHROPIC_API_BASE", &base_url);
            set(&mut env, "ANTHROPIC_AUTH_TOKEN", SWIXTER_PROXY_AUTH_TOKEN);
            unset(&mut env, "ANTHROPIC_API_KEY");
        }
        "qwen" => {
            set(&mut env, "ANTHROPIC_API_BASE", &base_url);
            set(&mut env, "ANTHROPIC_API_KEY", "dummy");
            unset(&mut env, "ANTHROPIC_AUTH_TOKEN");
        }
        "codex" => {
            set(&mut env, "OPENAI_API_BASE", &base_url);
            set(&mut env, "OPENAI_API_KEY", "dummy");
        }
        _ => {}
    }
    env
}

fn cmd_run(a: ProxyRunArgs) -> i32 {
    let mgr = ConfigManager::load();
    if let Err(code) = validate_group_profile(&mgr, a.group.as_deref(), a.profile.as_deref()) {
        return code;
    }
    // 都未指定 → active group；仍无 → 报错提示
    let mut group = a.group.clone();
    if group.is_none() && a.profile.is_none() {
        group = mgr
            .config()
            .active_group
            .as_ref()
            .and_then(|id| mgr.config().groups.get(id))
            .map(|g| g.name.clone());
    }
    if group.is_none() && a.profile.is_none() {
        eprintln!("No group or profile specified, and no default group set");
        eprintln!("Use --group, --profile, or create a default group first");
        return EXIT_GENERAL;
    }

    let instances = registry::list_proxy_instances();
    let binding =
        resolve_proxy_runtime_binding(group.as_deref(), a.profile.as_deref(), a.port, &instances);
    let instance_id = format!("run-{}", binding.port);
    // 有意偏差（Global Constraints）：复用实例时 coder 退出不停该实例；TS 会误停
    let started_by_us = !binding.reuse_existing;
    if let Some(id) = &binding.reuse_instance_id {
        println!("✓ Reusing running instance: {id}");
    }

    let coder_args = a.args.clone();
    let Some(coder) = coder_args.first().cloned() else {
        eprintln!("Coder command required after --");
        eprintln!("Example: swixter proxy run -- claude");
        return EXIT_GENERAL;
    };
    // claude：proxy profile + marker models 写入 ~/.claude/settings.json（TS applyClaudeProfile 路径）
    if coder == "claude" {
        let target = a
            .profile
            .as_ref()
            .and_then(|n| mgr.get_profile(n))
            .or_else(|| {
                group
                    .as_ref()
                    .and_then(|g| {
                        mgr.config()
                            .groups
                            .values()
                            .find(|x| x.name == *g || x.id == *g)
                    })
                    .and_then(|g| g.profiles.first())
                    .and_then(|n| mgr.get_profile(n))
            });
        let proxy_profile = Profile {
            name: format!(
                "proxy-{}",
                a.profile
                    .as_deref()
                    .or(group.as_deref())
                    .unwrap_or("default")
            ),
            provider_id: "anthropic".into(),
            api_key: String::new(),
            auth_token: Some(SWIXTER_PROXY_AUTH_TOKEN.into()),
            base_url: Some(format!("http://{}:{}", binding.host, binding.port)),
            models: target.and_then(swixter_core::model::build_claude_proxy_marker_models),
            created_at: swixter_core::types::now_iso(),
            updated_at: swixter_core::types::now_iso(),
            ..Default::default()
        };
        let adapter = get_adapter(AdapterKind::Claude);
        if let Err(e) = adapter.apply(&proxy_profile, None) {
            eprintln!("✗ Failed to apply claude proxy profile: {e}");
            return EXIT_GENERAL;
        }
    }

    let base_env: Vec<(String, String)> = std::env::vars().collect();
    let env = build_coder_proxy_env(&coder, &base_env, binding.port);

    runtime().block_on(async move {
        if started_by_us {
            let config = ProxyServerConfig {
                instance_id: instance_id.clone(),
                kind: InstanceKind::Run,
                host: binding.host.clone(),
                port: binding.port,
                // TS run 不传 timeout → forwarder 默认
                timeout: Duration::from_millis(swixter_proxy::DEFAULT_TIMEOUT_MS),
                group_name: group,
                profile_name: a.profile,
                config_path: None,
            };
            if let Err(e) = server::start_proxy_server(config).await {
                eprintln!("✗ {e}");
                return EXIT_GENERAL;
            }
        }
        println!("✓ Running: {} {}", coder, coder_args[1..].join(" "));
        println!("  Proxy: {}:{}", binding.host, binding.port);

        // env 已是完整环境（含删除项处理），必须 env_clear 才能真正删掉 ANTHROPIC_API_KEY 等
        let mut child = match tokio::process::Command::new(&coder)
            .args(&coder_args[1..])
            .env_clear()
            .envs(env)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
        {
            Ok(c) => c,
            Err(e) => {
                eprintln!("✗ Failed to launch {coder}: {e}");
                if started_by_us {
                    server::stop_in_process_instance(&instance_id).await;
                }
                return EXIT_GENERAL;
            }
        };

        // coder 退出 → 停实例、透传退出码；Ctrl+C → 转发 + 停 + exit 1
        let code = tokio::select! {
            status = child.wait() => status.map(|s| s.code().unwrap_or(0)).unwrap_or(0),
            _ = tokio::signal::ctrl_c() => {
                let _ = child.kill().await;
                if started_by_us {
                    server::stop_in_process_instance(&instance_id).await;
                }
                return 1;
            }
        };
        if started_by_us {
            server::stop_in_process_instance(&instance_id).await;
        }
        code
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coder_env_injection() {
        let base = vec![
            ("ANTHROPIC_API_KEY".to_string(), "old".to_string()),
            ("PATH".to_string(), "/bin".to_string()),
        ];
        let env = build_coder_proxy_env("claude", &base, 15721);
        assert!(env
            .iter()
            .any(|(k, v)| k == "ANTHROPIC_API_BASE" && v == "http://127.0.0.1:15721"));
        assert!(env
            .iter()
            .any(|(k, v)| k == "ANTHROPIC_AUTH_TOKEN" && v == "swixter-local-proxy"));
        assert!(!env.iter().any(|(k, _)| k == "ANTHROPIC_API_KEY")); // 删除
        let env = build_coder_proxy_env("qwen", &base, 15721);
        assert!(env
            .iter()
            .any(|(k, v)| k == "ANTHROPIC_API_KEY" && v == "dummy"));
        let env = build_coder_proxy_env("codex", &base, 15721);
        assert!(env
            .iter()
            .any(|(k, v)| k == "OPENAI_API_BASE" && v == "http://127.0.0.1:15721"));
        assert!(env
            .iter()
            .any(|(k, v)| k == "OPENAI_API_KEY" && v == "dummy"));
    }

    #[test]
    fn runtime_binding_reuse_and_port_scan() {
        let running = |id: &str, port: u16, group: Option<&str>| ProxyStatus {
            instance_id: id.into(),
            running: true,
            port,
            group_name: group.map(Into::into),
            ..Default::default()
        };
        let instances = vec![
            running("default", 15721, Some("g1")),
            running("run-15722", 15722, None),
        ];
        // 显式 port 直接生效
        let b = resolve_proxy_runtime_binding(None, None, Some(16000), &instances);
        assert_eq!(b.port, 16000);
        assert!(!b.reuse_existing);
        // 同 group 复用
        let b = resolve_proxy_runtime_binding(Some("g1"), None, None, &instances);
        assert!(b.reuse_existing);
        assert_eq!(b.port, 15721);
        // 否则从 15721 起找空位
        let b = resolve_proxy_runtime_binding(Some("g2"), None, None, &instances);
        assert_eq!(b.port, 15723);
        assert!(!b.reuse_existing);
    }
}
