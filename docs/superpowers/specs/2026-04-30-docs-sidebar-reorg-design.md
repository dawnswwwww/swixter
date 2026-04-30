# Docs 侧边栏菜单重组设计文档

## 项目信息

| 项目 | Swixter Docs 菜单重组 |
|------|----------------------|
| 日期 | 2026-04-30 |
| 状态 | 待实现 |
| 负责人 | dawnswwwww |

---

## 目标

重组 `packages/docs` Starlight 文档站的侧边栏菜单，解决孤立页面、内容重复、分类不清晰的问题，同时为未来内容预留结构。

---

## 当前问题

1. **`reference/changelog.md` 孤立** — 文件存在但未出现在侧边栏
2. **Providers 冗余** — 4 个独立页面（anthropic/ollama/openai/custom）作为独立分组，内容单薄
3. **Proxy 重复** — `commands/proxy.md` 和 `advanced/proxy.md` 功能重叠
4. **Sync 分裂** — `commands/sync.md` 和 `advanced/cloud-sync.md` 应合并为一页
5. **Commands 分组过长** — 8 项，远超其他分组

---

## 目标侧边栏结构

```
Getting Started
  ├ Installation
  ├ Quick Start
  └ Configuration

Commands
  ├ Claude Code
  ├ Codex
  ├ Continue.dev
  ├ Providers      ← 合并原 4 个独立页面
  ├ Groups
  ├ Proxy          ← 合并 advanced/proxy
  └ UI

Advanced
  ├ Cloud Sync     ← 合并 commands/sync
  └ Windows

Reference          ← 新增分组
  ├ Changelog      ← 补回侧边栏
  └ (Config Schema — 预留)
```

---

## 变更清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 合并 | `providers/anthropic.md` `ollama.md` `openai.md` `custom.md` → `commands/providers.md` | 所有 provider 信息合并到一个页面，简要展示 |
| 合并 | `commands/sync.md` + `advanced/cloud-sync.md` → `advanced/cloud-sync.md` | 云同步相关内容集中 |
| 合并 | `advanced/proxy.md` 内容并入 `commands/proxy.md` | 去重 |
| 新增 | Reference 分组挂载 `reference/changelog.md` | 补回侧边栏 |
| 删除 | `providers/anthropic.md` `providers/ollama.md` `providers/openai.md` `providers/custom.md` | 内容已合并 |
| 删除 | `advanced/proxy.md` | 内容已合并到 commands/proxy |
| 删除 | `commands/sync.md` | 内容已合并到 advanced/cloud-sync |

---

## 实现步骤

1. 合并 providers 4 页内容到 `commands/providers.md`
2. 合并 `commands/sync.md` + `advanced/cloud-sync.md` → `advanced/cloud-sync.md`
3. 合并 `advanced/proxy.md` 内容到 `commands/proxy.md`
4. 删除 7 个旧文件
5. 更新 `astro.config.mjs` 的 `sidebar` 配置为新结构
6. 构建验证 `bun run build` + 本地预览确认导航正常

---

## 不变的部分

- `getting-started/` 下 3 个页面保持不变
- `commands/claude.md` `codex.md` `qwen.md` `groups.md` `ui.md` 保持不变
- `advanced/windows.md` 保持不变
- Starlight 配置的其他部分（title、customCss、head 脚本）保持不变
