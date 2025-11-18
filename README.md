# Swixter - Claude Code 配置管理工具

一个强大的CLI工具，用于管理Claude Code的多供应商配置，支持快速切换不同的AI服务提供商和模型。

## ✨ 特性

- 🎯 **多供应商支持** - 内置10+主流AI服务提供商预设
- 🔄 **快速切换** - 一键切换不同的供应商和模型配置
- 💾 **配置管理** - 创建、保存、切换、删除多个配置文件
- 📤 **导入导出** - 支持配置的导入导出，方便团队共享
- 🔐 **API Key脱敏** - 导出时可选择脱敏API密钥
- 🎨 **美观的CLI界面** - 使用 @clack/prompts 提供现代化交互体验
- 🚀 **基于Bun** - 快速、轻量的运行时环境

## 📦 安装

```bash
# 克隆仓库
git clone https://github.com/your-username/swixter.git
cd swixter

# 安装依赖
bun install
```

## 🚀 快速开始

### 交互式模式

启动交互式界面，通过菜单完成所有操作：

```bash
bun run cli
```

### 命令行模式

直接使用命令完成特定操作：

```bash
# 查看帮助
bun run cli help

# 列出所有配置
bun run cli list

# 切换到指定配置
bun run cli switch my-config

# 导出配置到文件
bun run cli export ./config.json

# 从文件导入配置
bun run cli import ./config.json

# 查看所有支持的供应商
bun run cli providers
```

## 🌐 支持的供应商

### 国际服务商

| 供应商 | 说明 | API端点 |
|-------|------|---------|
| **Anthropic** | 官方API | https://api.anthropic.com |
| **OpenRouter** | 多模型聚合服务 | https://openrouter.ai/api/v1 |
| **AWS Bedrock** | 企业级部署 | https://bedrock-runtime.us-east-1.amazonaws.com |

### 国内服务商 🇨🇳

| 供应商 | 说明 | API端点 |
|-------|------|---------|
| **MiniMax** | 海螺AI | https://api.minimax.chat/v1 |
| **智谱AI** | GLM系列模型 | https://open.bigmodel.cn/api/paas/v4 |
| **Moonshot** | Kimi | https://api.moonshot.cn/v1 |
| **DeepSeek** | DeepSeek Chat & Coder | https://api.deepseek.com/v1 |
| **阿里云百炼** | 通义千问 | https://dashscope.aliyuncs.com/api/v1 |
| **腾讯混元** | 腾讯混元大模型 | https://hunyuan.tencentcloudapi.com |
| **字节豆包** | 火山引擎 | https://ark.cn-beijing.volces.com/api/v3 |

还支持**自定义端点**，可配置任意兼容的API服务。

## 📖 使用示例

### 1. 创建新配置

```bash
bun run cli
# 选择 "创建新配置"
# 输入配置名称: anthropic-prod
# 选择供应商: Anthropic (官方)
# 选择模型: claude-3-5-sonnet-20241022
# 输入 API Key: sk-ant-...
# 确认创建
```

### 2. 切换配置

```bash
# 交互式选择
bun run cli
# 选择 "切换配置"

# 或直接使用命令
bun run cli switch anthropic-prod
```

### 3. 导出配置（用于团队共享）

```bash
# 导出并脱敏API Key（安全分享）
bun run cli
# 选择 "导出配置"
# 输入文件路径: ./team-config.json
# 选择 "是" 脱敏API Key

# 或使用命令（不脱敏，完整导出）
bun run cli export ./backup.json
```

### 4. 导入配置

```bash
# 从文件导入
bun run cli import ./team-config.json
# 如果存在同名配置，会询问是否覆盖
```

## 🗂️ 配置文件位置

配置文件存储在：`~/.config/swixter/config.json`

配置结构示例：

```json
{
  "activeProfile": "my-config",
  "profiles": {
    "my-config": {
      "name": "my-config",
      "providerId": "anthropic",
      "apiKey": "sk-ant-...",
      "model": "claude-3-5-sonnet-20241022",
      "baseURL": "https://api.anthropic.com",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-15T10:30:00.000Z"
    }
  },
  "version": "1.0.0"
}
```

## 🔧 开发

```bash
# 运行开发模式（支持热重载）
bun run cli:dev

# 运行测试
bun test
```

## 📝 技术栈

- **运行时**: Bun
- **CLI框架**: @clack/prompts
- **颜色输出**: picocolors
- **数据验证**: Zod
- **语言**: TypeScript

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🙏 致谢

- [Bun](https://bun.sh/) - 快速的JavaScript运行时
- [@clack/prompts](https://github.com/natemoo-re/clack) - 优雅的CLI提示工具
- [Anthropic](https://www.anthropic.com/) - Claude AI

---

**注意**: 请妥善保管您的API密钥，不要将包含明文密钥的配置文件提交到公共仓库。
