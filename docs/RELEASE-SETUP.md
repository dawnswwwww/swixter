# 发布流水线配置指南（cargo-dist）

本文档说明如何配置 GitHub Secrets 与前置仓库，以启用 v0.2.0 起的自动化发布流程（cargo-dist + crates.io）。

## 发布架构

打 `v*` tag 后两个 workflow 并行执行：

- **`.github/workflows/release.yml`**（cargo-dist 生成，勿手改）：7 target 矩阵构建 → GitHub Release（含 changelog 与 checksums）→ 发布 shell/powershell installer、npm 包、Homebrew formula
- **`.github/workflows/publish-crates.yml`**：按依赖顺序 `cargo publish`（swixter-core → swixter-proxy → swixter-server → swixter）

## 前置步骤（首次发布前手动完成，仅一次）

1. **创建 Homebrew tap 仓库**：在 GitHub 创建空仓库 `dawnswwwww/homebrew-tap`（cargo-dist 会自动推 formula，无需任何初始内容）。
   - ⚠️ 未创建前 release.yml 的 `publish-homebrew-formula` job 会失败。过渡方案：在 `packages/cli/Cargo.toml` 的 `installers` 中临时移除 `"homebrew"` 并重新 `cargo dist generate`，或接受该 job 红（其余产物不受影响）。
2. **确认 crates.io 名称可用**：`cargo search swixter`（以及 swixter-core / swixter-proxy / swixter-server），确认未被占用。
3. **配置下述三个 GitHub Secrets**。

## Secrets 配置

配置位置：仓库 **Settings → Secrets and variables → Actions → New repository secret**。

### 1. `NPM_TOKEN`（npm 发布）

1. 登录 https://www.npmjs.com/ → 头像 → **Access Tokens**
2. **Generate New Token** → **Classic Token** → 类型选 **Automation**
3. 复制 token（格式 `npm_xxxx...`，只显示一次）
4. 在 GitHub 仓库 Secrets 中新建 `NPM_TOKEN`

### 2. `CARGO_REGISTRY_TOKEN`（crates.io 发布）

1. 登录 https://crates.io/ → 头像 → **Account Settings** → **API Tokens** → **New Token**
2. Scopes 勾选 **publish-update**；Crate scopes 限定为四个 crate：`swixter`、`swixter-core`、`swixter-proxy`、`swixter-server`
   - 注意：首次发布（publish 新 crate）时 token 的 crate scope 限制需在 crate 存在后才能精确匹配；若首发失败可先用不带 crate 限制的 token，首发后再收紧。
3. 复制 token 并在 GitHub Secrets 中新建 `CARGO_REGISTRY_TOKEN`

### 3. `HOMEBREW_TAP_TOKEN`（推送 formula 到 tap 仓库）

release.yml 的 `publish-homebrew-formula` job 需要以写权限 checkout `dawnswwwww/homebrew-tap`，默认的 `GITHUB_TOKEN` 无法跨仓库写，需要 PAT：

1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Repository access** 选 Only select repositories → `dawnswwwww/homebrew-tap`
3. **Permissions → Contents: Read and write**
4. 复制 token 并在 swixter 仓库 Secrets 中新建 `HOMEBREW_TAP_TOKEN`

## 发布流程

```bash
# 1. 更新 CHANGELOG.md（在 [Unreleased] 下新增 ## [X.Y.Z] - YYYY-MM-DD 段）

# 2. 运行发布命令（bump Cargo workspace 版本 + 同步各 package.json + commit + tag）
bun run release:patch  # 或 release:minor / release:major

# 3. 推送（tag 触发两个发布 workflow）
git push --follow-tags
```

`bun run release:*` 调用 `scripts/bump-version.sh`：版本唯一权威来源是 `packages/cli/Cargo.toml` 的 `[workspace.package] version`，`scripts/sync-versions.js` 单向同步到各 package.json。

## 验证发布

发布后检查：

1. **GitHub Actions**：https://github.com/dawnswwwww/swixter/actions（release.yml 与 publish-crates.yml 两个 run）
2. **GitHub Releases**：https://github.com/dawnswwwww/swixter/releases（含各平台压缩包、installer、checksums）
3. **npm**：https://www.npmjs.com/package/swixter
4. **crates.io**：`cargo search swixter`
5. **Homebrew**：`brew install dawnswwwww/tap/swixter`

## 常见问题

### Q: npm 安装时报 install script 被禁用（--ignore-scripts 环境）？

A: npm 包的 postinstall 负责从 GitHub Release 下载平台二进制；`--ignore-scripts` 环境下该步骤不会执行。请改用 shell installer：

```bash
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/dawnswwwww/swixter/releases/latest/download/swixter-installer.sh | sh
```

### Q: crates.io 发布失败如何重跑？

A: `cargo publish` 对已存在的版本会报 "already exists"，属幂等——直接从 publish-crates.yml 重新运行失败的工作流即可，已发布的 crate 会跳过（报错但后续步骤不受影响时，也可手动按 core → proxy → server → swixter 顺序补发缺失的 crate）。

### Q: 某个 crate 发布报 "crate not found"（依赖的内部 crate 还没索引到）？

A: crates.io 索引刷新有延迟。workflow 每步间 sleep 30 秒；若仍失败，重跑 workflow，或把 sleep 改为轮询 `cargo search` 的重试循环。

### Q: homebrew job 失败，显示仓库不存在？

A: 确认 `dawnswwwww/homebrew-tap` 已创建且 `HOMEBREW_TAP_TOKEN` 对该仓库有 Contents 写权限。临时跳过：从 `packages/cli/Cargo.toml` 的 `installers` 移除 `"homebrew"` 后 `cargo dist generate` 重新生成 release.yml。

### Q: release.yml 可以手改吗？

A: 不可以。该文件由 `cargo dist generate` 生成并自检（`cargo dist generate --check`），手改会在下次 generate 时被覆盖。需要调整时改 `packages/cli/Cargo.toml` 的 `[workspace.metadata.dist]` 后重新 generate。

## 安全注意事项

1. ⚠️ 永远不要将任何 token 提交到代码仓库
2. ✅ 定期轮换 token（建议每 3-6 个月）
3. ✅ npm 使用 Automation token；crates.io token 限定 publish-update scope；PAT 使用 fine-grained 且仅限 tap 仓库

## 相关链接

- [cargo-dist 文档](https://axodotdev.github.io/cargo-dist/)
- [crates.io API Tokens](https://crates.io/settings/tokens)
- [npm Access Tokens 文档](https://docs.npmjs.com/about-access-tokens)
- [GitHub Actions Secrets 文档](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
