#!/bin/bash
# 测试列出配置功能

set -e

CLI_CMD="bun /home/testuser/src/cli/index.ts"

echo "=== 测试: 列出配置 ==="

# 测试: 列出配置（应该输出配置列表）
echo "测试: 列出所有配置..."
OUTPUT=$($CLI_CMD list)

# 验证输出包含配置名称
if ! echo "$OUTPUT" | grep -q "test-anthropic"; then
    echo "❌ 错误: 输出中未找到 test-anthropic"
    exit 1
fi

echo "✓ 列表测试通过"

echo "✅ 所有列表配置测试通过"
