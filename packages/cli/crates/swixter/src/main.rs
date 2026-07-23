mod cli;
mod commands;

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
    match cli.command {
        Commands::Proxy(_) | Commands::Ui(_) | Commands::Auth(_) | Commands::Sync(_) => {
            eprintln!(
                "This command is not yet available in the Rust build (coming in milestone M2/M3)."
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
        // 以下分支在后续任务中接入真实 handler；先报"未实现"保持编译
        _ => {
            eprintln!("not implemented yet");
            EXIT_GENERAL
        }
    }
}
