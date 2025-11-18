#!/bin/bash
# 测试切换配置功能

set -e

CLI_CMD="bun /home/testuser/src/cli/index.ts"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== 测试: 切换配置 ==="

# 前提: 已有两个配置 test-anthropic 和 test-kimi
# 当前激活的是 test-kimi

# 测试: 切换到 test-anthropic
echo "测试: 切换到 test-anthropic..."
$CLI_CMD switch test-anthropic

# 验证激活配置
ACTIVE=$(jq -r '.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-anthropic" ]; then
    echo "❌ 错误: 切换失败，期望 test-anthropic，实际 $ACTIVE"
    exit 1
fi

echo "✓ 切换测试通过"

# 测试: 切换回 test-kimi
echo "测试: 切换到 test-kimi..."
$CLI_CMD switch test-kimi

ACTIVE=$(jq -r '.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-kimi" ]; then
    echo "❌ 错误: 切换失败，期望 test-kimi，实际 $ACTIVE"
    exit 1
fi

echo "✓ 切换回测试通过"

echo "✅ 所有切换配置测试通过"
