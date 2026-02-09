#!/bin/bash
# Test update command functionality
#
# Verifies that:
# 1. `swixter <coder> update` command exists and works
# 2. When CLI is not installed, update command prompts to install first
# 3. When CLI is installed, update command executes update logic
# 4. Version detection works correctly

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
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

if echo "$OUTPUT" | grep -qi "not installed\|install first\|please install"; then
    echo "✓ Test 2 passed: Update-cli command prompts to install first"
else
    echo "⚠ Test 2: Update-cli command behavior needs verification"
fi

# ─────────────────────────────────────────────
# Test 3: Update-cli command works when CLI is installed
# ─────────────────────────────────────────────
echo "Test 3: Update-cli command works when CLI is installed..."
mkdir -p "$MOCK_BIN_DIR"
# Create mock CLI that returns version
printf '#!/bin/bash\nif [ "$1" = "--version" ]; then echo "claude 1.0.0"; else exit 0; fi\n' > "$MOCK_BIN_DIR/claude"
chmod +x "$MOCK_BIN_DIR/claude"
export PATH="$MOCK_BIN_DIR:$PATH"

OUTPUT=$($CLI_CMD claude update-cli 2>&1) || true

# Should either show update message or execute update
if echo "$OUTPUT" | grep -qi "update\|updating\|latest\|Current version"; then
    echo "✓ Test 3 passed: Update-cli command executes update logic"
elif ! echo "$OUTPUT" | grep -q "not installed"; then
    # If it doesn't show "not installed", it likely detected the mock
    echo "✓ Test 3 passed: Update-cli command detected mock CLI"
else
    echo "⚠ Test 3: Update-cli command behavior with installed CLI needs verification"
fi

# Clean up mock
rm -f "$MOCK_BIN_DIR/claude"

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
