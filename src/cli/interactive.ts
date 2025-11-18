import * as p from "@clack/prompts";
import pc from "picocolors";
import type { ClaudeCodeProfile, ProviderPreset } from "../types.js";
import { allPresets, getPresetById } from "../providers/presets.js";
import {
  upsertProfile,
  setActiveProfile,
  getActiveProfile,
  listProfiles,
  deleteProfile,
} from "../config/manager.js";
import { exportConfig, importConfig } from "../config/export.js";

/**
 * 显示欢迎界面
 */
export function showWelcome(): void {
  console.clear();
  p.intro(pc.bgCyan(pc.black(" Swixter - Claude Code 配置管理工具 ")));
}

/**
 * 主菜单
 */
export async function showMainMenu(): Promise<string> {
  const currentProfile = await getActiveProfile();
  const currentInfo = currentProfile
    ? pc.dim(`当前: ${currentProfile.name} (${getPresetById(currentProfile.providerId)?.displayName})`)
    : pc.dim("未配置");

  const action = await p.select({
    message: `选择操作 ${currentInfo}`,
    options: [
      { value: "create", label: "创建新配置", hint: "配置新的供应商和模型" },
      { value: "switch", label: "切换配置", hint: "在已有配置间切换" },
      { value: "list", label: "查看所有配置", hint: "列出所有保存的配置" },
      { value: "delete", label: "删除配置", hint: "删除不需要的配置" },
      { value: "export", label: "导出配置", hint: "导出配置到文件" },
      { value: "import", label: "导入配置", hint: "从文件导入配置" },
      { value: "providers", label: "查看支持的供应商", hint: "列出所有预设供应商" },
      { value: "exit", label: "退出" },
    ],
  });

  if (p.isCancel(action)) {
    return "exit";
  }

  return action as string;
}

/**
 * 创建新配置
 */
export async function createProfile(): Promise<void> {
  const group = await p.group(
    {
      profileName: () =>
        p.text({
          message: "配置名称",
          placeholder: "my-config",
          validate: (value) => {
            if (!value) return "配置名称不能为空";
            if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
              return "只能包含字母、数字、下划线和连字符";
            }
          },
        }),

      provider: () =>
        p.select({
          message: "选择供应商",
          options: allPresets.map((preset) => ({
            value: preset.id,
            label: preset.displayName,
            hint: preset.isChinese ? "🇨🇳" : "🌐",
          })),
        }),

      customUrl: ({ results }) => {
        const preset = getPresetById(results.provider as string);
        if (preset?.id === "custom") {
          return p.text({
            message: "自定义 API URL",
            placeholder: "https://api.example.com/v1",
            validate: (value) => {
              if (!value) return "URL 不能为空";
              try {
                new URL(value);
              } catch {
                return "请输入有效的 URL";
              }
            },
          });
        }
      },

      model: ({ results }) => {
        const preset = getPresetById(results.provider as string);
        if (preset && preset.id !== "custom") {
          return p.select({
            message: "选择模型",
            options: preset.defaultModels.map((model) => ({
              value: model,
              label: model,
            })),
          });
        } else {
          return p.text({
            message: "输入模型名称",
            placeholder: "model-name",
            validate: (value) => {
              if (!value) return "模型名称不能为空";
            },
          });
        }
      },

      apiKey: () =>
        p.password({
          message: "API Key",
          validate: (value) => {
            if (!value) return "API Key 不能为空";
          },
        }),

      confirm: ({ results }) => {
        const preset = getPresetById(results.provider as string);
        return p.confirm({
          message: `确认创建配置 "${results.profileName}"？`,
          initialValue: true,
        });
      },
    },
    {
      onCancel: () => {
        p.cancel("操作已取消");
        process.exit(0);
      },
    }
  );

  if (!group.confirm) {
    p.cancel("已取消创建配置");
    return;
  }

  const s = p.spinner();
  s.start("正在保存配置...");

  try {
    const preset = getPresetById(group.provider);
    const profile: ClaudeCodeProfile = {
      name: group.profileName,
      providerId: group.provider,
      apiKey: group.apiKey,
      model: group.model,
      baseURL: group.customUrl || preset?.baseURL,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await upsertProfile(profile);
    await setActiveProfile(profile.name);

    s.stop("配置创建成功！");
    p.note(
      `配置名称: ${pc.cyan(profile.name)}\n供应商: ${pc.green(preset?.displayName)}\n模型: ${pc.yellow(profile.model)}`,
      "新配置详情"
    );
  } catch (error) {
    s.stop("保存失败");
    p.log.error(`错误: ${error}`);
  }
}

/**
 * 切换配置
 */
export async function switchProfile(): Promise<void> {
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    p.log.warn("没有可用的配置，请先创建一个");
    return;
  }

  const current = await getActiveProfile();

  const selected = await p.select({
    message: "选择要切换的配置",
    options: profiles.map((profile) => {
      const preset = getPresetById(profile.providerId);
      const isCurrent = current?.name === profile.name;
      return {
        value: profile.name,
        label: isCurrent ? `${profile.name} ${pc.green("(当前)")}` : profile.name,
        hint: `${preset?.displayName} - ${profile.model}`,
      };
    }),
  });

  if (p.isCancel(selected)) {
    p.cancel("操作已取消");
    return;
  }

  const s = p.spinner();
  s.start("正在切换配置...");

  try {
    await setActiveProfile(selected as string);
    s.stop("切换成功！");
    p.log.success(`已切换到: ${pc.cyan(selected)}`);
  } catch (error) {
    s.stop("切换失败");
    p.log.error(`错误: ${error}`);
  }
}

/**
 * 列出所有配置
 */
export async function showProfiles(): Promise<void> {
  const profiles = await listProfiles();
  const current = await getActiveProfile();

  if (profiles.length === 0) {
    p.log.warn("还没有任何配置");
    return;
  }

  const lines = profiles.map((profile) => {
    const preset = getPresetById(profile.providerId);
    const isCurrent = current?.name === profile.name;
    const marker = isCurrent ? pc.green("●") : pc.dim("○");
    return `${marker} ${pc.cyan(profile.name.padEnd(20))} ${pc.dim("|")} ${preset?.displayName.padEnd(25)} ${pc.dim("|")} ${pc.yellow(profile.model)}`;
  });

  p.note(lines.join("\n"), `配置列表 (共 ${profiles.length} 个)`);
}

/**
 * 删除配置
 */
export async function removeProfile(): Promise<void> {
  const profiles = await listProfiles();

  if (profiles.length === 0) {
    p.log.warn("没有可删除的配置");
    return;
  }

  const selected = await p.select({
    message: "选择要删除的配置",
    options: profiles.map((profile) => ({
      value: profile.name,
      label: profile.name,
      hint: getPresetById(profile.providerId)?.displayName,
    })),
  });

  if (p.isCancel(selected)) {
    p.cancel("操作已取消");
    return;
  }

  const confirm = await p.confirm({
    message: `确认删除配置 "${selected}"？`,
    initialValue: false,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.cancel("已取消删除");
    return;
  }

  const s = p.spinner();
  s.start("正在删除配置...");

  try {
    await deleteProfile(selected as string);
    s.stop("删除成功！");
    p.log.success(`已删除配置: ${pc.cyan(selected)}`);
  } catch (error) {
    s.stop("删除失败");
    p.log.error(`错误: ${error}`);
  }
}

/**
 * 导出配置
 */
export async function exportProfiles(): Promise<void> {
  const group = await p.group(
    {
      filePath: () =>
        p.text({
          message: "导出文件路径",
          placeholder: "./swixter-config.json",
          defaultValue: "./swixter-config.json",
        }),

      sanitize: () =>
        p.confirm({
          message: "是否脱敏 API Key？",
          initialValue: true,
        }),
    },
    {
      onCancel: () => {
        p.cancel("操作已取消");
      },
    }
  );

  if (p.isCancel(group.filePath)) {
    return;
  }

  const s = p.spinner();
  s.start("正在导出配置...");

  try {
    await exportConfig(group.filePath, {
      sanitizeKeys: group.sanitize,
    });
    s.stop("导出成功！");
    p.log.success(`配置已导出到: ${pc.cyan(group.filePath)}`);
  } catch (error) {
    s.stop("导出失败");
    p.log.error(`错误: ${error}`);
  }
}

/**
 * 导入配置
 */
export async function importProfiles(): Promise<void> {
  const group = await p.group(
    {
      filePath: () =>
        p.text({
          message: "导入文件路径",
          placeholder: "./swixter-config.json",
          validate: (value) => {
            if (!value) return "文件路径不能为空";
          },
        }),

      overwrite: () =>
        p.confirm({
          message: "是否覆盖已存在的同名配置？",
          initialValue: false,
        }),
    },
    {
      onCancel: () => {
        p.cancel("操作已取消");
      },
    }
  );

  if (p.isCancel(group.filePath)) {
    return;
  }

  const s = p.spinner();
  s.start("正在导入配置...");

  try {
    const result = await importConfig(group.filePath, {
      overwrite: group.overwrite,
    });

    s.stop("导入完成！");
    p.note(
      `成功导入: ${pc.green(result.imported)} 个\n跳过: ${pc.yellow(result.skipped)} 个\n错误: ${pc.red(result.errors.length)} 个`,
      "导入结果"
    );

    if (result.errors.length > 0) {
      p.log.error("错误详情:\n" + result.errors.join("\n"));
    }
  } catch (error) {
    s.stop("导入失败");
    p.log.error(`错误: ${error}`);
  }
}

/**
 * 显示所有供应商
 */
export async function showProviders(): Promise<void> {
  const international = allPresets.filter((p) => !p.isChinese && p.id !== "custom");
  const chinese = allPresets.filter((p) => p.isChinese);

  const intLines = international.map(
    (p) => `  ${pc.cyan(p.displayName.padEnd(30))} ${pc.dim(p.baseURL)}`
  );

  const cnLines = chinese.map(
    (p) => `  ${pc.cyan(p.displayName.padEnd(30))} ${pc.dim(p.baseURL)}`
  );

  console.log();
  p.note(intLines.join("\n"), pc.green("🌐 国际服务商"));
  console.log();
  p.note(cnLines.join("\n"), pc.green("🇨🇳 国内服务商"));
  console.log();
}
