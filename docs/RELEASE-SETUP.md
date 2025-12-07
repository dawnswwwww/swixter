# GitHub Release 自动化配置指南

本文档说明如何配置 GitHub Secrets 以启用自动化发布功能。

## 前置要求

1. 拥有 npm 账号 (https://www.npmjs.com/)
2. 拥有 `swixter` npm 包的发布权限
3. 拥有 GitHub 仓库的管理员权限

## 配置步骤

### 1. 获取 npm 发布令牌

1. 登录 npm 网站: https://www.npmjs.com/
2. 点击右上角头像 → **Access Tokens**
3. 点击 **Generate New Token** → 选择 **Classic Token**
4. Token 类型选择: **Automation** (用于 CI/CD)
5. 复制生成的 token (格式类似: `npm_xxxxxxxxxxxxxxxxxxxxxx`)

**注意:** Token 只会显示一次,请妥善保存!

### 2. 在 GitHub 仓库中配置 Secret

1. 打开 GitHub 仓库: https://github.com/dawnswwwww/swixter
2. 点击 **Settings** (设置) 标签
3. 左侧菜单选择 **Secrets and variables** → **Actions**
4. 点击 **New repository secret**
5. 配置如下:
   - **Name**: `NPM_TOKEN`
   - **Secret**: 粘贴步骤 1 中获取的 npm token
6. 点击 **Add secret**

### 3. 验证配置

配置完成后,你可以通过以下方式验证:

**方法 1: 查看 Secrets 列表**
- 在 Settings → Secrets and variables → Actions 页面
- 应该能看到 `NPM_TOKEN` 已添加 (值会被隐藏)

**方法 2: 触发一次测试运行**
- 推送代码到 main 分支
- 访问 https://github.com/dawnswwwww/swixter/actions
- 查看 Test workflow 是否成功运行

## 发布流程

配置完成后,发布新版本只需三步:

```bash
# 1. 更新 CHANGELOG.md
# 在 [Unreleased] 下添加本次版本的更新内容

# 2. 运行发布命令
bun run release:patch  # 或 release:minor / release:major

# 3. GitHub Actions 自动:
#    - 运行测试
#    - 发布到 npm
#    - 创建 GitHub Release
```

## 验证发布

发布后,检查以下位置:

1. **GitHub Actions 运行状态**: https://github.com/dawnswwwww/swixter/actions
2. **npm 包页面**: https://www.npmjs.com/package/swixter
3. **GitHub Releases**: https://github.com/dawnswwwww/swixter/releases

## 常见问题

### Q: NPM_TOKEN 过期了怎么办?

A: 重新生成 token 并更新 GitHub Secret:
1. 在 npm 网站生成新 token
2. 在 GitHub 仓库的 Secrets 页面编辑 `NPM_TOKEN`
3. 粘贴新 token 并保存

### Q: 发布失败,显示 "需要认证"?

A: 检查:
1. NPM_TOKEN 是否正确配置
2. Token 是否有 publish 权限
3. npm 账号是否有 swixter 包的发布权限

### Q: 如何撤回已发布的版本?

A:
```bash
# 发布后 24 小时内可以撤回(不推荐)
npm unpublish swixter@0.0.5

# 更好的做法是发布一个修复版本
bun run release:patch
```

### Q: GitHub Release 创建失败?

A: 检查:
1. CHANGELOG.md 中是否有对应版本的条目
2. 版本格式是否正确: `## [X.Y.Z] - YYYY-MM-DD`
3. GitHub Actions logs 中的具体错误信息

## 安全注意事项

1. ⚠️ **永远不要**将 NPM_TOKEN 提交到代码仓库
2. ⚠️ **永远不要**在公开场合分享 NPM_TOKEN
3. ✅ 定期轮换 token (建议每 3-6 个月)
4. ✅ 使用 Automation token 而非 Personal token
5. ✅ 仅为需要的仓库配置 secrets

## 相关链接

- [npm Access Tokens 文档](https://docs.npmjs.com/about-access-tokens)
- [GitHub Actions Secrets 文档](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
- [Swixter 发布文档](./CLAUDE.md#release-and-publishing)
