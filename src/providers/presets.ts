import type { ProviderPreset } from "../types.js";

/**
 * Anthropic 官方 API 预设
 */
export const anthropicPreset: ProviderPreset = {
  id: "anthropic",
  name: "Anthropic",
  displayName: "Anthropic (官方)",
  baseURL: "https://api.anthropic.com",
  defaultModels: [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
  ],
  authType: "api-key",
  headers: {
    "anthropic-version": "2023-06-01",
  },
  docs: "https://docs.anthropic.com/",
};

/**
 * OpenRouter 预设
 */
export const openRouterPreset: ProviderPreset = {
  id: "openrouter",
  name: "OpenRouter",
  displayName: "OpenRouter (多模型聚合)",
  baseURL: "https://openrouter.ai/api/v1",
  defaultModels: [
    "anthropic/claude-3.5-sonnet",
    "anthropic/claude-3-opus",
    "anthropic/claude-3-sonnet",
    "anthropic/claude-3-haiku",
  ],
  authType: "bearer",
  docs: "https://openrouter.ai/docs",
};

/**
 * MiniMax (海螺AI) 预设
 */
export const minimaxPreset: ProviderPreset = {
  id: "minimax",
  name: "MiniMax",
  displayName: "MiniMax (海螺AI)",
  baseURL: "https://api.minimax.chat/v1",
  defaultModels: [
    "abab6.5s-chat",
    "abab6.5-chat",
    "abab6.5g-chat",
    "abab5.5s-chat",
    "abab5.5-chat",
  ],
  authType: "bearer",
  isChinese: true,
  docs: "https://platform.minimaxi.com/document",
};

/**
 * 智谱AI (BigModel/GLM) 预设
 */
export const zhipuPreset: ProviderPreset = {
  id: "zhipu",
  name: "Zhipu AI",
  displayName: "智谱AI (GLM)",
  baseURL: "https://open.bigmodel.cn/api/paas/v4",
  defaultModels: [
    "glm-4-plus",
    "glm-4-0520",
    "glm-4",
    "glm-4-air",
    "glm-4-airx",
    "glm-4-flash",
  ],
  authType: "bearer",
  isChinese: true,
  docs: "https://open.bigmodel.cn/dev/api",
};

/**
 * Moonshot (Kimi) 预设
 */
export const moonshotPreset: ProviderPreset = {
  id: "moonshot",
  name: "Moonshot",
  displayName: "Moonshot (Kimi)",
  baseURL: "https://api.moonshot.cn/v1",
  defaultModels: [
    "moonshot-v1-8k",
    "moonshot-v1-32k",
    "moonshot-v1-128k",
  ],
  authType: "bearer",
  isChinese: true,
  docs: "https://platform.moonshot.cn/docs",
};

/**
 * DeepSeek 预设
 */
export const deepseekPreset: ProviderPreset = {
  id: "deepseek",
  name: "DeepSeek",
  displayName: "DeepSeek",
  baseURL: "https://api.deepseek.com/v1",
  defaultModels: [
    "deepseek-chat",
    "deepseek-coder",
  ],
  authType: "bearer",
  isChinese: true,
  docs: "https://platform.deepseek.com/docs",
};

/**
 * 阿里云百炼 预设
 */
export const alibabaPreset: ProviderPreset = {
  id: "alibaba",
  name: "Alibaba Cloud",
  displayName: "阿里云百炼 (通义千问)",
  baseURL: "https://dashscope.aliyuncs.com/api/v1",
  defaultModels: [
    "qwen-max",
    "qwen-max-longcontext",
    "qwen-plus",
    "qwen-turbo",
    "qwen-long",
  ],
  authType: "bearer",
  isChinese: true,
  docs: "https://help.aliyun.com/zh/dashscope/",
};

/**
 * 腾讯混元 预设
 */
export const tencentPreset: ProviderPreset = {
  id: "tencent",
  name: "Tencent Hunyuan",
  displayName: "腾讯混元",
  baseURL: "https://hunyuan.tencentcloudapi.com",
  defaultModels: [
    "hunyuan-lite",
    "hunyuan-standard",
    "hunyuan-pro",
  ],
  authType: "custom",
  isChinese: true,
  docs: "https://cloud.tencent.com/document/product/1729",
};

/**
 * 字节豆包 预设
 */
export const volcenginePreset: ProviderPreset = {
  id: "volcengine",
  name: "Volcengine",
  displayName: "字节豆包 (火山引擎)",
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
  defaultModels: [
    "doubao-pro-32k",
    "doubao-pro-4k",
    "doubao-lite-32k",
    "doubao-lite-4k",
  ],
  authType: "bearer",
  isChinese: true,
  docs: "https://www.volcengine.com/docs/82379",
};

/**
 * AWS Bedrock 预设
 */
export const bedrockPreset: ProviderPreset = {
  id: "bedrock",
  name: "AWS Bedrock",
  displayName: "AWS Bedrock",
  baseURL: "https://bedrock-runtime.us-east-1.amazonaws.com",
  defaultModels: [
    "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "anthropic.claude-3-5-haiku-20241022-v1:0",
    "anthropic.claude-3-opus-20240229-v1:0",
  ],
  authType: "custom",
  docs: "https://docs.aws.amazon.com/bedrock/",
};

/**
 * 自定义端点预设（模板）
 */
export const customPreset: ProviderPreset = {
  id: "custom",
  name: "Custom",
  displayName: "自定义端点",
  baseURL: "",
  defaultModels: [],
  authType: "bearer",
  docs: "",
};

/**
 * 所有预设供应商列表
 */
export const allPresets: ProviderPreset[] = [
  // 国际服务商
  anthropicPreset,
  openRouterPreset,
  bedrockPreset,

  // 国内服务商
  minimaxPreset,
  zhipuPreset,
  moonshotPreset,
  deepseekPreset,
  alibabaPreset,
  tencentPreset,
  volcenginePreset,

  // 自定义
  customPreset,
];

/**
 * 按ID获取预设
 */
export function getPresetById(id: string): ProviderPreset | undefined {
  return allPresets.find(preset => preset.id === id);
}

/**
 * 获取所有国际服务商
 */
export function getInternationalPresets(): ProviderPreset[] {
  return allPresets.filter(preset => !preset.isChinese && preset.id !== "custom");
}

/**
 * 获取所有国内服务商
 */
export function getChinesePresets(): ProviderPreset[] {
  return allPresets.filter(preset => preset.isChinese);
}
