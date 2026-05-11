#!/bin/bash
# Test applying model configurations

set -e

CLI_CMD="node /home/ubuntu/workspace/swixter/dist/cli/index.js"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "=== Test: Apply Model Configurations ==="

# Test 1: Create and apply profile with models
echo "Test 1: Create profile with model settings..."
$CLI_CMD claude create \
  --quiet \
  --name test-apply-models \
  --provider anthropic \
  --api-key sk-ant-test-apply \
  --anthropic-model claude-3-5-sonnet-20241022 \
  --default-haiku-model claude-3-5-haiku-20241022 \
  --default-sonnet-model claude-3-5-sonnet-20241022 \
  --apply

# Verify Claude settings file exists
if [ ! -f "$CLAUDE_SETTINGS" ]; then
    echo "❌ Error: Claude settings file not created"
    exit 1
fi

# Verify model environment variables are set
ANTHROPIC_MODEL=$(jq -r '.env.ANTHROPIC_MODEL' "$CLAUDE_SETTINGS" 2>/dev/null)
HAIKU_MODEL=$(jq -r '.env.ANTHROPIC_DEFAULT_HAIKU_MODEL' "$CLAUDE_SETTINGS" 2>/dev/null)
SONNET_MODEL=$(jq -r '.env.ANTHROPIC_DEFAULT_SONNET_MODEL' "$CLAUDE_SETTINGS" 2>/dev/null)

if [ "$ANTHROPIC_MODEL" != "claude-3-5-sonnet-20241022" ]; then
    echo "❌ Error: ANTHROPIC_MODEL not set correctly, got: $ANTHROPIC_MODEL"
    exit 1
fi

if [ "$HAIKU_MODEL" != "claude-3-5-haiku-20241022" ]; then
    echo "❌ Error: ANTHROPIC_DEFAULT_HAIKU_MODEL not set correctly, got: $HAIKU_MODEL"
    exit 1
fi

if [ "$SONNET_MODEL" != "claude-3-5-sonnet-20241022" ]; then
    echo "❌ Error: ANTHROPIC_DEFAULT_SONNET_MODEL not set correctly, got: $SONNET_MODEL"
    exit 1
fi

# Verify API key is also set
API_KEY=$(jq -r '.env.ANTHROPIC_API_KEY' "$CLAUDE_SETTINGS" 2>/dev/null)
if [ "$API_KEY" != "sk-ant-test-apply" ]; then
    echo "❌ Error: ANTHROPIC_API_KEY not set correctly, got: $API_KEY"
    exit 1
fi

echo "✓ Test 1 passed - Models applied correctly"

# Test 2: Create profile without models (backward compatibility)
echo "Test 2: Create profile without models (backward compatibility)..."
$CLI_CMD claude create \
  --quiet \
  --name test-no-models \
  --provider anthropic \
  --api-key sk-ant-no-models \
  --apply

# Switch to no-models profile
$CLI_CMD claude switch test-no-models --quiet
$CLI_CMD claude apply --quiet

# Verify model env vars are NOT set (they should be removed)
if jq -e '.env.ANTHROPIC_MODEL' "$CLAUDE_SETTINGS" > /dev/null 2>&1; then
    echo "❌ Error: ANTHROPIC_MODEL should not be set for profile without models"
    exit 1
fi

if jq -e '.env.ANTHROPIC_DEFAULT_HAIKU_MODEL' "$CLAUDE_SETTINGS" > /dev/null 2>&1; then
    echo "❌ Error: ANTHROPIC_DEFAULT_HAIKU_MODEL should not be set for profile without models"
    exit 1
fi

# Verify API key is still set
API_KEY=$(jq -r '.env.ANTHROPIC_API_KEY' "$CLAUDE_SETTINGS" 2>/dev/null)
if [ "$API_KEY" != "sk-ant-no-models" ]; then
    echo "❌ Error: ANTHROPIC_API_KEY not set correctly, got: $API_KEY"
    exit 1
fi

echo "✓ Test 2 passed - Backward compatibility maintained"

echo "✅ All apply model tests passed"