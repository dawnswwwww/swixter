# Add Provider Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 11 new provider presets to `src/providers/presets.ts` for popular AI API providers.

**Architecture:** Simple addition to `builtInPresets` array. Each preset follows the same `ProviderPreset` interface with `id`, `name`, `displayName`, `baseURL`, `defaultModels`, `authType`, `docs`, `wire_api`, and `env_key`.

**Tech Stack:** TypeScript, existing `ProviderPreset` type.

---

## File Structure

- Modify: `src/providers/presets.ts` — add 11 new preset objects and update `builtInPresets` array

---

## New Provider Presets to Add

### Overseas Providers (6)

| ID | displayName | Base URL | env_key | wire_api | defaultModels |
|----|-------------|----------|---------|----------|--------------|
| `groq` | Groq | `https://api.groq.com/openai/v1` | `GROQ_API_KEY` | chat | llama-3.3-70b-versatile, llama-3.1-8b-instant, gemma2-9b-it |
| `deepseek` | DeepSeek | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | chat | deepseek-chat, deepseek-coder |
| `moonshot` | Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `MOONSHOT_API_KEY` | chat | moonshot-v1-128k, moonshot-v1-32k |
| `together` | Together AI | `https://api.together.xyz` | `TOGETHER_API_KEY` | chat | deepseek-llm, llama-3.3-70b |
| `fireworks` | Fireworks AI | `https://api.fireworks.ai/v1` | `FIREWORKS_API_KEY` | chat | qwen2.5-72b-instruct, llama-3.3-70b |
| `zeroone` | 01.ai | `https://api.01.ai/v1` | `ZEROONE_API_KEY` | chat | yi-large, yi-large-turbo |

### China Providers (5)

| ID | displayName | Base URL | env_key | wire_api | defaultModels |
|----|-------------|----------|---------|----------|--------------|
| `minimax-cn` | MiniMax (CN) | `https://api.minimaxi.com/anthropic` | `ANTHROPIC_API_KEY` | responses | MiniMax-M2.7 |
| `minimax-global` | MiniMax (Global) | `https://api.minimax.io/anthropic` | `ANTHROPIC_API_KEY` | responses | MiniMax-M2.7 |
| `zhipu-cn` | Zhipu AI (CN) | `https://open.bigmodel.cn/api/paas/v4/` | `ZAI_API_KEY` | chat | glm-4, glm-3 |
| `zhipu-global` | Zhipu AI (Global) | `https://api.z.ai/api/anthropic` | `ANTHROPIC_AUTH_TOKEN` | responses | glm-4, glm-3 |
| `dashscope` | 阿里云 Dashscope | `https://coding.dashscope.aliyuncs.com/v1` | `DASHSCOPE_API_KEY` | chat | qwen-coder-plus |

---

## Tasks

### Task 1: Add Overseas Provider Presets

**Files:**
- Modify: `src/providers/presets.ts:66-70`

- [ ] **Step 1: Add Groq preset**

Add after `ollamaPreset` (line 46):

```typescript
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
```

- [ ] **Step 2: Add DeepSeek preset**

Add after `groqPreset`:

```typescript
/**
 * DeepSeek - High性价比 AI models
 */
export const deepseekPreset: ProviderPreset = {
  id: "deepseek",
  name: "DeepSeek",
  displayName: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  defaultModels: [
    "deepseek-chat",
    "deepseek-coder",
  ],
  authType: "api-key",
  docs: "https://platform.deepseek.com/",
  wire_api: "chat",
  env_key: "DEEPSEEK_API_KEY",
};
```

- [ ] **Step 3: Add Moonshot preset**

Add after `deepseekPreset`:

```typescript
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
```

- [ ] **Step 4: Add Together AI preset**

Add after `moonshotPreset`:

```typescript
/**
 * Together AI - Open source model platform
 */
export const togetherPreset: ProviderPreset = {
  id: "together",
  name: "Together AI",
  displayName: "Together AI",
  baseURL: "https://api.together.xyz",
  defaultModels: [
    "deepseek-llm-70b-chat",
    "meta-llama/Llama-3.3-70B-Instruct-Tour",
  ],
  authType: "api-key",
  docs: "https://docs.together.ai/",
  wire_api: "chat",
  env_key: "TOGETHER_API_KEY",
};
```

- [ ] **Step 5: Add Fireworks AI preset**

Add after `togetherPreset`:

```typescript
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
```

- [ ] **Step 6: Add 01.ai preset**

Add after `fireworksPreset`:

```typescript
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
```

### Task 2: Add China Provider Presets

**Files:**
- Modify: `src/providers/presets.ts:66-70`

- [ ] **Step 1: Add MiniMax CN preset**

Add after `zeroonePreset`:

```typescript
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
```

- [ ] **Step 2: Add MiniMax Global preset**

Add after `minimaxCnPreset`:

```typescript
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
```

- [ ] **Step 3: Add Zhipu AI CN preset**

Add after `minimaxGlobalPreset`:

```typescript
/**
 * Zhipu AI CN - Chinese GLM models (智谱AI)
 */
export const zhipuCnPreset: ProviderPreset = {
  id: "zhipu-cn",
  name: "Zhipu AI CN",
  displayName: "Zhipu AI (CN)",
  baseURL: "https://open.bigmodel.cn/api/paas/v4/",
  defaultModels: [
    "glm-4",
    "glm-4-flash",
  ],
  authType: "api-key",
  docs: "https://open.bigmodel.cn/",
  wire_api: "chat",
  env_key: "ZAI_API_KEY",
  isChinese: true,
};
```

- [ ] **Step 4: Add Zhipu AI Global preset**

Add after `zhipuCnPreset`:

```typescript
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
```

- [ ] **Step 5: Add Dashscope preset**

Add after `zhipuGlobalPreset`:

```typescript
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
```

### Task 3: Update builtInPresets Array

**Files:**
- Modify: `src/providers/presets.ts:66-70`

- [ ] **Step 1: Update builtInPresets array**

Replace current array:

```typescript
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
];
```

### Task 4: Verify and Test

**Files:**
- Modify: `src/providers/presets.ts`

- [ ] **Step 1: Run TypeScript build to check for errors**

Run: `bun run build`
Expected: No TypeScript errors

- [ ] **Step 2: Run existing tests**

Run: `bun test`
Expected: All tests pass

- [ ] **Step 3: Commit changes**

Run:
```bash
git add src/providers/presets.ts
git commit -m "feat: add 11 new provider presets (Groq, DeepSeek, Moonshot, Together, Fireworks, 01.ai, MiniMax CN/Global, Zhipu CN/Global, Dashscope)"
```
