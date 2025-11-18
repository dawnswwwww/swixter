#!/bin/bash
# 测试删除配置功能

set -e

CLI_CMD="bun /home/testuser/src/cli/index.ts"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== 测试: 删除配置 ==="

# 前提: 有 test-anthropic 和 test-kimi 两个配置

# 记录初始配置数量
INITIAL_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
echo "初始配置数量: $INITIAL_COUNT"

# 测试: 删除 test-kimi
echo "测试: 删除 test-kimi 配置..."
$CLI_CMD delete-profile test-kimi

# 验证配置已删除
if jq -e '.profiles["test-kimi"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ 错误: 配置未删除"
    exit 1
fi

# 验证配置数量减少
AFTER_DELETE_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
EXPECTED_COUNT=$((INITIAL_COUNT - 1))

if [ "$AFTER_DELETE_COUNT" != "$EXPECTED_COUNT" ]; then
    echo "❌ 错误: 配置数量不正确，期望 $EXPECTED_COUNT，实际 $AFTER_DELETE_COUNT"
    exit 1
fi

# 验证另一个配置还存在
if ! jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ 错误: test-anthropic 配置丢失"
    exit 1
fi

echo "✓ 删除测试通过"

echo "✅ 所有删除配置测试通过"
