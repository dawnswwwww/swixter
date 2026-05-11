#!/bin/bash
# Test switch configuration functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== Test: Switch Configuration ==="

# Prerequisite: Already have test-anthropic and test-both-keys configurations
# Currently claude has test-both-keys active

# Test 1: Switch claude to test-anthropic
echo "Test 1: Switch claude to test-anthropic..."
$CLI_CMD claude switch test-anthropic

# Verify claude's active configuration
ACTIVE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-anthropic" ]; then
    echo "❌ Error: Claude switch failed, expected test-anthropic, got $ACTIVE"
    exit 1
fi

echo "✓ Test 1 passed"

# Test 2: Switch claude back to test-both-keys
echo "Test 2: Switch claude to test-both-keys..."
$CLI_CMD claude switch test-both-keys

ACTIVE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-both-keys" ]; then
    echo "❌ Error: Claude switch failed, expected test-both-keys, got $ACTIVE"
    exit 1
fi

echo "✓ Test 2 passed"

# Test 2b: Test 'sw' alias
echo "Test 2b: Switch using 'sw' alias..."
$CLI_CMD claude sw test-anthropic

ACTIVE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-anthropic" ]; then
    echo "❌ Error: 'sw' alias failed, expected test-anthropic, got $ACTIVE"
    exit 1
fi

# Switch back for consistency
$CLI_CMD claude sw test-both-keys

echo "✓ Test 2b passed (sw alias works)"

# Test 3: Switch qwen configuration (shared profiles, but independent active state)
echo "Test 3: Switch qwen to test-anthropic..."
$CLI_CMD qwen switch test-anthropic

QWEN_ACTIVE=$(jq -r '.coders.qwen.activeProfile' "$CONFIG_FILE")
if [ "$QWEN_ACTIVE" != "test-anthropic" ]; then
    echo "❌ Error: Qwen switch failed, expected test-anthropic, got $QWEN_ACTIVE"
    exit 1
fi

# Verify claude's active configuration was not affected
CLAUDE_ACTIVE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
if [ "$CLAUDE_ACTIVE" != "test-both-keys" ]; then
    echo "❌ Error: Claude active configuration was unexpectedly modified, expected test-both-keys, got $CLAUDE_ACTIVE"
    exit 1
fi

echo "✓ Test 3 passed"

echo "✅ All switch configuration tests passed"
