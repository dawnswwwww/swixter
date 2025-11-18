#!/bin/bash
# 测试导出和导入配置功能

set -e

CLI_CMD="bun /home/testuser/src/cli/index.ts"
CONFIG_FILE="$HOME/.config/swixter/config.json"
EXPORT_FILE="/tmp/test-export.json"

echo "=== 测试: 导出配置 ==="

# 测试: 导出配置
echo "测试: 导出配置到 $EXPORT_FILE..."
$CLI_CMD export "$EXPORT_FILE"

# 验证导出文件存在
if [ ! -f "$EXPORT_FILE" ]; then
    echo "❌ 错误: 导出文件未创建"
    exit 1
fi

# 验证导出文件格式
if ! jq -e '.profiles' "$EXPORT_FILE" > /dev/null; then
    echo "❌ 错误: 导出文件格式不正确"
    exit 1
fi

# 验证导出的配置数量
EXPORT_COUNT=$(jq '.profiles | length' "$EXPORT_FILE")
ORIGINAL_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")

if [ "$EXPORT_COUNT" != "$ORIGINAL_COUNT" ]; then
    echo "❌ 错误: 导出配置数量不匹配"
    exit 1
fi

echo "✓ 导出测试通过"

echo "=== 测试: 导入配置 ==="

# 准备导入测试: 删除一个配置
echo "准备: 删除 test-anthropic 配置..."
$CLI_CMD delete-profile test-anthropic

# 验证删除成功
if jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ 错误: 配置删除失败"
    exit 1
fi

# 测试: 导入配置
echo "测试: 从 $EXPORT_FILE 导入配置..."
$CLI_CMD import "$EXPORT_FILE"

# 验证导入成功
if ! jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ 错误: 配置导入失败"
    exit 1
fi

# 验证导入后配置数量
AFTER_IMPORT_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
if [ "$AFTER_IMPORT_COUNT" != "$ORIGINAL_COUNT" ]; then
    echo "❌ 错误: 导入后配置数量不匹配"
    exit 1
fi

echo "✓ 导入测试通过"

# 清理
rm -f "$EXPORT_FILE"

echo "✅ 所有导出/导入测试通过"
