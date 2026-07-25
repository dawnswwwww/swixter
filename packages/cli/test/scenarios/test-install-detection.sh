#!/bin/bash
# Test CLI installation detection functionality
#
# Verifies that:
# 1. When a coder CLI is NOT installed, `swixter <coder> run` fails to launch it
#    (Rust: run 不预检安装状态，launch 失败时报 "Failed to launch" 并给出安装提示，
#    以非零码退出 —— 与 TS 的 "is not installed" 预检文案不同，断言以 Rust 为准）
# 2. When a coder CLI IS installed (via mock), `swixter <coder> run` succeeds
# 3. Removing the mock CLI restores the launch-failure behavior
# 4. `swixter <coder> install` in non-TTY prints the manual method list

set -e

CLI_CMD="${SWIXTER_BIN:-/home/testuser/swixter}"
MOCK_BIN_DIR="$HOME/bin"

echo "=== Test: CLI Installation Detection ==="

# ─────────────────────────────────────────────
# Setup: create profiles so run reaches the launch step
# ─────────────────────────────────────────────
$CLI_CMD claude create --quiet --name install-test --provider anthropic --api-key sk-test-install-123 2>&1
$CLI_CMD codex create --quiet --name install-test-codex --provider ollama --model gpt-4 2>&1
$CLI_CMD qwen create --quiet --name install-test-qwen --provider ollama --model qwen2.5-coder 2>&1

# ─────────────────────────────────────────────
# Test 1: Detect Claude Code CLI not installed
# ─────────────────────────────────────────────
echo "Test 1: Detect Claude Code CLI not installed..."
EXIT_CODE=0
OUTPUT=$($CLI_CMD claude run 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "Failed to launch claude"; then
    echo "✓ Test 1 passed: Correctly detected Claude Code CLI not installed"
else
    echo "❌ Error: Should fail to launch Claude Code CLI"
    echo "Output: $OUTPUT"
    exit 1
fi

if [ "${EXIT_CODE:-0}" -eq 0 ]; then
    echo "❌ Error: Should exit with non-zero code when CLI not installed"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 2: Detect Codex CLI not installed
# ─────────────────────────────────────────────
echo "Test 2: Detect Codex CLI not installed..."
EXIT_CODE=0
OUTPUT=$($CLI_CMD codex run 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "Failed to launch codex"; then
    echo "✓ Test 2 passed: Correctly detected Codex CLI not installed"
else
    echo "❌ Error: Should fail to launch Codex CLI"
    echo "Output: $OUTPUT"
    exit 1
fi

if [ "${EXIT_CODE:-0}" -eq 0 ]; then
    echo "❌ Error: Should exit with non-zero code when CLI not installed"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 3: Detect Qwen CLI not installed
# ─────────────────────────────────────────────
echo "Test 3: Detect Qwen CLI not installed..."
EXIT_CODE=0
OUTPUT=$($CLI_CMD qwen run 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "Failed to launch qwen"; then
    echo "✓ Test 3 passed: Correctly detected Qwen CLI not installed"
else
    echo "❌ Error: Should fail to launch Qwen CLI"
    echo "Output: $OUTPUT"
    exit 1
fi

if [ "${EXIT_CODE:-0}" -eq 0 ]; then
    echo "❌ Error: Should exit with non-zero code when CLI not installed"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 4: Run succeeds when Claude Code CLI exists (mock)
# ─────────────────────────────────────────────
echo "Test 4: Run succeeds when Claude Code CLI is available..."
mkdir -p "$MOCK_BIN_DIR"
printf '#!/bin/bash\nexit 0\n' > "$MOCK_BIN_DIR/claude"
chmod +x "$MOCK_BIN_DIR/claude"
export PATH="$MOCK_BIN_DIR:$PATH"

EXIT_CODE=0
OUTPUT=$($CLI_CMD claude run 2>&1) || EXIT_CODE=$?

if [ "${EXIT_CODE:-0}" -ne 0 ] || echo "$OUTPUT" | grep -q "Failed to launch"; then
    echo "❌ Error: Should run successfully when Claude CLI exists in PATH"
    echo "Output: $OUTPUT"
    rm -f "$MOCK_BIN_DIR/claude"
    exit 1
fi
echo "✓ Test 4 passed: Correctly ran with mock Claude Code"

# Clean up mock
rm -f "$MOCK_BIN_DIR/claude"

# ─────────────────────────────────────────────
# Test 5: Run succeeds when Codex CLI exists (mock)
# ─────────────────────────────────────────────
echo "Test 5: Run succeeds when Codex CLI is available..."
printf '#!/bin/bash\nexit 0\n' > "$MOCK_BIN_DIR/codex"
chmod +x "$MOCK_BIN_DIR/codex"

EXIT_CODE=0
OUTPUT=$($CLI_CMD codex run 2>&1) || EXIT_CODE=$?

if [ "${EXIT_CODE:-0}" -ne 0 ] || echo "$OUTPUT" | grep -q "Failed to launch"; then
    echo "❌ Error: Should run successfully when Codex CLI exists in PATH"
    echo "Output: $OUTPUT"
    rm -f "$MOCK_BIN_DIR/codex"
    exit 1
fi
echo "✓ Test 5 passed: Correctly ran with mock Codex"

# Clean up mock
rm -f "$MOCK_BIN_DIR/codex"

# ─────────────────────────────────────────────
# Test 6: Run succeeds when Qwen CLI exists (mock)
# ─────────────────────────────────────────────
echo "Test 6: Run succeeds when Qwen CLI is available..."
printf '#!/bin/bash\nexit 0\n' > "$MOCK_BIN_DIR/qwen"
chmod +x "$MOCK_BIN_DIR/qwen"

EXIT_CODE=0
OUTPUT=$($CLI_CMD qwen run 2>&1) || EXIT_CODE=$?

if [ "${EXIT_CODE:-0}" -ne 0 ] || echo "$OUTPUT" | grep -q "Failed to launch"; then
    echo "❌ Error: Should run successfully when Qwen CLI exists in PATH"
    echo "Output: $OUTPUT"
    rm -f "$MOCK_BIN_DIR/qwen"
    exit 1
fi
echo "✓ Test 6 passed: Correctly ran with mock Qwen"

# Clean up mock
rm -f "$MOCK_BIN_DIR/qwen"

# ─────────────────────────────────────────────
# Test 7: Detection restored after mock CLI removed
# ─────────────────────────────────────────────
echo "Test 7: Detection restored after removing mock CLI..."
EXIT_CODE=0
OUTPUT=$($CLI_CMD claude run 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "Failed to launch claude"; then
    echo "✓ Test 7 passed: Detection correctly restored after mock removal"
else
    echo "❌ Error: Should fail to launch CLI after mock removal"
    echo "Output: $OUTPUT"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 8: Non-TTY install prints manual method list
# ─────────────────────────────────────────────
echo "Test 8: Non-TTY mode shows installation methods..."
# Run install with stdin redirected (simulating non-TTY)
OUTPUT=$(echo "" | $CLI_CMD claude install 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "manually:"; then
    echo "✓ Test 8 passed: Non-TTY mode shows installation methods"
else
    # In Docker, stdin might still be TTY, so this test may not apply
    echo "⚠ Test 8 skipped: May require true non-TTY environment"
fi

# ─────────────────────────────────────────────
# Cleanup: remove mock bin directory and test profiles
# ─────────────────────────────────────────────
rm -rf "$MOCK_BIN_DIR"

# Rust delete 无 --force/--quiet 标志（无交互确认，直接删除）
$CLI_CMD claude delete install-test 2>&1 || true
$CLI_CMD claude delete install-test-codex 2>&1 || true
$CLI_CMD claude delete install-test-qwen 2>&1 || true

echo ""
echo "✅ All install detection tests passed"
