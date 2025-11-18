#!/bin/bash
# 测试创建配置功能

set -e

CLI_CMD="bun /home/testuser/src/cli/index.ts"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== 测试: 创建配置 ==="

# 测试1: 创建第一个配置
echo "测试1: 创建 anthropic 配置..."
$CLI_CMD create-profile \
  --name test-anthropic \
  --provider anthropic \
  --model claude-3-5-sonnet-20241022 \
  --api-key sk-ant-test-12345

# 验证配置文件存在
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ 错误: 配置文件未创建"
    exit 1
fi

# 验证配置内容
if ! jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ 错误: 配置 test-anthropic 不存在"
    exit 1
fi

# 验证激活的配置
ACTIVE=$(jq -r '.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-anthropic" ]; then
    echo "❌ 错误: 激活配置不正确，期望 test-anthropic，实际 $ACTIVE"
    exit 1
fi

echo "✓ 测试1 通过"

# 测试2: 创建第二个配置
echo "测试2: 创建 kimi 配置..."
$CLI_CMD create-profile \
  --name test-kimi \
  --provider moonshot \
  --model moonshot-v1-8k \
  --api-key sk-kimi-test-67890

# 验证第二个配置存在
if ! jq -e '.profiles["test-kimi"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ 错误: 配置 test-kimi 不存在"
    exit 1
fi

# 验证配置数量
PROFILE_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
if [ "$PROFILE_COUNT" != "2" ]; then
    echo "❌ 错误: 配置数量不正确，期望 2，实际 $PROFILE_COUNT"
    exit 1
fi

echo "✓ 测试2 通过"

echo "✅ 所有创建配置测试通过"
