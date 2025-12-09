#!/bin/bash
# Test Claude Code model configuration

set -e

CLI_CMD="node dist/cli/index.js"
# Get dynamic config paths for cross-platform compatibility
CLAUDE_CONFIG_FILE=$HOME/.claude/settings.json
SWIXTER_CONFIG_FILE=$HOME/.config/swixter/config.json

echo "=== Test: Claude Code Model Configuration ==="

# Build the project first
echo "Building project..."
bun run build > /dev/null 2>&1

# Clean up any existing configs
rm -f "$CLAUDE_CONFIG_FILE"
rm -f "$SWIXTER_CONFIG_FILE"

# Test 1: Create profile with all model types
echo "Test 1: Create profile with all model types..."
$CLI_CMD claude create \
  --name test-claude-all-models \
  --provider anthropic \
  --api-key sk-ant-test-all \
  --anthropic-model claude-sonnet-4-20250514 \
  --default-haiku-model claude-3-5-haiku-20241022 \
  --default-opus-model claude-3-opus-20240229 \
  --default-sonnet-model claude-3-5-sonnet-20241022 \
  --quiet > /dev/null 2>&1

# Verify profile was created with all models
if ! jq -e '.profiles["test-claude-all-models"]' "$SWIXTER_CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Profile not created"
    exit 1
fi

ANTHROPIC_MODEL=$(jq -r '.profiles["test-claude-all-models"].models.anthropicModel' "$SWIXTER_CONFIG_FILE")
HAIKU_MODEL=$(jq -r '.profiles["test-claude-all-models"].models.defaultHaikuModel' "$SWIXTER_CONFIG_FILE")
OPUS_MODEL=$(jq -r '.profiles["test-claude-all-models"].models.defaultOpusModel' "$SWIXTER_CONFIG_FILE")
SONNET_MODEL=$(jq -r '.profiles["test-claude-all-models"].models.defaultSonnetModel' "$SWIXTER_CONFIG_FILE")

if [ "$ANTHROPIC_MODEL" != "claude-sonnet-4-20250514" ]; then
    echo "❌ Error: anthropicModel not configured correctly"
    exit 1
fi

if [ "$HAIKU_MODEL" != "claude-3-5-haiku-20241022" ]; then
    echo "❌ Error: defaultHaikuModel not configured correctly"
    exit 1
fi

if [ "$OPUS_MODEL" != "claude-3-opus-20240229" ]; then
    echo "❌ Error: defaultOpusModel not configured correctly"
    exit 1
fi

if [ "$SONNET_MODEL" != "claude-3-5-sonnet-20241022" ]; then
    echo "❌ Error: defaultSonnetModel not configured correctly"
    exit 1
fi

echo "✓ All model types configured correctly"

# Test 2: Create profile with partial model configuration
echo "Test 2: Create profile with partial model configuration..."
$CLI_CMD claude create \
  --name test-claude-partial \
  --provider anthropic \
  --api-key sk-ant-test-partial \
  --anthropic-model claude-3-5-sonnet-20241022 \
  --default-haiku-model claude-3-5-haiku-20241022 \
  --quiet > /dev/null 2>&1

# Verify partial configuration
ANTHROPIC_MODEL=$(jq -r '.profiles["test-claude-partial"].models.anthropicModel' "$SWIXTER_CONFIG_FILE")
OPUS_MODEL=$(jq -r '.profiles["test-claude-partial"].models.defaultOpusModel' "$SWIXTER_CONFIG_FILE")

if [ "$ANTHROPIC_MODEL" != "claude-3-5-sonnet-20241022" ]; then
    echo "❌ Error: Partial anthropicModel not configured correctly"
    exit 1
fi

if [ "$OPUS_MODEL" != "null" ]; then
    echo "❌ Error: defaultOpusModel should be null in partial config"
    exit 1
fi

echo "✓ Partial model configuration works correctly"

# Test 3: Create profile without models (backward compatibility)
echo "Test 3: Create profile without models (backward compatibility)..."
$CLI_CMD claude create \
  --name test-claude-no-models \
  --provider anthropic \
  --api-key sk-ant-test-no-models \
  --quiet > /dev/null 2>&1

# Verify profile created without models object
if jq -e '.profiles["test-claude-no-models"].models' "$SWIXTER_CONFIG_FILE" > /dev/null; then
    echo "❌ Error: models object should not exist in backward compatibility profile"
    exit 1
fi

echo "✓ Backward compatibility profile created successfully"

# Test 4: Apply profile with models to Claude config
echo "Test 4: Apply profile with models to Claude config..."
$CLI_CMD claude switch test-claude-all-models > /dev/null 2>&1
$CLI_CMD claude apply > /dev/null 2>&1

# Verify models are in Claude config
if ! grep -q "ANTHROPIC_MODEL" "$CLAUDE_CONFIG_FILE"; then
    echo "❌ Error: ANTHROPIC_MODEL not found in Claude config"
    exit 1
fi

if ! grep -q "ANTHROPIC_DEFAULT_HAIKU_MODEL" "$CLAUDE_CONFIG_FILE"; then
    echo "❌ Error: ANTHROPIC_DEFAULT_HAIKU_MODEL not found in Claude config"
    exit 1
fi

if ! grep -q "ANTHROPIC_DEFAULT_OPUS_MODEL" "$CLAUDE_CONFIG_FILE"; then
    echo "❌ Error: ANTHROPIC_DEFAULT_OPUS_MODEL not found in Claude config"
    exit 1
fi

if ! grep -q "ANTHROPIC_DEFAULT_SONNET_MODEL" "$CLAUDE_CONFIG_FILE"; then
    echo "❌ Error: ANTHROPIC_DEFAULT_SONNET_MODEL not found in Claude config"
    exit 1
fi

echo "✓ All model environment variables correctly applied to Claude config"

# Test 5: Verify model values in Claude config
echo "Test 5: Verify model values in Claude config..."
ANTHROPIC_ENV=$(jq -r '.env.ANTHROPIC_MODEL' "$CLAUDE_CONFIG_FILE")
HAIKU_ENV=$(jq -r '.env.ANTHROPIC_DEFAULT_HAIKU_MODEL' "$CLAUDE_CONFIG_FILE")
OPUS_ENV=$(jq -r '.env.ANTHROPIC_DEFAULT_OPUS_MODEL' "$CLAUDE_CONFIG_FILE")
SONNET_ENV=$(jq -r '.env.ANTHROPIC_DEFAULT_SONNET_MODEL' "$CLAUDE_CONFIG_FILE")

if [ "$ANTHROPIC_ENV" != "claude-sonnet-4-20250514" ]; then
    echo "❌ Error: ANTHROPIC_MODEL value incorrect"
    exit 1
fi

if [ "$HAIKU_ENV" != "claude-3-5-haiku-20241022" ]; then
    echo "❌ Error: ANTHROPIC_DEFAULT_HAIKU_MODEL value incorrect"
    exit 1
fi

if [ "$OPUS_ENV" != "claude-3-opus-20240229" ]; then
    echo "❌ Error: ANTHROPIC_DEFAULT_OPUS_MODEL value incorrect"
    exit 1
fi

if [ "$SONNET_ENV" != "claude-3-5-sonnet-20241022" ]; then
    echo "❌ Error: ANTHROPIC_DEFAULT_SONNET_MODEL value incorrect"
    exit 1
fi

echo "✓ All model values correctly applied"

# Test 6: Switch to profile without models and verify cleanup
echo "Test 6: Switch to profile without models and verify cleanup..."
$CLI_CMD claude switch test-claude-no-models > /dev/null 2>&1
$CLI_CMD claude apply > /dev/null 2>&1

# Verify model environment variables are removed
if grep -q "ANTHROPIC_MODEL" "$CLAUDE_CONFIG_FILE"; then
    echo "❌ Error: ANTHROPIC_MODEL should be removed when switching to profile without models"
    exit 1
fi

if grep -q "ANTHROPIC_DEFAULT_HAIKU_MODEL" "$CLAUDE_CONFIG_FILE"; then
    echo "❌ Error: ANTHROPIC_DEFAULT_HAIKU_MODEL should be removed"
    exit 1
fi

echo "✓ Model environment variables correctly cleaned up"

echo ""
echo "✅ All Claude Code model configuration tests passed!"