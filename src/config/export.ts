import { existsSync } from "node:fs";
import type { ExportConfig, ClaudeCodeProfile } from "../types.js";
import { ExportConfigSchema } from "../types.js";
import { loadConfig, saveConfig } from "./manager.js";

const EXPORT_VERSION = "1.0.0";

/**
 * 脱敏 API Key
 */
function sanitizeApiKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return "***";
  }
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  return `${start}***${end}`;
}

/**
 * 导出配置
 */
export async function exportConfig(
  filePath: string,
  options: {
    sanitizeKeys?: boolean;
    profileNames?: string[];
  } = {}
): Promise<void> {
  const { sanitizeKeys = false, profileNames } = options;

  const config = await loadConfig();
  let profilesToExport: ClaudeCodeProfile[];

  // 选择要导出的 profiles
  if (profileNames && profileNames.length > 0) {
    profilesToExport = profileNames
      .map(name => config.profiles[name])
      .filter(Boolean);

    if (profilesToExport.length === 0) {
      throw new Error("没有找到要导出的 Profile");
    }
  } else {
    profilesToExport = Object.values(config.profiles);
  }

  if (profilesToExport.length === 0) {
    throw new Error("没有可导出的 Profile");
  }

  // 脱敏处理
  if (sanitizeKeys) {
    profilesToExport = profilesToExport.map(profile => ({
      ...profile,
      apiKey: sanitizeApiKey(profile.apiKey),
    }));
  }

  const exportData: ExportConfig = {
    profiles: profilesToExport,
    exportedAt: new Date().toISOString(),
    version: EXPORT_VERSION,
    sanitized: sanitizeKeys,
  };

  // 验证导出数据
  ExportConfigSchema.parse(exportData);

  // 写入文件
  const content = JSON.stringify(exportData, null, 2);
  await Bun.write(filePath, content);
}

/**
 * 导入配置
 */
export async function importConfig(
  filePath: string,
  options: {
    overwrite?: boolean;
    skipSanitized?: boolean;
  } = {}
): Promise<{ imported: number; skipped: number; errors: string[] }> {
  const { overwrite = false, skipSanitized = true } = options;

  if (!existsSync(filePath)) {
    throw new Error(`文件不存在: ${filePath}`);
  }

  // 读取文件
  const file = Bun.file(filePath);
  const content = await file.text();
  const data = JSON.parse(content);

  // 验证导入数据
  let importData: ExportConfig;
  try {
    importData = ExportConfigSchema.parse(data);
  } catch (error) {
    throw new Error(`导入文件格式无效: ${error}`);
  }

  // 如果配置已脱敏且设置跳过，则报错
  if (importData.sanitized && skipSanitized) {
    throw new Error(
      "导入的配置文件包含脱敏的 API Key，无法导入。请使用完整的配置文件或设置 skipSanitized=false"
    );
  }

  const config = await loadConfig();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of importData.profiles) {
    try {
      const exists = profile.name in config.profiles;

      // 检查是否需要跳过
      if (exists && !overwrite) {
        skipped++;
        continue;
      }

      // 更新时间戳
      const now = new Date().toISOString();
      config.profiles[profile.name] = {
        ...profile,
        createdAt: exists ? config.profiles[profile.name].createdAt : now,
        updatedAt: now,
      };

      imported++;
    } catch (error) {
      errors.push(`导入 "${profile.name}" 失败: ${error}`);
    }
  }

  // 如果导入了至少一个 profile，保存配置
  if (imported > 0) {
    await saveConfig(config);
  }

  return { imported, skipped, errors };
}

/**
 * 验证导出文件
 */
export async function validateExportFile(filePath: string): Promise<{
  valid: boolean;
  error?: string;
  profileCount?: number;
  sanitized?: boolean;
}> {
  try {
    if (!existsSync(filePath)) {
      return { valid: false, error: "文件不存在" };
    }

    const file = Bun.file(filePath);
    const content = await file.text();
    const data = JSON.parse(content);

    const importData = ExportConfigSchema.parse(data);

    return {
      valid: true,
      profileCount: importData.profiles.length,
      sanitized: importData.sanitized,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
