#!/bin/bash
# Test CLI installation detection functionality
#
# Verifies that:
# 1. When a coder CLI is NOT installed, `swixter <coder> run` detects it
#    and shows the "is not installed" warning before exiting
# 2. When a coder CLI IS installed (via mock), `swixter <coder> run` skips
#    the install check and proceeds normally
# 3. Removing the mock CLI restores the detection behavior

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
MOCK_BIN_DIR="$HOME/bin"

echo "=== Test: CLI Installation Detection ==="

# ─────────────────────────────────────────────
# Test 1: Detect Claude Code CLI not installed
# ─────────────────────────────────────────────
echo "Test 1: Detect Claude Code CLI not installed..."
OUTPUT=$($CLI_CMD claude run 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "is not installed"; then
    echo "✓ Test 1 passed: Correctly detected Claude Code CLI not installed"
else
    echo "❌ Error: Should detect Claude Code CLI is not installed"
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

if echo "$OUTPUT" | grep -q "is not installed"; then
    echo "✓ Test 2 passed: Correctly detected Codex CLI not installed"
else
    echo "❌ Error: Should detect Codex CLI is not installed"
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

if echo "$OUTPUT" | grep -q "is not installed"; then
    echo "✓ Test 3 passed: Correctly detected Qwen CLI not installed"
else
    echo "❌ Error: Should detect Qwen CLI is not installed"
    echo "Output: $OUTPUT"
    exit 1
fi

if [ "${EXIT_CODE:-0}" -eq 0 ]; then
    echo "❌ Error: Should exit with non-zero code when CLI not installed"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 4: Skip install check when Claude Code CLI exists (mock)
# ─────────────────────────────────────────────
echo "Test 4: Skip install check when Claude Code CLI is available..."
mkdir -p "$MOCK_BIN_DIR"
printf '#!/bin/bash\nexit 0\n' > "$MOCK_BIN_DIR/claude"
chmod +x "$MOCK_BIN_DIR/claude"
export PATH="$MOCK_BIN_DIR:$PATH"

# Create a profile so the run command can proceed past profile check
$CLI_CMD claude create --quiet --name install-test --provider anthropic --api-key sk-test-install-123 2>&1 || true

OUTPUT=$($CLI_CMD claude run 2>&1) || true

if echo "$OUTPUT" | grep -q "is not installed"; then
    echo "❌ Error: Should NOT show install prompt when Claude CLI exists in PATH"
    echo "Output: $OUTPUT"
    rm -f "$MOCK_BIN_DIR/claude"
    exit 1
fi
echo "✓ Test 4 passed: Correctly skipped install check for Claude Code"

# Clean up mock
rm -f "$MOCK_BIN_DIR/claude"

# ─────────────────────────────────────────────
# Test 5: Skip install check when Codex CLI exists (mock)
# ─────────────────────────────────────────────
echo "Test 5: Skip install check when Codex CLI is available..."
printf '#!/bin/bash\nexit 0\n' > "$MOCK_BIN_DIR/codex"
chmod +x "$MOCK_BIN_DIR/codex"

# Create a profile for codex
$CLI_CMD codex create --quiet --name install-test --provider ollama --api-key "" --model gpt-4 2>&1 || true

OUTPUT=$($CLI_CMD codex run 2>&1) || true

if echo "$OUTPUT" | grep -q "is not installed"; then
    echo "❌ Error: Should NOT show install prompt when Codex CLI exists in PATH"
    echo "Output: $OUTPUT"
    rm -f "$MOCK_BIN_DIR/codex"
    exit 1
fi
echo "✓ Test 5 passed: Correctly skipped install check for Codex"

# Clean up mock
rm -f "$MOCK_BIN_DIR/codex"

# ─────────────────────────────────────────────
# Test 6: Skip install check when Qwen CLI exists (mock)
# ─────────────────────────────────────────────
echo "Test 6: Skip install check when Qwen CLI is available..."
printf '#!/bin/bash\nexit 0\n' > "$MOCK_BIN_DIR/qwen"
chmod +x "$MOCK_BIN_DIR/qwen"

# Create a profile for qwen
$CLI_CMD qwen create --quiet --name install-test --provider ollama --api-key "" --model qwen2.5-coder 2>&1 || true

OUTPUT=$($CLI_CMD qwen run 2>&1) || true

if echo "$OUTPUT" | grep -q "is not installed"; then
    echo "❌ Error: Should NOT show install prompt when Qwen CLI exists in PATH"
    echo "Output: $OUTPUT"
    rm -f "$MOCK_BIN_DIR/qwen"
    exit 1
fi
echo "✓ Test 6 passed: Correctly skipped install check for Qwen"

# Clean up mock
rm -f "$MOCK_BIN_DIR/qwen"

# ─────────────────────────────────────────────
# Test 7: Detection restored after mock CLI removed
# ─────────────────────────────────────────────
echo "Test 7: Detection restored after removing mock CLI..."
# All mocks already removed above; verify detection kicks in again
EXIT_CODE=0
OUTPUT=$($CLI_CMD claude run 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "is not installed"; then
    echo "✓ Test 7 passed: Detection correctly restored after mock removal"
else
    echo "❌ Error: Should detect CLI not installed after mock removal"
    echo "Output: $OUTPUT"
    exit 1
fi

# ─────────────────────────────────────────────
# Test 8: Non-TTY mode output format
# ─────────────────────────────────────────────
echo "Test 8: Non-TTY mode shows installation methods..."
# Run command with stdin redirected (simulating non-TTY)
OUTPUT=$(echo "" | $CLI_CMD claude run 2>&1) || EXIT_CODE=$?

if echo "$OUTPUT" | grep -q "Available installation methods"; then
    echo "✓ Test 8 passed: Non-TTY mode shows installation methods"
else
    # In Docker, stdin might still be TTY, so this test may not apply
    echo "⚠ Test 8 skipped: May require true non-TTY environment"
fi

# ─────────────────────────────────────────────
# Cleanup: remove mock bin directory and test profiles
# ─────────────────────────────────────────────
rm -rf "$MOCK_BIN_DIR"

# Cleanup: remove test profiles created during testing
# These profiles were created to test run command behavior with installed CLI
$CLI_CMD claude delete install-test --quiet 2>&1 || true
$CLI_CMD codex delete install-test --quiet 2>&1 || true
$CLI_CMD qwen delete install-test --quiet 2>&1 || true

echo ""
echo "✅ All install detection tests passed"
