use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "swixter",
    version,
    about = "AI coding assistant profile switcher"
)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Manage Claude Code profiles
    Claude(CoderArgs),
    /// Manage Codex profiles
    Codex(CoderArgs),
    /// Manage Qwen (Continue.dev) profiles
    Qwen(CoderArgs),
    /// Manage custom providers
    Providers(ProvidersArgs),
    /// Manage failover groups
    Group(GroupArgs),
    /// Export profiles to a file
    Export { file: PathBuf },
    /// Import profiles from a file
    Import { file: PathBuf },
    /// Print shell completion script
    Completion { shell: ShellKind },
    /// [M2] Local proxy with failover
    Proxy(StubArgs),
    /// [M3] Web UI
    Ui(StubArgs),
    /// [M3] Cloud auth
    Auth(StubArgs),
    /// [M3] Cloud sync
    Sync(StubArgs),
}

#[derive(Args)]
pub struct StubArgs {
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub args: Vec<String>,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum ShellKind {
    Bash,
    Zsh,
    Fish,
}

#[derive(Args)]
pub struct CoderArgs {
    #[command(subcommand)]
    pub command: Option<CoderCommand>,
}

// CreateArgs 远大于其他变体；命令枚举每进程只构造一次，不为省内存引入 Box 间接层
#[allow(clippy::large_enum_variant)]
#[derive(Subcommand)]
pub enum CoderCommand {
    /// Create a new profile (interactive wizard unless --quiet)
    #[command(alias = "new", alias = "create-profile")]
    Create(CreateArgs),
    /// List profiles
    #[command(alias = "ls")]
    List,
    /// Switch active profile
    #[command(alias = "sw", alias = "switch-profile")]
    Switch {
        name: String,
        #[arg(long)]
        apply: bool,
        #[arg(long = "no-apply")]
        no_apply: bool,
    },
    /// Edit a profile (interactive)
    #[command(alias = "update")]
    Edit { name: Option<String> },
    /// Delete a profile
    #[command(alias = "rm", alias = "delete-profile")]
    Delete { name: String },
    /// Apply active profile to the coder's config file
    Apply,
    /// Show current active profile
    Current,
    /// Run the coder CLI with the active profile
    #[command(alias = "r")]
    Run(RunArgs),
    /// Install the coder CLI
    Install {
        /// 1-based install method index
        #[arg(long)]
        method: Option<usize>,
        #[arg(long)]
        force: bool,
    },
    /// Update the coder CLI
    #[command(alias = "upgrade")]
    UpdateCli,
}

#[derive(Args)]
pub struct CreateArgs {
    #[arg(long, short = 'n')]
    pub name: Option<String>,
    #[arg(long, short = 'p')]
    pub provider: Option<String>,
    #[arg(long, short = 'k')]
    pub api_key: Option<String>,
    #[arg(long, short = 't')]
    pub auth_token: Option<String>,
    #[arg(long, short = 'u')]
    pub base_url: Option<String>,
    #[arg(long, short = 'm')]
    pub model: Option<String>,
    #[arg(long)]
    pub env_key: Option<String>,
    #[arg(long)]
    pub anthropic_model: Option<String>,
    #[arg(long)]
    pub default_haiku_model: Option<String>,
    #[arg(long)]
    pub default_opus_model: Option<String>,
    #[arg(long)]
    pub default_sonnet_model: Option<String>,
    #[arg(long)]
    pub api_format: Option<String>,
    /// Non-interactive mode (requires --name and --provider)
    #[arg(long, short = 'q')]
    pub quiet: bool,
    /// Apply immediately after creation
    #[arg(long, short = 'a')]
    pub apply: bool,
}

#[derive(Args)]
pub struct RunArgs {
    /// Use a specific profile instead of the active one
    #[arg(long)]
    pub profile: Option<String>,
    /// [claude only] Skip permission prompts
    #[arg(long)]
    pub yolo: bool,
    /// Arguments passed through to the coder CLI
    #[arg(trailing_var_arg = true, allow_hyphen_values = true)]
    pub args: Vec<String>,
}

#[derive(Args)]
pub struct ProvidersArgs {
    #[command(subcommand)]
    pub command: Option<ProvidersCommand>,
}

#[derive(Subcommand)]
pub enum ProvidersCommand {
    #[command(alias = "ls")]
    List,
    #[command(alias = "new")]
    Add(ProviderAddArgs),
    #[command(alias = "rm", alias = "delete")]
    Remove {
        id: Option<String>,
        #[arg(long, short = 'q')]
        quiet: bool,
    },
    #[command(alias = "info")]
    Show { id: String },
}

#[derive(Args)]
pub struct ProviderAddArgs {
    #[arg(long, short = 'i')]
    pub id: Option<String>,
    #[arg(long, short = 'n')]
    pub name: Option<String>,
    #[arg(long, short = 'd')]
    pub display_name: Option<String>,
    #[arg(long, short = 'u')]
    pub base_url: Option<String>,
    #[arg(long, short = 't')]
    pub auth_type: Option<String>,
    #[arg(long, short = 'm')]
    pub models: Option<String>, // 逗号分隔
    #[arg(long, short = 'q')]
    pub quiet: bool,
}

#[derive(Args)]
pub struct GroupArgs {
    #[command(subcommand)]
    pub command: Option<GroupCommand>,
}

#[derive(Subcommand)]
pub enum GroupCommand {
    #[command(alias = "ls")]
    List,
    #[command(alias = "new")]
    Create {
        name: Option<String>,
        #[arg(long)]
        profiles: Option<String>,
    }, // 逗号分隔
    #[command(alias = "update")]
    Edit {
        name: Option<String>,
        #[arg(long = "name")]
        new_name: Option<String>,
        #[arg(long)]
        profiles: Option<String>,
    },
    #[command(alias = "rm")]
    Delete {
        name: String,
        #[arg(long, short = 'f')]
        force: bool,
    },
    SetDefault {
        name: String,
    },
    #[command(alias = "info")]
    Show {
        name: String,
    },
}
