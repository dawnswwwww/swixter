/**
 * CLI 命令别名和参数映射配置
 */

/**
 * 命令别名映射
 * 用于支持常用命令的缩写形式
 */
export const COMMAND_ALIASES = {
  // 常用命令缩写
  r: "run",
  ls: "list",
  sw: "switch",
  rm: "delete",
  new: "create",

  // 旧命令兼容
  "create-profile": "create",
  "delete-profile": "delete",
  "list-profiles": "list",
  "switch-profile": "switch",
} as const;

/**
 * 参数别名映射（短选项）
 * 将短选项映射到完整的 flag 名称
 */
export const FLAG_ALIASES = {
  "-n": "--name",
  "-p": "--provider",
  "-k": "--api-key",
  "-t": "--auth-token",
  "-u": "--base-url",
  "-m": "--model",
  "-a": "--apply",
  "-q": "--quiet",
  "-f": "--force",
  "-h": "--help",
  "-o": "--output",
  "-i": "--input",
  "-y": "--yes",
  "-v": "--verbose",
} as const;

/**
 * 支持的输出格式
 */
export const OUTPUT_FORMATS = ["table", "json", "yaml"] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * 命令列表（用于验证和帮助）
 */
export const VALID_COMMANDS = [
  "create",
  "list",
  "switch",
  "edit",
  "apply",
  "current",
  "delete",
  "run",
  "doctor",
] as const;

/**
 * 全局命令（不需要 coder 前缀）
 */
export const GLOBAL_COMMANDS = [
  "providers",
  "export",
  "import",
  "completion",
  "doctor",
  "help",
  "version",
] as const;

/**
 * 解析命令别名
 */
export function resolveCommandAlias(command: string): string {
  return COMMAND_ALIASES[command as keyof typeof COMMAND_ALIASES] || command;
}

/**
 * 解析参数别名
 */
export function resolveFlagAlias(flag: string): string {
  return FLAG_ALIASES[flag as keyof typeof FLAG_ALIASES] || flag;
}

/**
 * 检查是否为有效命令
 */
export function isValidCommand(command: string): boolean {
  const resolved = resolveCommandAlias(command);
  return VALID_COMMANDS.includes(resolved as any) ||
         GLOBAL_COMMANDS.includes(resolved as any);
}

/**
 * 检查是否为全局命令
 */
export function isGlobalCommand(command: string): boolean {
  const resolved = resolveCommandAlias(command);
  return GLOBAL_COMMANDS.includes(resolved as any);
}
