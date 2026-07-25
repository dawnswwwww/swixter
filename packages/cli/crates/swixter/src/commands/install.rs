use crate::install_data;
use crate::{EXIT_GENERAL, EXIT_INVALID_ARG, EXIT_NOT_FOUND, EXIT_SUCCESS};
use std::process::Command;
use swixter_core::coder::CoderSpec;

pub fn is_command_available(exe: &str) -> bool {
    // PATH 逐目录查找（Windows 追加 .exe/.cmd）
    let path = match std::env::var_os("PATH") {
        Some(p) => p,
        None => return false,
    };
    std::env::split_paths(&path).any(|dir| {
        let candidate = dir.join(exe);
        candidate.is_file()
            || (cfg!(windows)
                && (dir.join(format!("{exe}.exe")).is_file()
                    || dir.join(format!("{exe}.cmd")).is_file()))
    })
}

/// TS: utils/cli-version.ts — 三个正则模式按序提取
pub fn get_cli_version(exe: &str) -> Option<String> {
    let out = Command::new(exe).arg("--version").output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let patterns = [
        r"v?(\d+\.\d+\.\d+[^ \n\r]*)",
        r"v?(\d+\.\d+\.\d+)",
        r"version[:\s]+(\S+)",
    ];
    for pat in patterns {
        let re = regex::Regex::new(pat).unwrap();
        if let Some(cap) = re.captures(&text) {
            let v = cap[1].to_string();
            if semver::Version::parse(v.trim_start_matches('v')).is_ok() {
                return Some(v);
            }
        }
    }
    None
}

/// method.shell 优先（bash→sh -c、powershell→powershell -Command、cmd→cmd /C）；
/// 缺失时按平台默认（Windows: cmd /C，其他: sh -c）
fn run_shell(command: &str, shell: Option<&str>) -> bool {
    let status = match shell {
        Some("powershell") => Command::new("powershell")
            .args(["-Command", command])
            .status(),
        Some("cmd") => Command::new("cmd").args(["/C", command]).status(),
        Some(_) => Command::new("sh").args(["-c", command]).status(),
        None => {
            if cfg!(windows) {
                Command::new("cmd").args(["/C", command]).status()
            } else {
                Command::new("sh").args(["-c", command]).status()
            }
        }
    };
    status.map(|s| s.success()).unwrap_or(false)
}

pub fn install(coder: &CoderSpec, method: Option<usize>, _force: bool) -> i32 {
    if is_command_available(coder.executable) {
        println!("✓ {} is already installed", coder.display_name);
        if let Some(v) = get_cli_version(coder.executable) {
            println!("  Version: {v}");
        }
        return EXIT_SUCCESS;
    }
    let methods = install_data::methods_for(coder.id);
    if methods.is_empty() {
        eprintln!("Please install {} manually.", coder.display_name);
        return EXIT_GENERAL;
    }
    let selected = match method {
        Some(idx) => {
            if idx == 0 || idx > methods.len() {
                eprintln!("Invalid method index. Available: 1-{}", methods.len());
                return EXIT_INVALID_ARG;
            }
            methods[idx - 1]
        }
        None if methods.len() == 1 => methods[0],
        None => {
            // 交互选择（非 TTY 时打列表并退出 1，与 TS 对齐）
            if !crate::commands::coder::is_tty() {
                println!("Please install {} manually:", coder.display_name);
                for (i, m) in methods.iter().enumerate() {
                    println!("  {}. {} — {}", i + 1, m.label, m.command);
                }
                return EXIT_GENERAL;
            }
            let items: Vec<String> = methods
                .iter()
                .map(|m| {
                    if m.recommended {
                        format!("{} ★", m.label)
                    } else {
                        m.label.clone()
                    }
                })
                .collect();
            match dialoguer::Select::with_theme(&crate::theme::swixter_theme())
                .with_prompt("Select installation method")
                .items(&items)
                .default(0)
                .interact()
            {
                Ok(i) => methods[i],
                Err(_) => return crate::EXIT_CANCELLED,
            }
        }
    };
    if let Some(note) = &selected.note {
        println!("  Note: {note}");
    }
    println!("$ {}", selected.command);
    if !run_shell(&selected.command, selected.shell.as_deref()) {
        eprintln!("✗ Failed to install {}", coder.display_name);
        return EXIT_GENERAL;
    }
    if is_command_available(coder.executable) {
        println!("✓ {} installed successfully", coder.display_name);
        if let Some(v) = get_cli_version(coder.executable) {
            println!("  Version: {v}");
        }
        if let Some(config) = install_data::install_data().install_configs.get(coder.id) {
            if let Some(note) = &config.post_install_note {
                println!("  {note}");
            }
        }
        EXIT_SUCCESS
    } else {
        eprintln!(
            "✗ Installation command completed but {} is not available.",
            coder.display_name
        );
        EXIT_GENERAL
    }
}

pub fn update(coder: &CoderSpec) -> i32 {
    if !is_command_available(coder.executable) {
        eprintln!("⚠ {} is not installed", coder.display_name);
        eprintln!("  Install it first: swixter {} install", coder.id);
        return EXIT_NOT_FOUND;
    }
    let current = get_cli_version(coder.executable);
    if let Some(v) = &current {
        println!("Current version: {v}");
    }
    // TS: detectInstallationMethod 按可执行文件路径推断安装方式；
    // 检测不到时回退 recommended 方法。
    let methods = install_data::methods_for(coder.id);
    let method = detect_installation_method(coder).or_else(|| {
        methods
            .iter()
            .find(|m| m.recommended)
            .copied()
            .or(methods.first().copied())
    });
    let method = match method {
        Some(m) => m,
        None => {
            eprintln!("No update method available");
            return EXIT_GENERAL;
        }
    };
    let command = install_data::update_command_for(coder.id, &method.command)
        .unwrap_or_else(|| method.command.clone());
    println!("$ {command}");
    if !run_shell(&command, method.shell.as_deref()) {
        eprintln!("✗ Failed to update {}", coder.display_name);
        return EXIT_GENERAL;
    }
    match (get_cli_version(coder.executable), current) {
        (Some(new), Some(old)) if new != old => println!("✓ Updated from {old} to {new}"),
        (Some(new), _) => println!("✓ {} is up to date (Version: {new})", coder.display_name),
        _ => println!("✓ Update completed"),
    }
    EXIT_SUCCESS
}

/// 移植 TS utils/install.ts detectInstallationMethod：
/// 按可执行文件的真实路径特征推断安装方式（如 npm global bin、brew Cellar 等）。
/// 检测不到返回 None。
fn detect_installation_method(coder: &CoderSpec) -> Option<&'static install_data::InstallMethod> {
    let exe_path = which_path(coder.executable)?;
    let methods = install_data::methods_for(coder.id);
    // 规则（TS install.ts）：路径包含 "npm"/"nvm"/"volta" → npm 方法；包含 "Cellar"|"homebrew"|"linuxbrew" → brew 方法
    let p = exe_path.to_string_lossy().to_lowercase();
    let hint = if p.contains("cellar") || p.contains("homebrew") || p.contains("linuxbrew") {
        Some("brew")
    } else if p.contains("npm")
        || p.contains("nvm")
        || p.contains("volta")
        || p.contains("node_modules")
    {
        Some("npm")
    } else {
        None
    };
    hint.and_then(|h| {
        methods
            .into_iter()
            .find(|m| m.command.contains(h) || m.label.to_lowercase().contains(h))
    })
}

fn which_path(exe: &str) -> Option<std::path::PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(exe))
        .find(|p| p.is_file())
}
