#!/bin/bash
# Test command aliases functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== Test: Command Aliases ==="

# Prerequisite: Already have test configurations from previous tests

# Test 1: Test 'ls' alias for list command
echo "Test 1: Test 'ls' alias for claude list..."
OUTPUT=$($CLI_CMD claude ls)

if ! echo "$OUTPUT" | grep -q "test-anthropic"; then
    echo "❌ Error: 'ls' alias failed - test-anthropic not found"
    exit 1
fi

echo "✓ Test 1 passed (ls alias works)"

# Test 2: Test 'sw' alias for switch command
echo "Test 2: Test 'sw' alias for claude switch..."
$CLI_CMD claude sw test-anthropic

ACTIVE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-anthropic" ]; then
    echo "❌ Error: 'sw' alias failed, expected test-anthropic, got $ACTIVE"
    exit 1
fi

echo "✓ Test 2 passed (sw alias works)"

# Test 3: Test 'ls' alias for qwen
echo "Test 3: Test 'ls' alias for qwen..."
OUTPUT=$($CLI_CMD qwen ls)

if ! echo "$OUTPUT" | grep -q "test-ollama"; then
    echo "❌ Error: qwen 'ls' alias failed - test-ollama not found"
    exit 1
fi

echo "✓ Test 3 passed (qwen ls alias works)"

# Test 4: Test 'sw' alias for qwen
echo "Test 4: Test 'sw' alias for qwen switch..."
$CLI_CMD qwen sw test-ollama

QWEN_ACTIVE=$(jq -r '.coders.qwen.activeProfile' "$CONFIG_FILE")
if [ "$QWEN_ACTIVE" != "test-ollama" ]; then
    echo "❌ Error: qwen 'sw' alias failed, expected test-ollama, got $QWEN_ACTIVE"
    exit 1
fi

echo "✓ Test 4 passed (qwen sw alias works)"

# Test 5: Test 'new' alias for create (non-interactive mode)
echo "Test 5: Test 'new' alias for create..."
$CLI_CMD claude new --quiet \
    --name test-alias-create \
    --provider anthropic \
    --api-key sk-ant-test-alias-xxx

# Verify profile was created
if ! jq -e '.profiles."test-alias-create"' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: 'new' alias failed - profile not created"
    exit 1
fi

echo "✓ Test 5 passed (new alias works)"

# Test 6: Test 'rm' alias for delete
echo "Test 6: Test 'rm' alias for delete..."
$CLI_CMD claude rm test-alias-create

# Verify profile was deleted
if jq -e '.profiles."test-alias-create"' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: 'rm' alias failed - profile still exists"
    exit 1
fi

echo "✓ Test 6 passed (rm alias works)"

# Test 7: Test help with aliases shown
echo "Test 7: Verify aliases are shown in help..."
HELP_OUTPUT=$($CLI_CMD claude --help)

if ! echo "$HELP_OUTPUT" | grep -q "run, r"; then
    echo "❌ Error: 'run, r' alias not shown in help"
    exit 1
fi

if ! echo "$HELP_OUTPUT" | grep -q "list, ls"; then
    echo "❌ Error: 'list, ls' alias not shown in help"
    exit 1
fi

if ! echo "$HELP_OUTPUT" | grep -q "switch, sw"; then
    echo "❌ Error: 'switch, sw' alias not shown in help"
    exit 1
fi

if ! echo "$HELP_OUTPUT" | grep -q "delete, rm"; then
    echo "❌ Error: 'delete, rm' alias not shown in help"
    exit 1
fi

echo "✓ Test 7 passed (aliases shown in help)"

# Test 8: Test codex aliases
echo "Test 8: Test codex aliases..."

# Create a codex profile first
$CLI_CMD codex create --quiet \
    --name test-codex-alias \
    --provider ollama \
    --base-url http://localhost:11434

# Test ls alias for codex
OUTPUT=$($CLI_CMD codex ls)
if ! echo "$OUTPUT" | grep -q "test-codex-alias"; then
    echo "❌ Error: codex 'ls' alias failed"
    exit 1
fi

# Test sw alias for codex
$CLI_CMD codex sw test-codex-alias
CODEX_ACTIVE=$(jq -r '.coders.codex.activeProfile' "$CONFIG_FILE")
if [ "$CODEX_ACTIVE" != "test-codex-alias" ]; then
    echo "❌ Error: codex 'sw' alias failed, expected test-codex-alias, got $CODEX_ACTIVE"
    exit 1
fi

# Test rm alias for codex
$CLI_CMD codex rm test-codex-alias
if jq -e '.profiles."test-codex-alias"' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: codex 'rm' alias failed - profile still exists"
    exit 1
fi

echo "✓ Test 8 passed (codex aliases work)"

echo "✅ All command alias tests passed"
