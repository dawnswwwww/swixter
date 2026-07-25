#!/bin/bash
# Test update command functionality
#
# Verifies that:
# 1. `swixter <coder> update` command exists and works
# 2. When CLI is not installed, update command prompts to install first
# 3. When CLI is installed, update command executes update logic
# 4. Version detection works correctly

set -e

CLI_CMD="${SWIXTER_BIN:-/home/testuser/swixter}"
MOCK_BIN_DIR="$HOME/bin"

echo "=== Test: Update Command ==="

# ─────────────────────────────────────────────
# Test 1: Update-cli command exists for claude
# ─────────────────────────────────────────────
echo "Test 1: Update-cli command exists for claude..."
if $CLI_CMD claude update-cli 2>&1 | grep -q "Unknown command"; then
    echo "❌ Error: Update-cli command not found"
    exit 1
fi
echo "✓ Test 1 passed: Update-cli command exists"

# ─────────────────────────────────────────────
# Test 2: Update-cli command prompts to install when CLI not installed
# ─────────────────────────────────────────────
echo "Test 2: Update-cli command prompts to install when CLI not installed..."
OUTPUT=$($CLI_CMD claude update-cli 2>&1) || EXIT_CODE=$?

# Rust 行为可离线确定：未安装时打印 "⚠ Claude is not installed"（install.rs）
if echo "$OUTPUT" | grep -qF "is not installed"; then
    echo "✓ Test 2 passed: Update-cli command prompts to install first"
else
    echo "❌ Error: Expected 'is not installed' output, got: $OUTPUT"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 3: Update-cli command works when CLI is installed
# （mock claude 放在含 "npm" 的路径下并提供失败的 mock npm，
#   使安装方式检测命中 npm 方法且快速失败，
#   避免回退到 curl 安装脚本真实下载/安装 coder CLI）
# ─────────────────────────────────────────────
echo "Test 3: Update-cli command works when CLI is installed..."
mkdir -p "$MOCK_BIN_DIR/npm-global"
# Create mock CLI that returns version
printf '#!/bin/bash\nif [ "$1" = "--version" ]; then echo "claude 1.0.0"; else exit 0; fi\n' > "$MOCK_BIN_DIR/npm-global/claude"
chmod +x "$MOCK_BIN_DIR/npm-global/claude"
# Mock npm that fails fast (no network, no real installs)
printf '#!/bin/bash\nexit 1\n' > "$MOCK_BIN_DIR/npm"
chmod +x "$MOCK_BIN_DIR/npm"
export PATH="$MOCK_BIN_DIR/npm-global:$MOCK_BIN_DIR:$PATH"

OUTPUT=$($CLI_CMD claude update-cli 2>&1) || true

# mock claude 支持 --version，Rust 必然先打印 "Current version: claude 1.0.0"
# （install.rs update()），随后 mock npm 失败退出
if echo "$OUTPUT" | grep -qF "Current version"; then
    echo "✓ Test 3 passed: Update-cli command detects installed CLI and runs update logic"
else
    echo "❌ Error: Expected 'Current version' in update output, got: $OUTPUT"
    exit 1
fi

# Clean up mocks
rm -f "$MOCK_BIN_DIR/npm-global/claude" "$MOCK_BIN_DIR/npm"

# ─────────────────────────────────────────────
# Test 4: Upgrade alias works for claude
# ─────────────────────────────────────────────
echo "Test 4: Upgrade alias works for claude..."
if $CLI_CMD claude upgrade 2>&1 | grep -q "Unknown command"; then
    echo "❌ Error: Upgrade alias not found"
    exit 1
fi
echo "✓ Test 4 passed: Upgrade alias works"

# ─────────────────────────────────────────────
# Test 5: Update-cli command for codex
# ─────────────────────────────────────────────
echo "Test 5: Update-cli command exists for codex..."
if $CLI_CMD codex update-cli 2>&1 | grep -q "Unknown command"; then
    echo "❌ Error: Update-cli command not found for codex"
    exit 1
fi
echo "✓ Test 5 passed: Update-cli command exists for codex"

# ─────────────────────────────────────────────
# Test 6: Update-cli command for qwen
# ─────────────────────────────────────────────
echo "Test 6: Update-cli command exists for qwen..."
if $CLI_CMD qwen update-cli 2>&1 | grep -q "Unknown command"; then
    echo "❌ Error: Update-cli command not found for qwen"
    exit 1
fi
echo "✓ Test 6 passed: Update-cli command exists for qwen"

# ─────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────
rm -rf "$MOCK_BIN_DIR"

echo ""
echo "✅ All update command tests passed"
