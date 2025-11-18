import { z } from "zod";

/**
 * 认证类型
 */
export type AuthType = "bearer" | "api-key" | "custom";

/**
 * 供应商预设配置
 */
export interface ProviderPreset {
  /** 供应商唯一ID */
  id: string;
  /** 供应商名称 */
  name: string;
  /** 供应商显示名称（支持中文） */
  displayName: string;
  /** API基础URL */
  baseURL: string;
  /** 默认支持的模型列表 */
  defaultModels: string[];
  /** 认证类型 */
  authType: AuthType;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 速率限制配置 */
  rateLimit?: {
    requestsPerMinute?: number;
    tokensPerMinute?: number;
  };
  /** 文档链接 */
  docs?: string;
  /** 是否为国内服务 */
  isChinese?: boolean;
}

/**
 * Claude Code 配置 Profile
 */
export interface ClaudeCodeProfile {
  /** Profile名称 */
  name: string;
  /** 供应商ID */
  providerId: string;
  /** API Key */
  apiKey: string;
  /** 选择的模型 */
  model: string;
  /** API基础URL（可覆盖预设） */
  baseURL?: string;
  /** 自定义请求头（可扩展预设） */
  headers?: Record<string, string>;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}

/**
 * 配置文件结构
 */
export interface ConfigFile {
  /** 当前激活的profile */
  activeProfile: string;
  /** 所有profiles */
  profiles: Record<string, ClaudeCodeProfile>;
  /** 配置版本 */
  version: string;
}

/**
 * 导出配置结构
 */
export interface ExportConfig {
  /** 导出的profiles */
  profiles: ClaudeCodeProfile[];
  /** 导出时间 */
  exportedAt: string;
  /** 配置版本 */
  version: string;
  /** 是否脱敏API Key */
  sanitized?: boolean;
}

// Zod Schemas for validation

export const ProviderPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  baseURL: z.string().url(),
  defaultModels: z.array(z.string()),
  authType: z.enum(["bearer", "api-key", "custom"]),
  headers: z.record(z.string(), z.string()).optional(),
  rateLimit: z.object({
    requestsPerMinute: z.number().optional(),
    tokensPerMinute: z.number().optional(),
  }).optional(),
  docs: z.string().url().optional(),
  isChinese: z.boolean().optional(),
});

export const ClaudeCodeProfileSchema = z.object({
  name: z.string().min(1),
  providerId: z.string(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ConfigFileSchema = z.object({
  activeProfile: z.string(),
  profiles: z.record(z.string(), ClaudeCodeProfileSchema),
  version: z.string(),
});

export const ExportConfigSchema = z.object({
  profiles: z.array(ClaudeCodeProfileSchema),
  exportedAt: z.string(),
  version: z.string(),
  sanitized: z.boolean().optional(),
});
