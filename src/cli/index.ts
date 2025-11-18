import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  showWelcome,
  showMainMenu,
  createProfile,
  switchProfile,
  showProfiles,
  removeProfile,
  exportProfiles,
  importProfiles,
  showProviders,
} from "./interactive.js";
import { getActiveProfile, setActiveProfile, listProfiles, upsertProfile, deleteProfile } from "../config/manager.js";
import { exportConfig, importConfig } from "../config/export.js";
import { getPresetById } from "../providers/presets.js";
import type { ClaudeCodeProfile } from "../types.js";

const COMMANDS = {
  list: "列出所有配置",
  "create-profile": "创建新配置（非交互式）",
  "delete-profile": "删除配置",
  switch: "切换配置",
  export: "导出配置",
  import: "导入配置",
  providers: "查看支持的供应商",
  help: "显示帮助信息",
} as const;

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
${pc.bold(pc.cyan("Swixter - Claude Code 配置管理工具"))}

${pc.bold("用法：")}
  ${pc.green("bun run cli")}              启动交互式界面
  ${pc.green("bun run cli <command>")}    执行指定命令

${pc.bold("命令：")}
  ${pc.cyan("list")}                   列出所有配置
  ${pc.cyan("create-profile")}         创建新配置（非交互式）
  ${pc.cyan("delete-profile <name>")}  删除指定配置
  ${pc.cyan("switch <name>")}          切换到指定配置
  ${pc.cyan("export <file>")}          导出配置到文件
  ${pc.cyan("import <file>")}          从文件导入配置
  ${pc.cyan("providers")}              查看所有支持的供应商
  ${pc.cyan("help")}                   显示此帮助信息

${pc.bold("非交互式创建配置:")}
  ${pc.green("bun run cli create-profile --name <name> --provider <id> --model <model> --api-key <key>")}

${pc.bold("示例：")}
  ${pc.dim("# 启动交互式界面")}
  ${pc.green("bun run cli")}

  ${pc.dim("# 列出所有配置")}
  ${pc.green("bun run cli list")}

  ${pc.dim("# 创建配置（非交互式）")}
  ${pc.green('bun run cli create-profile --name my-config --provider anthropic --model claude-3-5-sonnet-20241022 --api-key sk-ant-xxx')}

  ${pc.dim("# 切换配置")}
  ${pc.green("bun run cli switch my-config")}

  ${pc.dim("# 删除配置")}
  ${pc.green("bun run cli delete-profile my-config")}

  ${pc.dim("# 导出配置（不脱敏）")}
  ${pc.green("bun run cli export config.json")}

  ${pc.dim("# 导入配置")}
  ${pc.green("bun run cli import config.json")}

${pc.dim("更多信息: https://github.com/your-repo/swixter")}
`);
}

/**
 * 解析命令行参数
 */
function parseArgs(args: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith("--")) {
        parsed[key] = value;
        i++;
      }
    }
  }

  return parsed;
}

/**
 * 执行 create-profile 命令（非交互式）
 */
async function cmdCreateProfile(args: string[]): Promise<void> {
  const params = parseArgs(args);

  // 验证必需参数
  if (!params.name) {
    console.log(pc.red("错误: 缺少 --name 参数"));
    console.log(pc.dim("用法: bun run cli create-profile --name <name> --provider <id> --model <model> --api-key <key>"));
    process.exit(1);
  }

  if (!params.provider) {
    console.log(pc.red("错误: 缺少 --provider 参数"));
    process.exit(1);
  }

  if (!params.model) {
    console.log(pc.red("错误: 缺少 --model 参数"));
    process.exit(1);
  }

  if (!params["api-key"]) {
    console.log(pc.red("错误: 缺少 --api-key 参数"));
    process.exit(1);
  }

  // 验证 provider 是否存在
  const preset = getPresetById(params.provider);
  if (!preset) {
    console.log(pc.red(`错误: 未知的供应商 ID: ${params.provider}`));
    console.log(pc.dim("运行 'bun run cli providers' 查看所有支持的供应商"));
    process.exit(1);
  }

  try {
    const profile: ClaudeCodeProfile = {
      name: params.name,
      providerId: params.provider,
      apiKey: params["api-key"],
      model: params.model,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // 只在有自定义baseURL时才设置
    if (params["base-url"]) {
      profile.baseURL = params["base-url"];
    }

    await upsertProfile(profile);
    await setActiveProfile(profile.name);

    console.log();
    console.log(pc.green("✓") + " 配置创建成功！");
    console.log();
    console.log(`  配置名称: ${pc.cyan(profile.name)}`);
    console.log(`  供应商: ${pc.yellow(preset.displayName)}`);
    console.log(`  模型: ${pc.yellow(profile.model)}`);
    console.log();
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ 创建失败: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * 执行 delete-profile 命令
 */
async function cmdDeleteProfile(profileName: string): Promise<void> {
  if (!profileName) {
    console.log(pc.red("错误: 请指定配置名称"));
    console.log(pc.dim("用法: bun run cli delete-profile <name>"));
    process.exit(1);
  }

  try {
    await deleteProfile(profileName);
    console.log();
    console.log(pc.green("✓") + " 删除成功！");
    console.log(`  配置: ${pc.cyan(profileName)}`);
    console.log();
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ 删除失败: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * 执行 list 命令
 */
async function cmdList(): Promise<void> {
  const profiles = await listProfiles();
  const current = await getActiveProfile();

  if (profiles.length === 0) {
    console.log(pc.yellow("还没有任何配置"));
    console.log(pc.dim("运行 'bun run cli' 创建新配置"));
    return;
  }

  console.log();
  console.log(pc.bold("配置列表:"));
  console.log();

  for (const profile of profiles) {
    const preset = getPresetById(profile.providerId);
    const isCurrent = current?.name === profile.name;
    const marker = isCurrent ? pc.green("●") : pc.dim("○");
    console.log(
      `${marker} ${pc.cyan(profile.name.padEnd(20))} ${pc.dim("|")} ${preset?.displayName.padEnd(25)} ${pc.dim("|")} ${pc.yellow(profile.model)}`
    );
  }

  console.log();
  console.log(pc.dim(`共 ${profiles.length} 个配置`));
  console.log();
}

/**
 * 执行 switch 命令
 */
async function cmdSwitch(profileName: string): Promise<void> {
  if (!profileName) {
    console.log(pc.red("错误: 请指定配置名称"));
    console.log(pc.dim("用法: bun run cli switch <name>"));
    process.exit(1);
  }

  try {
    await setActiveProfile(profileName);
    const profile = await getActiveProfile();
    const preset = getPresetById(profile!.providerId);

    console.log();
    console.log(pc.green("✓") + " 切换成功！");
    console.log();
    console.log(`  配置: ${pc.cyan(profile!.name)}`);
    console.log(`  供应商: ${pc.yellow(preset?.displayName)}`);
    console.log(`  模型: ${pc.yellow(profile!.model)}`);
    console.log();
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ 切换失败: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * 执行 export 命令
 */
async function cmdExport(filePath: string): Promise<void> {
  if (!filePath) {
    console.log(pc.red("错误: 请指定导出文件路径"));
    console.log(pc.dim("用法: bun run cli export <file>"));
    process.exit(1);
  }

  try {
    await exportConfig(filePath, { sanitizeKeys: false });
    console.log();
    console.log(pc.green("✓") + " 导出成功！");
    console.log(`  文件: ${pc.cyan(filePath)}`);
    console.log();
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ 导出失败: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * 执行 import 命令
 */
async function cmdImport(filePath: string): Promise<void> {
  if (!filePath) {
    console.log(pc.red("错误: 请指定导入文件路径"));
    console.log(pc.dim("用法: bun run cli import <file>"));
    process.exit(1);
  }

  try {
    const result = await importConfig(filePath, { overwrite: false });
    console.log();
    console.log(pc.green("✓") + " 导入完成！");
    console.log();
    console.log(`  成功导入: ${pc.green(result.imported)} 个`);
    console.log(`  跳过: ${pc.yellow(result.skipped)} 个`);
    console.log(`  错误: ${pc.red(result.errors.length)} 个`);
    console.log();

    if (result.errors.length > 0) {
      console.log(pc.red("错误详情:"));
      result.errors.forEach((err) => console.log(pc.red(`  - ${err}`)));
      console.log();
    }
  } catch (error) {
    console.log();
    console.log(pc.red(`✗ 导入失败: ${error}`));
    console.log();
    process.exit(1);
  }
}

/**
 * 执行 providers 命令
 */
async function cmdProviders(): Promise<void> {
  const { allPresets } = await import("../providers/presets.js");

  const international = allPresets.filter((p) => !p.isChinese && p.id !== "custom");
  const chinese = allPresets.filter((p) => p.isChinese);

  console.log();
  console.log(pc.bold(pc.green("🌐 国际服务商:")));
  console.log();
  international.forEach((p) => {
    console.log(`  ${pc.cyan(p.displayName.padEnd(30))} ${pc.dim(p.baseURL)}`);
  });

  console.log();
  console.log(pc.bold(pc.green("🇨🇳 国内服务商:")));
  console.log();
  chinese.forEach((p) => {
    console.log(`  ${pc.cyan(p.displayName.padEnd(30))} ${pc.dim(p.baseURL)}`);
  });

  console.log();
}

/**
 * 交互式模式
 */
async function interactiveMode(): Promise<void> {
  showWelcome();

  let running = true;

  while (running) {
    const action = await showMainMenu();

    switch (action) {
      case "create":
        await createProfile();
        break;
      case "switch":
        await switchProfile();
        break;
      case "list":
        await showProfiles();
        break;
      case "delete":
        await removeProfile();
        break;
      case "export":
        await exportProfiles();
        break;
      case "import":
        await importProfiles();
        break;
      case "providers":
        await showProviders();
        break;
      case "exit":
        running = false;
        break;
    }

    if (running) {
      console.log();
      const continuePrompt = await p.confirm({
        message: "继续操作？",
        initialValue: true,
      });

      if (p.isCancel(continuePrompt) || !continuePrompt) {
        running = false;
      }

      console.clear();
      showWelcome();
    }
  }

  p.outro(pc.green("感谢使用 Swixter！"));
}

/**
 * 主入口
 */
export async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (!command) {
      // 无参数，启动交互式模式
      await interactiveMode();
    } else if (command === "help" || command === "--help" || command === "-h") {
      showHelp();
    } else if (command === "list") {
      await cmdList();
    } else if (command === "create-profile") {
      await cmdCreateProfile(args.slice(1));
    } else if (command === "delete-profile") {
      await cmdDeleteProfile(args[1]);
    } else if (command === "switch") {
      await cmdSwitch(args[1]);
    } else if (command === "export") {
      await cmdExport(args[1]);
    } else if (command === "import") {
      await cmdImport(args[1]);
    } else if (command === "providers") {
      await cmdProviders();
    } else {
      console.log(pc.red(`未知命令: ${command}`));
      console.log(pc.dim("运行 'bun run cli help' 查看帮助"));
      process.exit(1);
    }
  } catch (error) {
    console.error(pc.red("发生错误:"), error);
    process.exit(1);
  }
}

// 运行主函数
main();
