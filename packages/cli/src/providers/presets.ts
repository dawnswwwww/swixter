import type { ProviderPreset } from "../types.js";
import { loadUserProviders } from "./user-providers.js";

/**
 * Anthropic official API preset (for Claude)
 */
export const anthropicPreset: ProviderPreset = {
  id: "anthropic",
  name: "Anthropic",
  displayName: "Anthropic (Official)",
  baseURL: "https://api.anthropic.com",
  defaultModels: [],  // Empty - using modelFamilies instead
  modelFamilies: [
    {
      id: "sonnet",
      name: "Sonnet",
      models: [
        "claude-sonnet-4-20250514",
        "claude-3-5-sonnet-20241022",
      ],
    },
    {
      id: "haiku",
      name: "Haiku",
      models: [
        "claude-3-5-haiku-20241022",
      ],
    },
    {
      id: "opus",
      name: "Opus",
      models: [
        "claude-3-opus-20240229",
      ],
    },
  ],
  authType: "api-key",
  headers: {
    "anthropic-version": "2023-06-01",
  },
  docs: "https://docs.anthropic.com/",
  wire_api: "responses",
  env_key: "ANTHROPIC_API_KEY",
};

/**
 * Ollama local model preset (for Qwen and other local models)
 */
export const ollamaPreset: ProviderPreset = {
  id: "ollama",
  name: "Ollama",
  displayName: "Ollama (Local models)",
  baseURL: "http://localhost:11434",
  defaultModels: [
    "qwen2.5-coder:7b",
    "qwen2.5-coder:14b",
    "qwen2.5-coder:32b",
    "qwen2.5:7b",
    "qwen2.5:14b",
  ],
  authType: "custom", // Ollama does not require authentication
  docs: "https://ollama.com/library",
  wire_api: "chat",
  env_key: "OLLAMA_API_KEY",
};

/**
 * Groq - Fast inference with Llama and Gemma models
 */
export const groqPreset: ProviderPreset = {
  id: "groq",
  name: "Groq",
  displayName: "Groq",
  baseURL: "https://api.groq.com/openai/v1",
  defaultModels: [
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
    "gemma2-9b-it",
  ],
  authType: "api-key",
  docs: "https://console.groq.com/docs",
  wire_api: "chat",
  env_key: "GROQ_API_KEY",
};

/**
 * DeepSeek - High性价比 AI models
 * OpenAI compatible: https://api.deepseek.com (chat)
 * Anthropic API: https://api.deepseek.com/anthropic (responses)
 */
export const deepseekPreset: ProviderPreset = {
  id: "deepseek",
  name: "DeepSeek",
  displayName: "DeepSeek",
  baseURL: "https://api.deepseek.com/anthropic",
  baseURLChat: "https://api.deepseek.com",
  defaultModels: [
    "deepseek-chat",
    "deepseek-coder",
  ],
  authType: "api-key",
  docs: "https://platform.deepseek.com/",
  wire_api: "chat",
  env_key: "DEEPSEEK_API_KEY",
};

/**
 * Moonshot (Kimi) - 长上下文 AI models
 */
export const moonshotPreset: ProviderPreset = {
  id: "moonshot",
  name: "Moonshot",
  displayName: "Moonshot (Kimi)",
  baseURL: "https://api.moonshot.cn/v1",
  defaultModels: [
    "moonshot-v1-128k",
    "moonshot-v1-32k",
    "moonshot-v1-8k",
  ],
  authType: "api-key",
  docs: "https://platform.moonshot.cn/",
  wire_api: "chat",
  env_key: "MOONSHOT_API_KEY",
};

/**
 * Together AI - Open source model platform
 */
export const togetherPreset: ProviderPreset = {
  id: "together",
  name: "Together AI",
  displayName: "Together AI",
  baseURL: "https://api.together.xyz",
  defaultModels: [],
  authType: "api-key",
  docs: "https://docs.together.ai/",
  wire_api: "chat",
  env_key: "TOGETHER_API_KEY",
};

/**
 * Fireworks AI - Rich model library with Qwen, DeepSeek, Llama
 */
export const fireworksPreset: ProviderPreset = {
  id: "fireworks",
  name: "Fireworks AI",
  displayName: "Fireworks AI",
  baseURL: "https://api.fireworks.ai/v1",
  defaultModels: [
    "qwen2.5-72b-instruct",
    "accounts/fireworks/models/llama-3.3-70b-instruct",
  ],
  authType: "api-key",
  docs: "https://docs.fireworks.ai/",
  wire_api: "chat",
  env_key: "FIREWORKS_API_KEY",
};

/**
 * 01.ai - Yi series models
 */
export const zeroonePreset: ProviderPreset = {
  id: "zeroone",
  name: "01.ai",
  displayName: "01.ai (零一万物)",
  baseURL: "https://api.01.ai/v1",
  defaultModels: [
    "yi-large",
    "yi-large-turbo",
  ],
  authType: "api-key",
  docs: "https://platform.01.ai/",
  wire_api: "chat",
  env_key: "ZEROONE_API_KEY",
};

/**
 * MiniMax CN - Chinese AI coding assistant (Token Plan)
 */
export const minimaxCnPreset: ProviderPreset = {
  id: "minimax-cn",
  name: "MiniMax CN",
  displayName: "MiniMax (CN)",
  baseURL: "https://api.minimaxi.com/anthropic",
  defaultModels: [
    "MiniMax-M2.7",
  ],
  authType: "api-key",
  docs: "https://platform.minimaxi.com/",
  wire_api: "responses",
  env_key: "ANTHROPIC_API_KEY",
  isChinese: true,
};

/**
 * MiniMax Global - International AI coding assistant (Token Plan)
 */
export const minimaxGlobalPreset: ProviderPreset = {
  id: "minimax-global",
  name: "MiniMax Global",
  displayName: "MiniMax (Global)",
  baseURL: "https://api.minimax.io/anthropic",
  defaultModels: [
    "MiniMax-M2.7",
  ],
  authType: "api-key",
  docs: "https://platform.minimax.io/",
  wire_api: "responses",
  env_key: "ANTHROPIC_API_KEY",
};

/**
 * Zhipu AI CN - Chinese GLM models (智谱AI)
 */
export const zhipuCnPreset: ProviderPreset = {
  id: "zhipu-cn",
  name: "Zhipu AI CN",
  displayName: "Zhipu AI (CN)",
  baseURL: "https://open.bigmodel.cn/api/anthropic",
  defaultModels: [
    "glm-4",
    "glm-4-flash",
  ],
  authType: "api-key",
  docs: "https://open.bigmodel.cn/",
  wire_api: "responses",
  env_key: "ANTHROPIC_API_KEY",
  isChinese: true,
};

/**
 * Zhipu AI Global - International GLM models (智谱AI)
 */
export const zhipuGlobalPreset: ProviderPreset = {
  id: "zhipu-global",
  name: "Zhipu AI Global",
  displayName: "Zhipu AI (Global)",
  baseURL: "https://api.z.ai/api/anthropic",
  defaultModels: [
    "glm-4",
    "glm-4-flash",
  ],
  authType: "api-key",
  docs: "https://docs.z.ai/",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
};

/**
 * Aliyun Dashscope - Qwen models on Alibaba Cloud (阿里云)
 */
export const dashscopePreset: ProviderPreset = {
  id: "dashscope",
  name: "Dashscope",
  displayName: "阿里云 Dashscope",
  baseURL: "https://coding.dashscope.aliyuncs.com/v1",
  defaultModels: [
    "qwen-coder-plus",
    "qwen-plus",
  ],
  authType: "api-key",
  docs: "https://bailian.console.aliyun.com/",
  wire_api: "chat",
  env_key: "DASHSCOPE_API_KEY",
  isChinese: true,
};

/**
 * Custom endpoint preset (template for third-party providers)
 */
export const customPreset: ProviderPreset = {
  id: "custom",
  name: "Custom",
  displayName: "Custom endpoint",
  baseURL: "",
  defaultModels: [],
  authType: "bearer",
  docs: "",
  wire_api: "chat",
  env_key: "OPENAI_API_KEY",
};

// ============================================================================
// Providers migrated from cc-switch
// ============================================================================

/**
 * StepFun - Chinese AI platform
 */
export const stepfunPreset: ProviderPreset = {
  id: "stepfun",
  name: "StepFun",
  displayName: "StepFun",
  baseURL: "https://api.stepfun.ai/v1",
  defaultModels: ["step-3.5-flash"],
  authType: "api-key",
  docs: "https://platform.stepfun.ai",
  wire_api: "chat",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * ModelScope - Chinese AI model hub (魔搭)
 */
export const modelscopePreset: ProviderPreset = {
  id: "modelscope",
  name: "ModelScope",
  displayName: "ModelScope (魔搭)",
  baseURL: "https://api-inference.modelscope.cn",
  defaultModels: ["ZhipuAI/GLM-5"],
  authType: "api-key",
  docs: "https://modelscope.cn",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * Longcat - Chinese AI platform
 */
export const longcatPreset: ProviderPreset = {
  id: "longcat",
  name: "Longcat",
  displayName: "Longcat",
  baseURL: "https://api.longcat.chat/anthropic",
  defaultModels: ["LongCat-Flash-Chat"],
  authType: "api-key",
  docs: "https://longcat.chat/platform",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * BaiLing - Alipay AI coding assistant (灵码)
 */
export const bailingPreset: ProviderPreset = {
  id: "bailing",
  name: "BaiLing",
  displayName: "BaiLing (灵码)",
  baseURL: "https://api.tbox.cn/api/anthropic",
  defaultModels: ["Ling-2.5-1T"],
  authType: "api-key",
  docs: "https://alipaytbox.yuque.com/sxs0ba/ling/get_started",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * SiliconFlow CN - Chinese AI platform
 */
export const siliconflowCnPreset: ProviderPreset = {
  id: "siliconflow-cn",
  name: "SiliconFlow CN",
  displayName: "SiliconFlow (CN)",
  baseURL: "https://api.siliconflow.cn",
  defaultModels: ["Pro/MiniMaxAI/MiniMax-M2.7"],
  authType: "api-key",
  docs: "https://siliconflow.cn",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * SiliconFlow Global - International AI platform
 */
export const siliconflowGlobalPreset: ProviderPreset = {
  id: "siliconflow-global",
  name: "SiliconFlow Global",
  displayName: "SiliconFlow (Global)",
  baseURL: "https://api.siliconflow.com",
  defaultModels: ["MiniMaxAI/MiniMax-M2.7"],
  authType: "api-key",
  docs: "https://siliconflow.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
};

/**
 * DMXAPI - Chinese AI aggregator
 */
export const dmxapiPreset: ProviderPreset = {
  id: "dmxapi",
  name: "DMXAPI",
  displayName: "DMXAPI",
  baseURL: "https://www.dmxapi.cn",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.dmxapi.cn",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * PackyCode - Chinese AI coding platform
 */
export const packycodePreset: ProviderPreset = {
  id: "packycode",
  name: "PackyCode",
  displayName: "PackyCode",
  baseURL: "https://www.packyapi.com",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.packyapi.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * Cubence - Chinese AI platform
 */
export const cubencePreset: ProviderPreset = {
  id: "cubence",
  name: "Cubence",
  displayName: "Cubence",
  baseURL: "https://api.cubence.com",
  defaultModels: [],
  authType: "api-key",
  docs: "https://cubence.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * AIGoCode - Chinese AI coding platform
 */
export const aigocodePreset: ProviderPreset = {
  id: "aigocode",
  name: "AIGoCode",
  displayName: "AIGoCode",
  baseURL: "https://api.aigocode.com",
  defaultModels: [],
  authType: "api-key",
  docs: "https://aigocode.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * RightCode - Chinese AI coding platform
 */
export const rightcodePreset: ProviderPreset = {
  id: "rightcode",
  name: "RightCode",
  displayName: "RightCode",
  baseURL: "https://www.right.codes/claude",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.right.codes",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * AICodeMirror - Chinese AI coding platform
 */
export const aicodemirrorPreset: ProviderPreset = {
  id: "aicodemirror",
  name: "AICodeMirror",
  displayName: "AICodeMirror",
  baseURL: "https://api.aicodemirror.com/api/claudecode",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.aicodemirror.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * AICoding - Chinese AI coding platform
 */
export const aicodingPreset: ProviderPreset = {
  id: "aicoding",
  name: "AICoding",
  displayName: "AICoding",
  baseURL: "https://api.aicoding.sh",
  defaultModels: [],
  authType: "api-key",
  docs: "https://aicoding.sh",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * CrazyRouter - Chinese AI aggregator
 */
export const crazyrouterPreset: ProviderPreset = {
  id: "crazyrouter",
  name: "CrazyRouter",
  displayName: "CrazyRouter",
  baseURL: "https://crazyrouter.com",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.crazyrouter.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * SSSAiCode - Chinese AI platform
 */
export const sssaiCodePreset: ProviderPreset = {
  id: "sssaicode",
  name: "SSSAiCode",
  displayName: "SSSAiCode",
  baseURL: "https://node-hk.sssaicode.com/api",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.sssaicode.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * Compshare - Chinese GPU cloud platform (云算力)
 */
export const compsharePreset: ProviderPreset = {
  id: "compshare",
  name: "Compshare",
  displayName: "Compshare (云算力)",
  baseURL: "https://api.modelverse.cn",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.compshare.cn",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * Micu - Chinese AI coding platform
 */
export const micuPreset: ProviderPreset = {
  id: "micu",
  name: "Micu",
  displayName: "Micu",
  baseURL: "https://www.openclaudecode.cn",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.openclaudecode.cn",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * X-Code API - Chinese AI platform
 */
export const xcodePreset: ProviderPreset = {
  id: "xcode",
  name: "X-Code API",
  displayName: "X-Code API",
  baseURL: "https://x-code.cc",
  defaultModels: [],
  authType: "api-key",
  docs: "https://x-code.cc",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * CTok.ai - Chinese AI platform
 */
export const ctokPreset: ProviderPreset = {
  id: "ctok",
  name: "CTok.ai",
  displayName: "CTok.ai",
  baseURL: "https://api.ctok.ai",
  defaultModels: [],
  authType: "api-key",
  docs: "https://ctok.ai",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * OpenRouter - International AI aggregator
 * Claude: https://openrouter.ai/api (Anthropic format)
 * Codex/Qwen: https://openrouter.ai/api/v1 (OpenAI Chat format)
 */
export const openrouterPreset: ProviderPreset = {
  id: "openrouter",
  name: "OpenRouter",
  displayName: "OpenRouter",
  baseURL: "https://openrouter.ai/api",
  baseURLChat: "https://openrouter.ai/api/v1",
  defaultModels: ["anthropic/claude-sonnet-4.6"],
  authType: "api-key",
  docs: "https://openrouter.ai",
  wire_api: "chat",
  env_key: "OPENAI_API_KEY",
};

/**
 * Novita AI - International AI aggregator
 */
export const novitaPreset: ProviderPreset = {
  id: "novita",
  name: "Novita AI",
  displayName: "Novita AI",
  baseURL: "https://api.novita.ai/anthropic",
  defaultModels: ["zai-org/glm-5"],
  authType: "api-key",
  docs: "https://novita.ai",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
};

/**
 * GitHub Copilot - GitHub AI coding assistant
 */
export const githubCopilotPreset: ProviderPreset = {
  id: "github-copilot",
  name: "GitHub Copilot",
  displayName: "GitHub Copilot",
  baseURL: "https://api.githubcopilot.com",
  defaultModels: ["claude-opus-4.6"],
  authType: "api-key",
  docs: "https://github.com/features/copilot",
  wire_api: "chat",
  env_key: "ANTHROPIC_AUTH_TOKEN",
};

/**
 * Nvidia NIM - NVIDIA AI platform
 */
export const nvidiaPreset: ProviderPreset = {
  id: "nvidia",
  name: "Nvidia NIM",
  displayName: "Nvidia NIM",
  baseURL: "https://integrate.api.nvidia.com",
  defaultModels: ["moonshotai/kimi-k2.5"],
  authType: "api-key",
  docs: "https://build.nvidia.com",
  wire_api: "chat",
  env_key: "ANTHROPIC_AUTH_TOKEN",
};

/**
 * Xiaomi MiMo - Xiaomi AI coding assistant
 */
export const xiaomiMimoPreset: ProviderPreset = {
  id: "xiaomi-mimo",
  name: "Xiaomi MiMo",
  displayName: "Xiaomi MiMo",
  baseURL: "https://api.xiaomimimo.com/anthropic",
  defaultModels: ["mimo-v2-pro"],
  authType: "api-key",
  docs: "https://platform.xiaomimimo.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * Bailian For Coding - Aliyun AI coding专用
 */
export const bailianForCodingPreset: ProviderPreset = {
  id: "bailian-coding",
  name: "Bailian For Coding",
  displayName: "阿里云百炼 (Coding)",
  baseURL: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
  defaultModels: [],
  authType: "api-key",
  docs: "https://bailian.console.aliyun.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * Kimi For Coding - Kimi coding专用
 */
export const kimiForCodingPreset: ProviderPreset = {
  id: "kimi-coding",
  name: "Kimi For Coding",
  displayName: "Kimi (Coding专用)",
  baseURL: "https://api.kimi.com/coding/",
  defaultModels: [],
  authType: "api-key",
  docs: "https://www.kimi.com/coding/docs/",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * DouBao Seed - ByteDance AI coding assistant (豆包)
 */
export const doubaoSeedPreset: ProviderPreset = {
  id: "doubao-seed",
  name: "DouBao Seed",
  displayName: "DouBao Seed (豆包)",
  baseURL: "https://ark.cn-beijing.volces.com/api/coding",
  defaultModels: ["doubao-seed-2-0-code-preview-latest"],
  authType: "api-key",
  docs: "https://www.volcengine.com/product/doubao",
  wire_api: "responses",
  env_key: "ANTHROPIC_AUTH_TOKEN",
  isChinese: true,
};

/**
 * AiHubMix - Chinese AI aggregator
 */
export const aihubmixPreset: ProviderPreset = {
  id: "aihubmix",
  name: "AiHubMix",
  displayName: "AiHubMix",
  baseURL: "https://aihubmix.com",
  defaultModels: [],
  authType: "api-key",
  docs: "https://aihubmix.com",
  wire_api: "responses",
  env_key: "ANTHROPIC_API_KEY",
  isChinese: true,
};

/**
 * Built-in preset providers list
 */
export const builtInPresets: ProviderPreset[] = [
  anthropicPreset,
  ollamaPreset,
  customPreset,
  // Overseas
  groqPreset,
  deepseekPreset,
  moonshotPreset,
  togetherPreset,
  fireworksPreset,
  zeroonePreset,
  // China
  minimaxCnPreset,
  minimaxGlobalPreset,
  zhipuCnPreset,
  zhipuGlobalPreset,
  dashscopePreset,
  // cc-switch migrated providers
  stepfunPreset,
  modelscopePreset,
  longcatPreset,
  bailingPreset,
  siliconflowCnPreset,
  siliconflowGlobalPreset,
  dmxapiPreset,
  packycodePreset,
  cubencePreset,
  aigocodePreset,
  rightcodePreset,
  aicodemirrorPreset,
  aicodingPreset,
  crazyrouterPreset,
  sssaiCodePreset,
  compsharePreset,
  micuPreset,
  xcodePreset,
  ctokPreset,
  openrouterPreset,
  novitaPreset,
  githubCopilotPreset,
  nvidiaPreset,
  xiaomiMimoPreset,
  bailianForCodingPreset,
  kimiForCodingPreset,
  doubaoSeedPreset,
  aihubmixPreset,
];

/**
 * Backward compatibility - synchronous access to built-in presets
 */
export const allPresets = builtInPresets;

/**
 * Get all providers (built-in + user-defined)
 * User-defined providers can override built-in ones with the same ID
 */
export async function getAllPresets(): Promise<ProviderPreset[]> {
  const userProviders = await loadUserProviders();
  const userProviderIds = new Set(userProviders.map(p => p.id));

  // Filter out built-in providers that are overridden by user providers
  const activeBuiltIns = builtInPresets.filter(p => !userProviderIds.has(p.id));

  // Merge: user providers take precedence
  return [...activeBuiltIns, ...userProviders];
}

/**
 * Get preset by ID (async version - checks both built-in and user-defined)
 */
export async function getPresetByIdAsync(id: string): Promise<ProviderPreset | undefined> {
  // Check user providers first (they can override built-in)
  const userProviders = await loadUserProviders();
  const userProvider = userProviders.find(p => p.id === id);

  if (userProvider) {
    return userProvider;
  }

  // Fall back to built-in
  return builtInPresets.find(preset => preset.id === id);
}

/**
 * Get preset by ID (synchronous version - only checks built-in presets)
 * Use this for backward compatibility and synchronous contexts
 */
export function getPresetById(id: string): ProviderPreset | undefined {
  return builtInPresets.find(preset => preset.id === id);
}

/**
 * Get all presets (excluding custom)
 */
export async function getStandardPresets(): Promise<ProviderPreset[]> {
  const allPresets = await getAllPresets();
  return allPresets.filter(preset => preset.id !== "custom");
}

/**
 * Get providers by wire API type
 * Filters providers based on their wire_api compatibility
 *
 * @param wireApi The wire API type to filter by ('chat' | 'responses')
 * @param includeUserProviders Whether to include user-defined providers (default: true)
 * @returns Array of providers matching the specified wire API type
 */
export async function getProvidersByWireApi(
  wireApi: 'chat' | 'responses',
  includeUserProviders: boolean = true
): Promise<ProviderPreset[]> {
  const allPresets = includeUserProviders ? await getAllPresets() : builtInPresets;

  return allPresets.filter(preset => {
    // If wire_api is not specified, assume 'chat' for backward compatibility
    const presetWireApi = preset.wire_api || 'chat';
    return presetWireApi === wireApi;
  });
}

/**
 * Get providers by wire API type (synchronous version - only built-in presets)
 *
 * @param wireApi The wire API type to filter by ('chat' | 'responses')
 * @returns Array of built-in providers matching the specified wire API type
 */
export function getBuiltInProvidersByWireApi(wireApi: 'chat' | 'responses'): ProviderPreset[] {
  return builtInPresets.filter(preset => {
    // If wire_api is not specified, assume 'chat' for backward compatibility
    const presetWireApi = preset.wire_api || 'chat';
    return presetWireApi === wireApi;
  });
}

/**
 * Alias for synchronous built-in access
 */
export function getBuiltInPresets(): ProviderPreset[] {
  return builtInPresets;
}

/**
 * Alias for synchronous built-in preset by ID
 */
export function getBuiltInPresetById(id: string): ProviderPreset | undefined {
  return getPresetById(id);
}
