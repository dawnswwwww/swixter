#!/bin/bash
# Test version command (global, TS parity)

set -e

CLI_CMD="${SWIXTER_BIN:-/home/testuser/swixter}"

echo "=== Test: Version Command ==="

# Test 1: `swixter version` exit 0，输出完整版本信息块
echo "Test 1: swixter version prints full version block..."
VERSION_OUTPUT=$($CLI_CMD version 2>&1)

for expected in "Swixter" "Version:" "Config Version:" "Export Version:"; do
    if ! echo "$VERSION_OUTPUT" | grep -q "$expected"; then
        echo "❌ Error: 'swixter version' output missing '$expected'"
        echo "$VERSION_OUTPUT"
        exit 1
    fi
done

echo "✓ Test 1 passed (version subcommand)"

# Test 2: `-v` 短 flag 与 version 子命令一致（exit 0，完整信息块）
echo "Test 2: swixter -v prints full version block..."
if ! SHORT_OUTPUT=$($CLI_CMD -v 2>&1); then
    echo "❌ Error: 'swixter -v' should exit 0"
    exit 1
fi

if ! echo "$SHORT_OUTPUT" | grep -q "Config Version:"; then
    echo "❌ Error: 'swixter -v' output missing version block"
    echo "$SHORT_OUTPUT"
    exit 1
fi

echo "✓ Test 2 passed (-v short flag)"

# Test 3: clap 自带 --version 仍可用（exit 0）
echo "Test 3: swixter --version exits 0..."
if ! $CLI_CMD --version > /dev/null 2>&1; then
    echo "❌ Error: 'swixter --version' should exit 0"
    exit 1
fi

echo "✓ Test 3 passed (--version flag)"

echo ""
echo "✅ All version command tests passed"
