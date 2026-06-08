# Claude `--yolo` 标志设计文档

> **Status**: Draft - Awaiting user review
> **Date**: 2026-06-08
> **Type**: Feature Addition

## Context

Claude Code CLI 提供 `--dangerously-skip-permissions` 标志,跳过所有权限确认提示直接执行命令。在自动化脚本和 CI 场景下非常实用,但该标志名较长(31 字符),日常使用繁琐。

Swixter 作为 Claude Code 的配置管理工具,提供一个简短别名 `--yolo` 改善使用体验。用户输入 `--yolo`,由 swixter 在内部改写为 `--dangerously-skip-permissions` 后透传给 claude CLI,claude 始终只看到官方标志(零侵入、向前兼容)。

## 1. 设计目标

1. **简短别名**: `--yolo` 替代 `--dangerously-skip-permissions`
2. **零侵入**: claude CLI 始终只看到官方标志,不受 swixter 引入的"私有"标志影响
3. **幂等去重**: 用户同时传 `--yolo` 和 `--dangerously-skip-permissions` 时不重复
4. **范围克制**: 只作用于 `run`/`r` 命令,不动 profile、不动其他 coder

## 2. 现状分析

### 2.1 现有透传机制

`packages/cli/src/cli/claude.ts:1131-1184` 的 `spawnClaudeWithEnv` 已经处理两类工作:

1. **过滤 `--profile` 及其值** —— 避免 swixter 私有标志泄漏给 claude
2. **注入 `--settings <tmp.json>`** —— 通过临时 settings 文件覆盖 env 变量

`--yolo` 属于同一类工作(用户友好别名 → 真实 claude CLI 参数),适合放在同一处。

### 2.2 现有参数解析路径

- `cmdRun` 调用 `parseFlags(args)` 得到 `params`
- `parseRunArgs`(`packages/cli/src/cli/commands/parsers.ts:288-299`)对 `run` 命令使用 `...flags` 透传所有未识别参数
- 因此 `--yolo` 会被 `parseFlags` 解析为 `flags.yolo = true`,**无需修改 parsers.ts**

### 2.3 短选项冲突

`packages/cli/src/constants/commands.ts:28-44` 中:
- `-y` 已被 `--yes` 占用
- `-t` 已被 `--auth-token` 占用

因此本设计**不提供短选项**。

## 3. 修复方案

### 3.1 源码改动(单文件)

**`packages/cli/src/cli/claude.ts`**

#### 3.1.1 `spawnClaudeWithEnv` 签名

```ts
export async function spawnClaudeWithEnv(
  args: string[],
  env: Record<string, string>,
  options?: {
    profileName?: string;
    providerDisplayName?: string;
    baseURL?: string;
    yolo?: boolean;        // ← 新增
    onExit?: () => void | Promise<void>;
  }
): Promise<void> {
```

#### 3.1.2 `spawnClaudeWithEnv` 过滤逻辑

在已有 `--profile` 过滤之后增加 `--yolo` 过滤:

```ts
const claudeArgs = args.filter((arg, idx) => {
  if (arg === "--profile") return false;
  if (idx > 0 && args[idx - 1] === "--profile") return false;
  if (arg === "--yolo") return false;        // ← 新增
  return true;
});
```

#### 3.1.3 yolo 改写与去重

在 `claudeArgs.push("--settings", tmpFile)` 之后增加:

```ts
if (options?.yolo === true) {
  if (!claudeArgs.includes("--dangerously-skip-permissions")) {
    claudeArgs.push("--dangerously-skip-permissions");
  }
}
```

#### 3.1.4 `cmdRun` 调用

```ts
await spawnClaudeWithEnv(args, env, {
  profileName: profile.name,
  providerDisplayName: preset?.displayName,
  baseURL,
  yolo: params.yolo === true,    // ← 新增
});
```

`params.yolo` 由 `parseFlags` 自动收集,`=== true` 严格判断避免 `params.yolo === "true"` 这类误用。

### 3.2 Help 文本补充

在 `showClaudeHelp()` 的 `Examples` 区块增加一行:

```
${pc.dim(`# Run ${CODER_CONFIG.displayName} in yolo mode (skips all permission prompts)`)}
${pc.green(`swixter ${CODER_NAME} r --yolo`)}
```

## 4. 行为矩阵

| 用户输入 | claudeArgs(过滤+改写后) |
|---------|------------------------|
| `--yolo` | `[--settings, /tmp/...json, --dangerously-skip-permissions]` |
| `--dangerously-skip-permissions` | `[--dangerously-skip-permissions, --settings, /tmp/...json]` |
| `--yolo --dangerously-skip-permissions` | `[--dangerously-skip-permissions, --settings, /tmp/...json]`(去重) |
| (都不传) | `[--settings, /tmp/...json]` |
| `params.yolo === "true"`(非 boolean) | 不启用(严格判断) |

## 5. 错误处理

- 无新增错误路径
- `--yolo` 未识别为 swixter 命令(因为它进 `run` 的 args)时,会被 `parseFlags` 当作未知 flag 静默收集
- `Array.includes` 去重检查不会抛错
- 现有 `ensureCliAvailable` / `getActiveProfileForCoder` 失败路径不受影响

## 6. 测试

**新增** `packages/cli/tests/cli/claude-yolo.test.ts`

覆盖以下 6 个 case(用 `bun:test` 的 `mock` 拦截 `spawn` 或 `spawnCLI`,断言 `claude` 子进程入参 `args` 数组):

1. ✅ `--yolo` 单独传入 → `args` 含 `--dangerously-skip-permissions`
2. ✅ `--dangerously-skip-permissions` 单独传入 → `args` 含 1 份(无新增)
3. ✅ 两者都传 → `args` 含 1 份(去重)、不含 `--yolo`
4. ✅ 都不传 → `args` 不含 `--dangerously-skip-permissions`
5. ✅ 显式 `yolo: false` → 不启用
6. ✅ `params.yolo === "true"`(非 boolean)→ 不启用

## 7. 范围之外(YAGNI)

- 不加短选项(`-y` 已被占用)
- 不加交互式菜单的 yolo 选项(用户已选仅 `run`/`r` 命令)
- 不持久化到 profile(`~/.config/swixter/config.json`)
- 不给 `codex` / `qwen` 加 yolo 模式 —— 用户未要求
- 不在 `showClaudeHelp` 之外的其他地方(如 completions、help 子系统)单独注册 `--yolo`,因为它是 `run` 的局部 flag,沿用现有透传机制即可
