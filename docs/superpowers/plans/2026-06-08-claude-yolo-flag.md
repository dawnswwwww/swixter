# Claude `--yolo` 标志实现 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `swixter claude run` / `swixter claude r` 命令上添加 `--yolo` 短别名,内部改写为 `--dangerously-skip-permissions` 后透传给 claude CLI。

**Architecture:** 修改 `spawnClaudeWithEnv` 的签名增加 `yolo?: boolean` 选项,在已有 `--profile` 过滤逻辑旁增加 `--yolo` 过滤,过滤后若 yolo 启用且目标标志未重复则推入 `--dangerously-skip-permissions`。`cmdRun` 通过 `parseFlags` 读 `params.yolo` 并透传。零新文件,仅改 1 个源文件 + 新增 1 个测试文件。

**Tech Stack:** TypeScript (strict), Bun (`bun:test`), `node:child_process.spawn` (mock via `vi.spyOn`).

**Spec:** `docs/superpowers/specs/2026-06-08-claude-yolo-flag-design.md`

---

## File Structure

| 文件 | 状态 | 职责 |
|------|------|------|
| `packages/cli/src/cli/claude.ts` | Modify | `spawnClaudeWithEnv` 签名/yolo 过滤/yolo 改写;`cmdRun` 透传 `params.yolo`;`showClaudeHelp` 加示例 |
| `packages/cli/tests/cli/claude-yolo.test.ts` | Create | 6 个 case 覆盖 yolo 行为矩阵 |

`spawnClaudeWithEnv` 已被 `packages/cli/src/cli/proxy.ts:461` 调用(不传 yolo),新参数为 optional,向后兼容。

---

## Task 1: 写失败的测试 — yolo 改写与去重

**Files:**
- Create: `packages/cli/tests/cli/claude-yolo.test.ts`

直接对 `spawnClaudeWithEnv` 做集成式单元测试(与 `tests/cli/proxy.test.ts` 一致的 mock 模式:spy `childProcess.spawn`、silence `console.log`、mock `process.exit`)。

- [ ] **Step 1: 创建测试文件并写第一个失败 case**

`packages/cli/tests/cli/claude-yolo.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import * as childProcess from "node:child_process";
import { spawnClaudeWithEnv } from "../../src/cli/claude.js";

const baseEnv = { ANTHROPIC_API_KEY: "sk-test" };

function getSpawnArgs(spawnSpy: ReturnType<typeof vi.spyOn>): string[] {
  const calls = spawnSpy.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  // spawn(command, args, options) -> args is index 1
  return calls[calls.length - 1][1] as string[];
}

describe("spawnClaudeWithEnv yolo flag", () => {
  let spawnSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.fn>;
  const originalExit = process.exit;

  beforeEach(() => {
    // Mock spawn to return a fake child that never actually runs
    spawnSpy = vi.spyOn(childProcess, "spawn").mockReturnValue({
      on: vi.fn(),
      unref: vi.fn(),
    } as unknown as ReturnType<typeof childProcess.spawn>);
    // Silence console output
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    // Mock process.exit so tests don't terminate
    exitSpy = vi.fn() as unknown as typeof process.exit;
    process.exit = exitSpy;
  });

  afterEach(() => {
    process.exit = originalExit;
    vi.restoreAllMocks();
  });

  test("yolo=true adds --dangerously-skip-permissions to spawn args", async () => {
    await spawnClaudeWithEnv([], baseEnv, { yolo: true });
    const args = getSpawnArgs(spawnSpy);
    expect(args).toContain("--dangerously-skip-permissions");
  });
});
```

- [ ] **Step 2: 运行测试,验证它失败**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun test tests/cli/claude-yolo.test.ts
```

Expected: FAIL — `args` does not contain `"--dangerously-skip-permissions"` because current code has no yolo handling.

- [ ] **Step 3: 提交失败测试**

```bash
cd /Users/nan/workspace/code/project/swixter && git add packages/cli/tests/cli/claude-yolo.test.ts
git commit -m "test: add failing test for spawnClaudeWithEnv yolo flag"
```

---

## Task 2: 修改 `spawnClaudeWithEnv` 签名 + 加 yolo 过滤

**Files:**
- Modify: `packages/cli/src/cli/claude.ts:1131-1140` (options 接口) 和 `1142-1152` (过滤逻辑)

- [ ] **Step 1: 在 options 接口增加 `yolo?: boolean`**

打开 `packages/cli/src/cli/claude.ts`,定位到 `spawnClaudeWithEnv` 函数 (行 1131)。当前签名:

```ts
export async function spawnClaudeWithEnv(
  args: string[],
  env: Record<string, string>,
  options?: {
    profileName?: string;
    providerDisplayName?: string;
    baseURL?: string;
    onExit?: () => void | Promise<void>;
  }
): Promise<void> {
```

在 `onExit?` 之后增加 `yolo?: boolean;`:

```ts
export async function spawnClaudeWithEnv(
  args: string[],
  env: Record<string, string>,
  options?: {
    profileName?: string;
    providerDisplayName?: string;
    baseURL?: string;
    yolo?: boolean;
    onExit?: () => void | Promise<void>;
  }
): Promise<void> {
```

- [ ] **Step 2: 在过滤 callback 中增加 `--yolo` 过滤**

定位到 `claudeArgs = args.filter((arg, idx) => { ... })` 块(行 1142-1152)。当前代码:

```ts
const claudeArgs = args.filter((arg, idx) => {
  if (arg === "--profile") {
    return false;
  }
  if (idx > 0 && args[idx - 1] === "--profile") {
    return false;
  }
  return true;
});
```

在 `return true;` 之前增加 `if (arg === "--yolo") return false;`:

```ts
const claudeArgs = args.filter((arg, idx) => {
  if (arg === "--profile") {
    return false;
  }
  if (idx > 0 && args[idx - 1] === "--profile") {
    return false;
  }
  if (arg === "--yolo") {
    return false;
  }
  return true;
});
```

- [ ] **Step 3: 跑测试,确认仍为红(只过滤、不改写)**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun test tests/cli/claude-yolo.test.ts
```

Expected: FAIL — Task 1 的 case 1 仍失败,因为本 step 只加了 `--yolo` 过滤,还没有加 yolo 改写逻辑(`--dangerously-skip-permissions` 还没被推入)。这是预期的:TDD 顺序是先红后绿,改写逻辑在 Task 3 加。

(本 Task 不下 commit,Task 3 完成后会跨过红线再统一提交。)

---

## Task 3: 加 yolo 改写逻辑(去重 + 推入目标标志)

**Files:**
- Modify: `packages/cli/src/cli/claude.ts:1164` 附近(`claudeArgs.push("--settings", tmpFile);` 之后)

- [ ] **Step 1: 在 `--settings` 推入后增加 yolo 改写块**

定位到 `claudeArgs.push("--settings", tmpFile);` 这一行(在 yolo 过滤之后)。当前:

```ts
claudeArgs.push("--settings", tmpFile);

if (options?.profileName) {
```

在 `claudeArgs.push("--settings", tmpFile);` 之后、`if (options?.profileName)` 之前插入:

```ts
if (options?.yolo === true) {
  if (!claudeArgs.includes("--dangerously-skip-permissions")) {
    claudeArgs.push("--dangerously-skip-permissions");
  }
}
```

- [ ] **Step 2: 跑 Task 1 的测试,验证通过**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun test tests/cli/claude-yolo.test.ts
```

Expected: PASS — Task 1 case 1 现在通过。

- [ ] **Step 3: 提交**

```bash
cd /Users/nan/workspace/code/project/swixter && git add packages/cli/src/cli/claude.ts
git commit -m "feat(claude): rewrite --yolo to --dangerously-skip-permissions with dedup"
```

---

## Task 4: 补全 5 个剩余测试 case

**Files:**
- Modify: `packages/cli/tests/cli/claude-yolo.test.ts`

- [ ] **Step 1: 在 `describe` 块内追加 5 个 test**

打开 `packages/cli/tests/cli/claude-yolo.test.ts`,定位到 Task 1 写的第一个 test 之后。在第一个 test 的 `});` 后面、describe 块的 closing 之前,增加以下 5 个 test:

```ts
  test("yolo=false does not add --dangerously-skip-permissions", async () => {
    await spawnClaudeWithEnv([], baseEnv, { yolo: false });
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  test("yolo=undefined does not add --dangerously-skip-permissions", async () => {
    await spawnClaudeWithEnv([], baseEnv, {});
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  test("yolo=true is strictly boolean (string 'true' is ignored)", async () => {
    await spawnClaudeWithEnv([], baseEnv, { yolo: "true" as unknown as boolean });
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  test("--dangerously-skip-permissions in args + yolo=true does not duplicate", async () => {
    await spawnClaudeWithEnv(["--dangerously-skip-permissions"], baseEnv, { yolo: true });
    const args = getSpawnArgs(spawnSpy);
    const occurrences = args.filter((a) => a === "--dangerously-skip-permissions").length;
    expect(occurrences).toBe(1);
  });

  test("--yolo in args is filtered out (not passed to claude)", async () => {
    await spawnClaudeWithEnv(["--yolo", "--print", "hello"], baseEnv, { yolo: true });
    const args = getSpawnArgs(spawnSpy);
    expect(args).not.toContain("--yolo");
    expect(args).toContain("--print");
    expect(args[args.indexOf("--print") + 1]).toBe("hello");
  });
```

- [ ] **Step 2: 跑全部测试,验证 6 个全过**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun test tests/cli/claude-yolo.test.ts
```

Expected: PASS — 6/6 通过。

- [ ] **Step 3: 提交**

```bash
cd /Users/nan/workspace/code/project/swixter && git add packages/cli/tests/cli/claude-yolo.test.ts
git commit -m "test: cover yolo dedup, strict boolean check, and --yolo stripping"
```

---

## Task 5: `cmdRun` 透传 `params.yolo`

**Files:**
- Modify: `packages/cli/src/cli/claude.ts:1238-1242`(`cmdRun` 调用 `spawnClaudeWithEnv` 处)

- [ ] **Step 1: 在 options 中增加 `yolo` 字段**

定位到 `cmdRun` 函数末尾(行 1238 附近),当前:

```ts
await spawnClaudeWithEnv(args, env, {
  profileName: profile.name,
  providerDisplayName: preset?.displayName,
  baseURL,
});
```

改为:

```ts
await spawnClaudeWithEnv(args, env, {
  profileName: profile.name,
  providerDisplayName: preset?.displayName,
  baseURL,
  yolo: params.yolo === true,
});
```

- [ ] **Step 2: 类型检查**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bunx tsc --noEmit
```

Expected: 0 errors. (`params` 类型来自 `parseFlags` 返回 `Record<string, string | boolean>`,`params.yolo` 合法。)

- [ ] **Step 3: 跑全部 cli 单元测试,确认无回归**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun test
```

Expected: 所有现有测试 PASS + Task 1/4 新增 6 个 PASS。

- [ ] **Step 4: 提交**

```bash
cd /Users/nan/workspace/code/project/swixter && git add packages/cli/src/cli/claude.ts
git commit -m "feat(claude): pipe params.yolo from cmdRun to spawnClaudeWithEnv"
```

---

## Task 6: 更新 `showClaudeHelp` 增加 yolo 示例

**Files:**
- Modify: `packages/cli/src/cli/claude.ts:154-157`(`Examples` 区块)

- [ ] **Step 1: 在现有 `--print` 示例之后增加 yolo 示例**

定位到 `showClaudeHelp` 函数的 Examples 区块末尾(行 156-157 附近):

```ts
  ${pc.dim(`# Run ${CODER_CONFIG.displayName} and pass other arguments`)}
  ${pc.green(`swixter ${CODER_NAME} r --print "What is 2+2?"`)}
`);
```

在 `${pc.green(`swixter ${CODER_NAME} r --print "What is 2+2?"`)}` 这行**之后**、`\`);` 之前,增加两行:

```ts
  ${pc.dim(`# Run ${CODER_CONFIG.displayName} in yolo mode (skips all permission prompts)`)}
  ${pc.green(`swixter ${CODER_NAME} r --yolo`)}
```

完整收尾:

```ts
  ${pc.dim(`# Run ${CODER_CONFIG.displayName} and pass other arguments`)}
  ${pc.green(`swixter ${CODER_NAME} r --print "What is 2+2?"`)}

  ${pc.dim(`# Run ${CODER_CONFIG.displayName} in yolo mode (skips all permission prompts)`)}
  ${pc.green(`swixter ${CODER_NAME} r --yolo`)}
`);
```

- [ ] **Step 2: 手动跑 help,确认输出正常**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun run cli claude --help
```

Expected: help 文本末尾出现 yolo 示例行,格式与现有示例一致。

- [ ] **Step 3: 提交**

```bash
cd /Users/nan/workspace/code/project/swixter && git add packages/cli/src/cli/claude.ts
git commit -m "docs(claude): add --yolo example to claude --help output"
```

---

## Task 7: 更新 CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` (项目根)

- [ ] **Step 1: 在 `## [Unreleased]` 段下加 Added 条目**

打开 `/Users/nan/workspace/code/project/swixter/CHANGELOG.md`,定位到 `## [Unreleased]` 块。当前内容:

```markdown
## [Unreleased]

### Fixed
- **Auth login on fresh install** — ...
- **Daemon PID file write on fresh install** — ...
- **Proxy instance registry write on fresh install** — ...
```

在 `### Fixed` 段之前插入 `### Added` 段(保留现有 Fixed 条目):

```markdown
## [Unreleased]

### Added
- **`--yolo` flag for `claude run`/`r`** — Short alias for Claude Code's `--dangerously-skip-permissions`. Pass `--yolo` (alone or alongside other args) to skip all permission prompts; swixter rewrites it internally and forwards the official flag to the underlying CLI. Deduplication is built in: passing both `--yolo` and `--dangerously-skip-permissions` results in a single forwarded flag.

### Fixed
- **Auth login on fresh install** — ...
- **Daemon PID file write on fresh install** — ...
- **Proxy instance registry write on fresh install** — ...
```

- [ ] **Step 2: 提交**

```bash
cd /Users/nan/workspace/code/project/swixter && git add CHANGELOG.md
git commit -m "docs(changelog): note --yolo flag addition under Unreleased"
```

---

## Task 8: 最终验证

- [ ] **Step 1: 类型检查**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bunx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 2: 跑全套单元测试**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun test
```

Expected: 全 PASS(现有测试 + 新增 6 个 yolo 测试)。

- [ ] **Step 3: 手动 smoke test(本地构建)**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter/packages/cli && bun run build && node dist/cli/index.js claude run --help
```

Expected: help 输出与 Task 6 Step 2 一致。

- [ ] **Step 4: 检查 `git log` 整洁**

Run:
```bash
cd /Users/nan/workspace/code/project/swixter && git log --oneline -8
```

Expected: 看到 5 个新 commit,语义化信息,顺序合理(测试先行 → 实现 → 文档)。
