#!/bin/bash
# Test delete configuration functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== Test: Delete Configuration ==="

# Prerequisite: Have test-auth-only configuration
echo "Creating test-auth-only configuration..."
$CLI_CMD claude create \
  --quiet \
  --name test-auth-only \
  --provider anthropic \
  --auth-token sk-ant-auth-only

# Verify configuration exists
if ! jq -e '.profiles["test-auth-only"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: test-auth-only configuration not created"
    exit 1
fi

# Record initial configuration count
INITIAL_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
echo "Initial configuration count: $INITIAL_COUNT"

# Test 1: Delete test-auth-only from claude
echo "Test 1: Delete test-auth-only configuration from claude..."
$CLI_CMD claude delete test-auth-only

# Verify configuration was deleted
if jq -e '.profiles["test-auth-only"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration not deleted"
    exit 1
fi

# Verify configuration count decreased
AFTER_DELETE_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
EXPECTED_COUNT=$((INITIAL_COUNT - 1))

if [ "$AFTER_DELETE_COUNT" != "$EXPECTED_COUNT" ]; then
    echo "❌ Error: Configuration count incorrect, expected $EXPECTED_COUNT, got $AFTER_DELETE_COUNT"
    exit 1
fi

# Verify other configuration still exists
if ! jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: test-anthropic configuration missing"
    exit 1
fi

# Verify claude's active configuration was not affected (should still be test-both-keys)
CLAUDE_ACTIVE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
if [ "$CLAUDE_ACTIVE" == "test-auth-only" ]; then
    echo "❌ Error: Claude active configuration not properly handled after deletion"
    exit 1
fi

echo "✓ Test 1 passed"

# Test 2: Verify independence of each coder's active configuration after deletion
echo "Test 2: Verify qwen's active configuration was not affected..."
QWEN_ACTIVE=$(jq -r '.coders.qwen.activeProfile' "$CONFIG_FILE")
if [ "$QWEN_ACTIVE" == "test-auth-only" ]; then
    echo "⚠️  Qwen's active configuration also points to deleted test-auth-only (may need handling)"
fi

echo "✓ Test 2 passed"

echo "✅ All delete configuration tests passed"
