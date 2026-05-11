/**
 * Shell 自动补全生成器
 * 支持 Bash, Zsh, 和 Fish
 */

import { allPresets } from "../providers/presets.js";
import { VALID_COMMANDS, GLOBAL_COMMANDS, COMMAND_ALIASES } from "../constants/commands.js";

/**
 * 生成 Bash 补全脚本
 */
export function generateBashCompletion(): string {
  const coders = ["claude", "qwen", "codex"];
  const commands = [...VALID_COMMANDS];
  const globalCommands = [...GLOBAL_COMMANDS];
  const providers = allPresets.map((p) => p.id);
  const aliases = Object.keys(COMMAND_ALIASES);

  return `# Swixter Bash completion script
# Installation:
#   swixter completion bash > ~/.local/share/bash-completion/completions/swixter
#   OR
#   swixter completion bash | sudo tee /etc/bash_completion.d/swixter

_swixter() {
  local cur prev opts
  COMPREPLY=()
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  # Get the first command (coder name)
  local coder=""
  if [ "\${#COMP_WORDS[@]}" -gt 1 ]; then
    coder="\${COMP_WORDS[1]}"
  fi

  case "\${COMP_CWORD}" in
    1)
      # First argument: coder name or global command
      opts="${coders.join(" ")} ${globalCommands.join(" ")}"
      ;;
    2)
      # Second argument: command name
      case "\${prev}" in
        claude|qwen|codex)
          opts="${commands.join(" ")} ${aliases.join(" ")} --help"
          ;;
        export)
          opts="--output --profiles --sanitize --help"
          ;;
        import)
          opts="--input --overwrite --skip-sanitized --help"
          ;;
        completion)
          opts="bash zsh fish"
          ;;
        *)
          return 0
          ;;
      esac
      ;;
    *)
      # Further arguments: flags and values
      local cmd="\${COMP_WORDS[2]}"

      case "\${prev}" in
        --name|-n)
          # Autocomplete profile names
          if [[ "\${coder}" =~ ^(claude|qwen|codex)$ ]]; then
            opts="\$(swixter \${coder} list --names-only 2>/dev/null || echo '')"
          fi
          ;;
        --provider|-p)
          # Autocomplete provider names
          opts="${providers.join(" ")}"
          ;;
        --format)
          opts="table json yaml"
          ;;
        --output|-o|--input|-i)
          # File completion
          COMPREPLY=( \$(compgen -f -- "\${cur}") )
          return 0
          ;;
        *)
          # Command-specific flags
          case "\${cmd}" in
            create|new)
              opts="--name -n --provider -p --api-key -k --auth-token -t --base-url -u --model -m --apply -a --quiet -q --help -h"
              ;;
            switch|sw)
              opts="--name -n --help -h"
              ;;
            delete|rm)
              opts="--name -n --names --force -f --all --help -h"
              ;;
            edit|update)
              opts="--name -n --help -h"
              ;;
            list|ls)
              opts="--format --names-only --help -h"
              ;;
            current)
              opts="--format --help -h"
              ;;
            run)
              opts="--profile --help -h"
              ;;
            export)
              opts="--output -o --profiles --sanitize --help -h"
              ;;
            import)
              opts="--input -i --overwrite --skip-sanitized --help -h"
              ;;
            *)
              opts="--help -h"
              ;;
          esac
          ;;
      esac
      ;;
  esac

  if [ -n "\${opts}" ]; then
    COMPREPLY=( \$(compgen -W "\${opts}" -- "\${cur}") )
  fi
}

complete -F _swixter swixter
`;
}

/**
 * 生成 Zsh 补全脚本
 */
export function generateZshCompletion(): string {
  const coders = ["claude", "qwen", "codex"];
  const commands = [...VALID_COMMANDS];
  const globalCommands = [...GLOBAL_COMMANDS];
  const providers = allPresets.map((p) => p.id);

  return `#compdef swixter
# Swixter Zsh completion script
# Installation:
#   swixter completion zsh > ~/.zfunc/_swixter
#   Add to ~/.zshrc: fpath=(~/.zfunc $fpath) && autoload -Uz compinit && compinit

_swixter() {
  local -a coders commands global_commands providers

  coders=(${coders.join(" ")})
  commands=(${commands.join(" ")})
  global_commands=(${globalCommands.join(" ")})
  providers=(${providers.join(" ")})

  local context state state_descr line
  typeset -A opt_args

  _arguments -C \\
    '1: :->coder_or_global' \\
    '2: :->command' \\
    '*:: :->args'

  case "\$state" in
    coder_or_global)
      _describe 'coders' coders
      _describe 'global commands' global_commands
      ;;
    command)
      case "\${words[2]}" in
        claude|qwen|codex)
          _describe 'commands' commands
          _arguments '--help[Show help]'
          ;;
        completion)
          _values 'shell' bash zsh fish
          ;;
      esac
      ;;
    args)
      local coder="\${words[2]}"
      local cmd="\${words[3]}"

      case "\${cmd}" in
        create|new)
          _arguments \\
            '--name[Configuration name]:name:' \\
            '-n[Configuration name]:name:' \\
            '--provider[Provider ID]:provider:('"$providers"')' \\
            '-p[Provider ID]:provider:('"$providers"')' \\
            '--api-key[API key]:key:' \\
            '-k[API key]:key:' \\
            '--auth-token[Auth token]:token:' \\
            '-t[Auth token]:token:' \\
            '--base-url[Base URL]:url:' \\
            '-u[Base URL]:url:' \\
            '--model[Model name]:model:' \\
            '-m[Model name]:model:' \\
            '--apply[Apply after creation]' \\
            '-a[Apply after creation]' \\
            '--quiet[Non-interactive mode]' \\
            '-q[Non-interactive mode]' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
        switch|sw)
          _arguments \\
            '--name[Profile name]:name:_swixter_profiles' \\
            '-n[Profile name]:name:_swixter_profiles' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
        delete|rm)
          _arguments \\
            '--name[Profile name]:name:_swixter_profiles' \\
            '-n[Profile name]:name:_swixter_profiles' \\
            '--names[Multiple profiles]:names:' \\
            '--force[Skip confirmation]' \\
            '-f[Skip confirmation]' \\
            '--all[Delete all profiles]' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
        edit|update)
          _arguments \\
            '--name[Profile name]:name:_swixter_profiles' \\
            '-n[Profile name]:name:_swixter_profiles' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
        list|ls)
          _arguments \\
            '--format[Output format]:format:(table json yaml)' \\
            '--names-only[Show names only]' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
        current)
          _arguments \\
            '--format[Output format]:format:(table json yaml)' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
        run)
          _arguments \\
            '--profile[Profile name]:name:_swixter_profiles' \\
            '--help[Show help]' \\
            '-h[Show help]' \\
            '*: :_default'
          ;;
        export)
          _arguments \\
            '--output[Output file]:file:_files' \\
            '-o[Output file]:file:_files' \\
            '--profiles[Profile names]:names:' \\
            '--sanitize[Sanitize API keys]' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
        import)
          _arguments \\
            '--input[Input file]:file:_files' \\
            '-i[Input file]:file:_files' \\
            '--overwrite[Overwrite existing]' \\
            '--skip-sanitized[Skip sanitized profiles]' \\
            '--help[Show help]' \\
            '-h[Show help]'
          ;;
      esac
      ;;
  esac
}

# Helper function to complete profile names
_swixter_profiles() {
  local coder="\${words[2]}"
  if [[ "\${coder}" =~ ^(claude|qwen|codex)$ ]]; then
    local profiles
    profiles=("\${(@f)\$(swixter \${coder} list --names-only 2>/dev/null)}")
    _describe 'profiles' profiles
  fi
}

_swixter "\$@"
`;
}

/**
 * 生成 Fish 补全脚本
 */
export function generateFishCompletion(): string {
  const coders = ["claude", "qwen", "codex"];
  const commands = [...VALID_COMMANDS];
  const globalCommands = [...GLOBAL_COMMANDS];
  const providers = allPresets.map((p) => p.id);

  return `# Swixter Fish completion script
# Installation:
#   swixter completion fish > ~/.config/fish/completions/swixter.fish

# Remove all existing completions
complete -c swixter -e

# Global commands
${globalCommands.map((cmd) => `complete -c swixter -n "__fish_use_subcommand" -a "${cmd}" -d "Global command"`).join("\n")}

# Coders
${coders.map((coder) => `complete -c swixter -n "__fish_use_subcommand" -a "${coder}" -d "Manage ${coder} configurations"`).join("\n")}

# Commands for each coder
${commands
  .map(
    (cmd) => `complete -c swixter -n "__fish_seen_subcommand_from ${coders.join(" ")}" -a "${cmd}" -d "Command: ${cmd}"`
  )
  .join("\n")}

# Completion shell types
complete -c swixter -n "__fish_seen_subcommand_from completion" -a "bash" -d "Bash completion"
complete -c swixter -n "__fish_seen_subcommand_from completion" -a "zsh" -d "Zsh completion"
complete -c swixter -n "__fish_seen_subcommand_from completion" -a "fish" -d "Fish completion"

# Common flags
complete -c swixter -s h -l help -d "Show help"
complete -c swixter -s q -l quiet -d "Quiet mode"
complete -c swixter -s v -l verbose -d "Verbose mode"
complete -c swixter -l format -d "Output format" -xa "table json yaml"

# Create/new command flags
complete -c swixter -n "__fish_seen_subcommand_from create new" -s n -l name -d "Configuration name" -r
complete -c swixter -n "__fish_seen_subcommand_from create new" -s p -l provider -d "Provider ID" -xa "${providers.join(" ")}"
complete -c swixter -n "__fish_seen_subcommand_from create new" -s k -l api-key -d "API key" -r
complete -c swixter -n "__fish_seen_subcommand_from create new" -s t -l auth-token -d "Auth token" -r
complete -c swixter -n "__fish_seen_subcommand_from create new" -s u -l base-url -d "Base URL" -r
complete -c swixter -n "__fish_seen_subcommand_from create new" -s m -l model -d "Model name" -r
complete -c swixter -n "__fish_seen_subcommand_from create new" -s a -l apply -d "Apply after creation"

# Switch/sw command flags
complete -c swixter -n "__fish_seen_subcommand_from switch sw" -s n -l name -d "Profile name" -r

# Delete/rm command flags
complete -c swixter -n "__fish_seen_subcommand_from delete rm" -s n -l name -d "Profile name" -r
complete -c swixter -n "__fish_seen_subcommand_from delete rm" -l names -d "Multiple profiles (comma-separated)" -r
complete -c swixter -n "__fish_seen_subcommand_from delete rm" -s f -l force -d "Skip confirmation"
complete -c swixter -n "__fish_seen_subcommand_from delete rm" -l all -d "Delete all profiles"

# Edit/update command flags
complete -c swixter -n "__fish_seen_subcommand_from edit update" -s n -l name -d "Profile name" -r

# List/ls command flags
complete -c swixter -n "__fish_seen_subcommand_from list ls" -l names-only -d "Show names only"

# Run/r command flags
complete -c swixter -n "__fish_seen_subcommand_from run r" -l profile -d "Profile name" -r

# Export command flags
complete -c swixter -n "__fish_seen_subcommand_from export" -s o -l output -d "Output file" -r
complete -c swixter -n "__fish_seen_subcommand_from export" -l profiles -d "Profile names" -r
complete -c swixter -n "__fish_seen_subcommand_from export" -l sanitize -d "Sanitize API keys"

# Import command flags
complete -c swixter -n "__fish_seen_subcommand_from import" -s i -l input -d "Input file" -r
complete -c swixter -n "__fish_seen_subcommand_from import" -l overwrite -d "Overwrite existing"
complete -c swixter -n "__fish_seen_subcommand_from import" -l skip-sanitized -d "Skip sanitized profiles"
`;
}

/**
 * 生成指定 shell 的补全脚本
 */
export function generateCompletion(shell: "bash" | "zsh" | "fish"): string {
  switch (shell) {
    case "bash":
      return generateBashCompletion();
    case "zsh":
      return generateZshCompletion();
    case "fish":
      return generateFishCompletion();
    default:
      throw new Error(`Unsupported shell: ${shell}`);
  }
}

/**
 * 显示补全安装说明
 */
export function showCompletionInstructions(shell: "bash" | "zsh" | "fish"): void {
  console.log(`
生成 ${shell.toUpperCase()} 自动补全脚本：

${shell === "bash" ? `# Bash 补全安装方式 1（用户级别）：
swixter completion bash > ~/.local/share/bash-completion/completions/swixter
source ~/.local/share/bash-completion/completions/swixter

# Bash 补全安装方式 2（系统级别，需要 sudo）：
swixter completion bash | sudo tee /etc/bash_completion.d/swixter
source /etc/bash_completion.d/swixter` : ""}${shell === "zsh" ? `# Zsh 补全安装：
mkdir -p ~/.zfunc
swixter completion zsh > ~/.zfunc/_swixter

# 添加到 ~/.zshrc：
echo 'fpath=(~/.zfunc $fpath)' >> ~/.zshrc
echo 'autoload -Uz compinit && compinit' >> ~/.zshrc

# 重新加载 shell：
source ~/.zshrc` : ""}${shell === "fish" ? `# Fish 补全安装：
swixter completion fish > ~/.config/fish/completions/swixter.fish

# Fish 会自动加载，无需额外配置` : ""}

安装后，你可以使用 TAB 键自动补全命令、参数和配置名称。
`);
}
