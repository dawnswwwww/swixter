mod cli;
mod commands;
mod install_data;

use clap::{CommandFactory, Parser};
use cli::{Cli, Commands};

pub const EXIT_SUCCESS: i32 = 0;
pub const EXIT_GENERAL: i32 = 1;
pub const EXIT_INVALID_ARG: i32 = 2;
pub const EXIT_NOT_FOUND: i32 = 3;
pub const EXIT_CANCELLED: i32 = 130;

fn main() {
    std::process::exit(run());
}

fn run() -> i32 {
    let cli = Cli::parse();
    let Some(command) = cli.command else {
        // TS: 无参数 → 打印全局 help 并 exit 0
        let _ = Cli::command().print_help();
        println!();
        return EXIT_SUCCESS;
    };
    match command {
        Commands::Ui(_) | Commands::Auth(_) | Commands::Sync(_) => {
            eprintln!(
                "This command is not yet available in the Rust build (coming in milestone M3)."
            );
            EXIT_GENERAL
        }
        Commands::Completion { shell } => {
            let mut cmd = Cli::command();
            let clap_shell = match shell {
                cli::ShellKind::Bash => clap_complete::Shell::Bash,
                cli::ShellKind::Zsh => clap_complete::Shell::Zsh,
                cli::ShellKind::Fish => clap_complete::Shell::Fish,
            };
            clap_complete::generate(clap_shell, &mut cmd, "swixter", &mut std::io::stdout());
            EXIT_SUCCESS
        }
        Commands::Claude(a) => commands::coder::dispatch("claude", a),
        Commands::Codex(a) => commands::coder::dispatch("codex", a),
        Commands::Qwen(a) => commands::coder::dispatch("qwen", a),
        Commands::Providers(a) => commands::providers::dispatch(a),
        Commands::Group(a) => commands::group::dispatch(a),
        Commands::Proxy(a) => commands::proxy::dispatch(a),
        Commands::Export { file } => commands::transfer::export_cmd(&file),
        Commands::Import { file } => commands::transfer::import_cmd(&file),
    }
}
