# Dual API Provider Design

> **Status**: Draft - Awaiting user review
> **Date**: 2026-04-01

## Context

当前的 ProviderPreset 使用单一的 `baseURL`、`wire_api`、`defaultModels` 等字段。但很多 AI 服务商（如智谱 AI、MiniMax）同时支持 Anthropic-compatible API 和 OpenAI-compatible API两种接口。

用户需要在配置 provider 时，同时定义两种 API 的配置；在创建 profile 时，根据 coder 类型自动选择对应的配置。

---

## 1. 数据结构设计

### 1.1 新增 ApiConfig 接口

```typescript
interface ApiConfig {
  /** API Base URL */
  baseURL: string;
  /** Default supported model list */
  defaultModels: string[];
  /** Custom request headers */
  headers?: Record<string, string>;
  /** Model family hierarchy (for Anthropic API) */
  modelFamilies?: ModelFamily[];
  /** Environment variable name for API key */
  env_key?: string;
}
```

### 1.2 更新 ProviderPreset 接口

```typescript
interface ProviderPreset {
  /** Provider unique ID */
  id: string;
  /** Provider name */
  name: string;
  /** Provider display name */
  displayName: string;
  /** Authentication type */
  authType: AuthType;
  /** Documentation link */
  docs?: string;
  /** Whether it's a Chinese domestic service */
  isChinese?: boolean;

  // === 新结构：双 API 配置 ===

  /** Anthropic-compatible API configuration */
  anthropic?: ApiConfig;

  /** OpenAI-compatible API configuration */
  openai?: ApiConfig;
}
```

### 1.3 现有 Provider 更新示例

**智谱 AI (同时支持两种 API)**：
```typescript
export const zhipuCnPreset: ProviderPreset = {
  id: "zhipu-cn",
  name: "Zhipu AI CN",
  displayName: "Zhipu AI (CN)",
  authType: "api-key",
  docs: "https://open.bigmodel.cn/",
  isChinese: true,

  anthropic: {
    baseURL: "https://open.bigmodel.cn/api/anthropic",
    defaultModels: [],
    modelFamilies: [
      { id: "glm-4", name: "GLM-4", models: ["glm-4", "glm-4-flash"] },
    ],
    env_key: "ANTHROPIC_API_KEY",
  },

  openai: {
    baseURL: "https://open.bigmodel.cn/api/paas/v4/",
    defaultModels: ["glm-4", "glm-4-flash"],
    env_key: "ZAI_API_KEY",
  },
};
```

**Anthropic (仅支持 Anthropic API)**：
```typescript
export const anthropicPreset: ProviderPreset = {
  id: "anthropic",
  name: "Anthropic",
  displayName: "Anthropic (Official)",
  authType: "api-key",
  docs: "https://docs.anthropic.com/",

  anthropic: {
    baseURL: "https://api.anthropic.com",
    defaultModels: [],
    modelFamilies: [
      { id: "sonnet", name: "Sonnet", models: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022"] },
      { id: "haiku", name: "Haiku", models: ["claude-3-5-haiku-20241022"] },
      { id: "opus", name: "Opus", models: ["claude-3-opus-20240229"] },
    ],
    headers: { "anthropic-version": "2023-06-01" },
    env_key: "ANTHROPIC_API_KEY",
  },
};
```

**Groq (仅支持 OpenAI API)**：
```typescript
export const groqPreset: ProviderPreset = {
  id: "groq",
  name: "Groq",
  displayName: "Groq",
  authType: "api-key",
  docs: "https://console.groq.com/docs",

  openai: {
    baseURL: "https://api.groq.com/openai/v1",
    defaultModels: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it"],
    env_key: "GROQ_API_KEY",
  },
};
```

---

## 2. 向后兼容性

### 2.1 迁移策略

**全面重构**：现有字段（`baseURL`、`wire_api`、`defaultModels`）全部移除，迁移到新的双 API 结构。

### 2.2 迁移清单

| Provider | 旧配置 | 新配置 |
|----------|--------|--------|
| anthropic | baseURL + wire_api: responses | anthropic.* |
| ollama | baseURL + wire_api: chat | openai.* |
| groq | baseURL + wire_api: chat | openai.* |
| deepseek | baseURL + wire_api: chat | openai.* |
| moonshot | baseURL + wire_api: chat | openai.* |
| together | baseURL + wire_api: chat | openai.* |
| fireworks | baseURL + wire_api: chat | openai.* |
| zeroone | baseURL + wire_api: chat | openai.* |
| minimax-cn | baseURL + wire_api: responses | anthropic.* |
| minimax-global | baseURL + wire_api: responses | anthropic.* |
| zhipu-cn | ~~chat~~ → responses | anthropic.* + openai.* |
| zhipu-global | baseURL + wire_api: responses | anthropic.* |
| dashscope | baseURL + wire_api: chat | openai.* |
| custom | baseURL + wire_api: chat | openai.* |

---

## 3. Profile 创建 UI 变化

### 3.1 API 类型选择

**逻辑**：
- 如果 provider 只支持一种 API：隐藏 API 类型选择器
- 如果 provider 同时支持两种 API：显示 API 类型下拉菜单

**UI 组件**：
```tsx
// Provider 选择后
<ProviderSelect />

// API 类型选择（仅当 provider 同时支持两种 API 时显示）
{provider.anthropic && provider.openai && (
  <ApiTypeSelect options={["anthropic", "openai"]} />
)}
```

### 3.2 模型选择

**Claude Code Profile (anthropic API)**：
1. 选择模型家族（Sonnet / Haiku / Opus）
2. 根据选择的家族显示对应的模型列表

**OpenAI-compatible Profile**：
1. 直接显示模型下拉列表

```tsx
// Anthropic API 模型选择
<FamilySelect families={provider.anthropic.modelFamilies} />
<ModelSelect models={selectedFamilyModels} />

// OpenAI API 模型选择
<ModelSelect models={provider.openai.defaultModels} />
```

### 3.3 Coder 类型与 API 映射

| Coder | API 类型 | 配置来源 |
|-------|----------|----------|
| Claude Code | responses | provider.anthropic |
| Qwen | responses | provider.anthropic |
| Codex | chat | provider.openai |
| Continue.dev | chat | provider.openai |

---

## 4. Profile 模型字段映射

### 4.1 Claude Code Profile (models 字段)

```typescript
interface ClaudeCodeProfile {
  // ... existing fields

  models?: {
    anthropicModel?: string;       // ANTHROPIC_MODEL
    defaultHaikuModel?: string;   // ANTHROPIC_DEFAULT_HAIKU_MODEL
    defaultOpusModel?: string;    // ANTHROPIC_DEFAULT_OPUS_MODEL
    defaultSonnetModel?: string;  // ANTHROPIC_DEFAULT_SONNET_MODEL
  };
}
```

### 4.2 OpenAI-compatible Profile (model 字段)

```typescript
interface ClaudeCodeProfile {
  model?: string;  // OPENAI_MODEL
}
```

---

## 5. 文件修改清单

### 类型定义
- `src/types.ts` - 新增 `ApiConfig` 接口，更新 `ProviderPreset`
- `src/providers/presets.ts` - 更新所有 provider preset

### UI 组件
- `ui/src/api/types.ts` - 同步更新 UI 类型
- `ui/src/components/ui/Modal.tsx` - API 类型选择 + 模型选择 UI
- `ui/src/utils/model-helper.ts` - 可能需要新增辅助函数

### 测试
- `tests/presets.test.ts` - 更新现有测试
- 新增测试验证双 API 配置

---

## 6. 验证方案

1. **构建测试**: `bun run build` 无错误
2. **类型检查**: `tsc --noEmit` 无错误
3. **UI 功能测试**:
   - 创建 Claude Code profile → 显示 Anthropic API 配置
   - 创建 Codex profile → 显示 OpenAI API 配置
   - 选择双 API provider → 显示 API 类型选择器
   - 选择单 API provider → 隐藏 API 类型选择器
4. **现有测试**: `bun test` 全部通过

---

## 7. 后续扩展（可选）

- 模型元数据（速度/成本/上下文窗口）
- 模型搜索/过滤
- 按 Provider+API 类型统计使用情况
