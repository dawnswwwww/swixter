/**
 * 命令行参数解析器
 * 统一处理所有命令的参数解析逻辑
 */

import { resolveFlagAlias } from "../../constants/commands.js";
import type { OutputFormat } from "../../constants/commands.js";

/**
 * 基础标志接口
 */
export interface BaseFlags {
  help?: boolean;
  quiet?: boolean;
  verbose?: boolean;
  format?: OutputFormat;
}

/**
 * Create 命令选项
 */
export interface CreateOptions extends BaseFlags {
  name?: string;
  provider?: string;
  apiKey?: string;
  authToken?: string;
  baseUrl?: string;
  model?: string;
  apply?: boolean;
}

/**
 * Switch 命令选项
 */
export interface SwitchOptions extends BaseFlags {
  name?: string;
}

/**
 * Delete 命令选项
 */
export interface DeleteOptions extends BaseFlags {
  name?: string;
  names?: string; // 逗号分隔的多个名称
  force?: boolean;
  all?: boolean;
}

/**
 * Edit 命令选项
 */
export interface EditOptions extends BaseFlags {
  name?: string;
}

/**
 * Export 命令选项
 */
export interface ExportOptions extends BaseFlags {
  output?: string;
  profiles?: string; // 逗号分隔的配置名称
  sanitize?: boolean;
}

/**
 * Import 命令选项
 */
export interface ImportOptions extends BaseFlags {
  input?: string;
  overwrite?: boolean;
  skipSanitized?: boolean;
}

/**
 * Run 命令选项
 */
export interface RunOptions extends BaseFlags {
  profile?: string;
  [key: string]: any; // 允许传递任意其他参数给目标 CLI
}

/**
 * List 命令选项
 */
export interface ListOptions extends BaseFlags {
  namesOnly?: boolean;
}

/**
 * 通用参数解析函数
 * 支持：
 * - 长选项：--name value, --name=value
 * - 短选项：-n value, -n=value
 * - 布尔标志：--apply, -a
 * - 多个短选项组合：-qaf (表示 -q -a -f)
 */
export function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  let i = 0;

  while (i < args.length) {
    let arg = args[i];

    // 跳过非标志参数
    if (!arg.startsWith("-")) {
      i++;
      continue;
    }

    // 处理长选项: --name=value
    if (arg.includes("=")) {
      const [flag, value] = arg.split("=", 2);
      const resolvedFlag = resolveFlagAlias(flag).substring(2); // 移除 --
      flags[resolvedFlag] = value;
      i++;
      continue;
    }

    // 处理短选项组合: -qaf
    if (arg.startsWith("-") && !arg.startsWith("--") && arg.length > 2) {
      const chars = arg.substring(1);
      for (const char of chars) {
        const resolved = resolveFlagAlias(`-${char}`).substring(2);
        flags[resolved] = true;
      }
      i++;
      continue;
    }

    // 解析标志别名
    const resolvedArg = resolveFlagAlias(arg);
    const flagName = resolvedArg.substring(2); // 移除 -- 或 -

    // 查看下一个参数
    const nextArg = args[i + 1];

    // 如果下一个参数不是标志，则作为当前标志的值
    if (nextArg && !nextArg.startsWith("-")) {
      flags[flagName] = nextArg;
      i += 2;
    } else {
      // 否则是布尔标志
      flags[flagName] = true;
      i++;
    }
  }

  return flags;
}

/**
 * 获取位置参数（非标志参数）
 */
export function getPositionalArgs(args: string[]): string[] {
  const positional: string[] = [];
  let i = 0;

  while (i < args.length) {
    const arg = args[i];

    // 跳过标志
    if (arg.startsWith("-")) {
      // 如果标志有值（下一个参数不是标志），跳过两个
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-") && !arg.includes("=")) {
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    positional.push(arg);
    i++;
  }

  return positional;
}

/**
 * 解析 create 命令参数
 */
export function parseCreateArgs(args: string[]): CreateOptions {
  const flags = parseFlags(args);

  return {
    name: flags.name as string,
    provider: flags.provider as string,
    apiKey: flags["api-key"] as string,
    authToken: flags["auth-token"] as string,
    baseUrl: flags["base-url"] as string,
    model: flags.model as string,
    apply: flags.apply === true,
    quiet: flags.quiet === true,
    help: flags.help === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
  };
}

/**
 * 解析 switch 命令参数
 */
export function parseSwitchArgs(args: string[]): SwitchOptions {
  const flags = parseFlags(args);

  return {
    name: flags.name as string,
    help: flags.help === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
  };
}

/**
 * 解析 delete 命令参数
 */
export function parseDeleteArgs(args: string[]): DeleteOptions {
  const flags = parseFlags(args);

  return {
    name: flags.name as string,
    names: flags.names as string,
    force: flags.force === true,
    all: flags.all === true,
    help: flags.help === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
  };
}

/**
 * 解析 edit 命令参数
 */
export function parseEditArgs(args: string[]): EditOptions {
  const flags = parseFlags(args);

  return {
    name: flags.name as string,
    help: flags.help === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
  };
}

/**
 * 解析 export 命令参数
 */
export function parseExportArgs(args: string[]): ExportOptions {
  const positional = getPositionalArgs(args);
  const flags = parseFlags(args);

  return {
    output: (flags.output as string) || positional[0],
    profiles: flags.profiles as string,
    sanitize: flags.sanitize === true,
    help: flags.help === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
  };
}

/**
 * 解析 import 命令参数
 */
export function parseImportArgs(args: string[]): ImportOptions {
  const positional = getPositionalArgs(args);
  const flags = parseFlags(args);

  return {
    input: (flags.input as string) || positional[0],
    overwrite: flags.overwrite === true,
    skipSanitized: flags["skip-sanitized"] === true,
    help: flags.help === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
  };
}

/**
 * 解析 run 命令参数
 */
export function parseRunArgs(args: string[]): RunOptions {
  const flags = parseFlags(args);

  return {
    profile: flags.profile as string,
    help: flags.help === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
    ...flags, // 保留所有其他参数传递给目标 CLI
  };
}

/**
 * 解析 list 命令参数
 */
export function parseListArgs(args: string[]): ListOptions {
  const flags = parseFlags(args);

  return {
    namesOnly: flags["names-only"] === true,
    help: flags.help === true,
    quiet: flags.quiet === true,
    verbose: flags.verbose === true,
    format: flags.format as OutputFormat,
  };
}

/**
 * 检查是否请求帮助
 */
export function isHelpRequested(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

/**
 * 获取第一个非标志参数（通常是命令名或子命令）
 */
export function getFirstCommand(args: string[]): string | undefined {
  return getPositionalArgs(args)[0];
}
