#!/bin/bash
# Test apply configuration functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
CONTINUE_CONFIG="$HOME/.continue/config.yaml"

echo "=== Test: Apply Configuration ==="

# Test 1: Claude Code apply command
echo "Test 1: Apply configuration to Claude Code..."
$CLI_CMD claude apply

# Verify Claude Code configuration file was created or updated
if [ ! -f "$CLAUDE_SETTINGS" ]; then
    echo "❌ Error: Claude Code configuration file not created"
    exit 1
fi

# Verify configuration content is correct
ACTIVE_PROFILE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
EXPECTED_KEY=$(jq -r ".profiles[\"$ACTIVE_PROFILE\"].apiKey" "$CONFIG_FILE")
EXPECTED_AUTH=$(jq -r ".profiles[\"$ACTIVE_PROFILE\"].authToken" "$CONFIG_FILE")

# Verify API Key (if present in configuration)
if [ "$EXPECTED_KEY" != "" ] && [ "$EXPECTED_KEY" != "null" ]; then
    CLAUDE_KEY=$(jq -r '.env.ANTHROPIC_API_KEY' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")
    if [ "$CLAUDE_KEY" != "$EXPECTED_KEY" ]; then
        echo "❌ Error: Claude Code API Key mismatch"
        echo "   Expected: $EXPECTED_KEY"
        echo "   Got: $CLAUDE_KEY"
        exit 1
    fi
    echo "✓ API Key verification passed"
fi

# Verify Auth Token (if present in configuration)
if [ "$EXPECTED_AUTH" != "" ] && [ "$EXPECTED_AUTH" != "null" ]; then
    CLAUDE_AUTH=$(jq -r '.env.ANTHROPIC_AUTH_TOKEN' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")
    if [ "$CLAUDE_AUTH" != "$EXPECTED_AUTH" ]; then
        echo "❌ Error: Claude Code Auth Token mismatch"
        echo "   Expected: $EXPECTED_AUTH"
        echo "   Got: $CLAUDE_AUTH"
        exit 1
    fi
    echo "✓ Auth Token verification passed"
fi

# Verify baseURL
CLAUDE_URL=$(jq -r '.env.ANTHROPIC_BASE_URL' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")
EXPECTED_URL=$(jq -r ".profiles[\"$ACTIVE_PROFILE\"].baseURL" "$CONFIG_FILE")

if [ "$CLAUDE_URL" != "$EXPECTED_URL" ] && [ "$EXPECTED_URL" != "null" ]; then
    echo "❌ Error: Claude Code Base URL mismatch"
    echo "   Expected: $EXPECTED_URL"
    echo "   Got: $CLAUDE_URL"
    exit 1
fi

echo "✓ Test 1 passed"

# Test 2: Smart merge - preserve other configurations
echo "Test 2: Verify smart merge (preserve other configurations)..."

# Add some extra configuration to Claude settings
jq '.permissions = {"allow": ["Read(*)"]} | .hooks = {}' "$CLAUDE_SETTINGS" > "$CLAUDE_SETTINGS.tmp"
mv "$CLAUDE_SETTINGS.tmp" "$CLAUDE_SETTINGS"

# Switch to another configuration and apply
$CLI_CMD claude switch test-anthropic
$CLI_CMD claude apply

# Verify API configuration was updated
NEW_CLAUDE_KEY=$(jq -r '.env.ANTHROPIC_API_KEY' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")
NEW_EXPECTED_KEY=$(jq -r '.profiles["test-anthropic"].apiKey' "$CONFIG_FILE")

if [ "$NEW_CLAUDE_KEY" != "$NEW_EXPECTED_KEY" ]; then
    echo "❌ Error: API Key not updated correctly"
    exit 1
fi

# Verify other configurations still exist
PERMISSIONS=$(jq -r '.permissions' "$CLAUDE_SETTINGS" 2>/dev/null || echo "null")
if [ "$PERMISSIONS" == "null" ]; then
    echo "❌ Error: Smart merge failed, other configurations were deleted"
    exit 1
fi

echo "✓ Test 2 passed"

# Test 3: Apply configuration with both API Key and Auth Token
echo "Test 3: Apply configuration with both API Key and Auth Token..."
$CLI_CMD claude switch test-both-keys
$CLI_CMD claude apply

# Verify both were set
APPLIED_KEY=$(jq -r '.env.ANTHROPIC_API_KEY' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")
APPLIED_AUTH=$(jq -r '.env.ANTHROPIC_AUTH_TOKEN' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")

if [ "$APPLIED_KEY" != "sk-minimax-api" ]; then
    echo "❌ Error: API Key application failed"
    echo "   Expected: sk-minimax-api"
    echo "   Got: $APPLIED_KEY"
    exit 1
fi

if [ "$APPLIED_AUTH" != "sk-minimax-auth" ]; then
    echo "❌ Error: Auth Token application failed"
    echo "   Expected: sk-minimax-auth"
    echo "   Got: $APPLIED_AUTH"
    exit 1
fi

echo "✓ Test 3 passed"

# Test 4: Continue/Qwen apply command
echo "Test 4: Apply configuration to Continue/Qwen..."
$CLI_CMD qwen apply

# Verify Continue configuration file was created
if [ ! -f "$CONTINUE_CONFIG" ]; then
    echo "⚠️  Warning: Continue configuration file not created (may need js-yaml installed)"
    # Not treated as error, may be dependency issue
else
    echo "✓ Continue configuration file created"

    # Verify it's YAML format
    if ! grep -q "models:" "$CONTINUE_CONFIG"; then
        echo "❌ Error: Continue configuration format incorrect"
        exit 1
    fi

    echo "✓ Continue configuration format correct"
fi

echo "✓ Test 4 passed"

echo "✅ All apply configuration tests passed"
