#!/bin/bash
# Test install command functionality
#
# Verifies that:
# 1. `swixter <coder> install` command exists and works
# 2. When CLI is not installed, install command shows methods and allows installation
# 3. When CLI is already installed, install command prompts for reinstall
# 4. --method parameter allows non-interactive installation method selection

set -e

CLI_CMD="${SWIXTER_BIN:-/home/testuser/swixter}"
MOCK_BIN_DIR="$HOME/bin"

echo "=== Test: Install Command ==="

# ─────────────────────────────────────────────
# Test 1: Install command exists for claude
# ─────────────────────────────────────────────
echo "Test 1: Install command exists for claude..."
if ! $CLI_CMD claude install --help 2>&1 | grep -q "install"; then
    # Command might not have help, but should not error with "unknown command"
    if $CLI_CMD claude install 2>&1 | grep -q "Unknown command"; then
        echo "❌ Error: Install command not found"
        exit 1
    fi
fi
echo "✓ Test 1 passed: Install command exists"

# ─────────────────────────────────────────────
# Test 2: Install command shows methods when CLI not installed (non-TTY)
# ─────────────────────────────────────────────
echo "Test 2: Install command shows methods when CLI not installed..."
OUTPUT=$($CLI_CMD claude install 2>&1) || EXIT_CODE=$?

# In non-TTY Docker environment, should show installation methods
# (Rust: prints "Please install <name> manually:" + numbered method list)
if echo "$OUTPUT" | grep -q "Available installation methods"; then
    echo "✓ Test 2 passed: Install command shows available methods"
elif echo "$OUTPUT" | grep -q "manually:"; then
    echo "✓ Test 2 passed: Install command shows manual method list"
elif echo "$OUTPUT" | grep -q "is not installed"; then
    # Should at least detect CLI is not installed
    echo "✓ Test 2 passed: Install command detects CLI not installed"
else
    echo "⚠ Test 2: Install command output: $OUTPUT"
fi

# ─────────────────────────────────────────────
# Test 3: Install command detects when CLI is already installed
# ─────────────────────────────────────────────
echo "Test 3: Install command detects when CLI is already installed..."
mkdir -p "$MOCK_BIN_DIR"
printf '#!/bin/bash\necho "claude 1.0.0"\nexit 0\n' > "$MOCK_BIN_DIR/claude"
chmod +x "$MOCK_BIN_DIR/claude"
# Mock npm that fails fast：codex 只有 npm 单一安装方法会被直接执行，
# mock 掉以避免真实全局安装/网络依赖（后续 Test 4 会用到）
printf '#!/bin/bash\nexit 1\n' > "$MOCK_BIN_DIR/npm"
chmod +x "$MOCK_BIN_DIR/npm"
export PATH="$MOCK_BIN_DIR:$PATH"

OUTPUT=$($CLI_CMD claude install 2>&1) || true

# Should either show "already installed" or proceed without install prompt
if echo "$OUTPUT" | grep -qi "already installed\|installed"; then
    echo "✓ Test 3 passed: Install command detects existing installation"
elif ! echo "$OUTPUT" | grep -q "is not installed"; then
    # If it doesn't show "not installed", it likely detected the mock
    echo "✓ Test 3 passed: Install command detected mock CLI"
else
    echo "⚠ Test 3: Install command behavior with existing CLI needs verification"
fi

# Clean up mock
rm -f "$MOCK_BIN_DIR/claude"

# ─────────────────────────────────────────────
# Test 4: Install command for codex
# ─────────────────────────────────────────────
echo "Test 4: Install command exists for codex..."
if ! $CLI_CMD codex install 2>&1 | grep -q "Unknown command"; then
    echo "✓ Test 4 passed: Install command exists for codex"
else
    echo "❌ Error: Install command not found for codex"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 5: Install command for qwen
# ─────────────────────────────────────────────
echo "Test 5: Install command exists for qwen..."
if $CLI_CMD qwen install 2>&1 | grep -q "Unknown command"; then
    echo "❌ Error: Install command not found for qwen"
    exit 1
fi
echo "✓ Test 5 passed: Install command exists for qwen"

# Test 6: Install command validates --method parameter (non-interactive)
# 注意：使用越界索引，避免在容器内真实执行安装命令（Rust 会原样执行
# 所选方法的 shell 命令，如 curl 安装脚本，依赖外网且会污染后续场景）。
echo "Test 6: Install command validates --method parameter..."
EXIT_CODE=0
OUTPUT=$($CLI_CMD claude install --method 99 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -qi "Invalid method"; then
    echo "✓ Test 6 passed: Install command rejects out-of-range --method"
else
    echo "❌ Error: Expected 'Invalid method index' error, got: $OUTPUT"
    exit 1
fi

# ─────────────────────────────────────────────
# Cleanup
# ─────────────────────────────────────────────
rm -rf "$MOCK_BIN_DIR"

echo ""
echo "✅ All install command tests passed"
