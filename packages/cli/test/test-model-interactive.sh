#!/bin/bash
# Test model configuration (converted from interactive to non-interactive)

set -e

CLI_CMD="node /home/ubuntu/workspace/swixter/dist/cli/index.js"
# Get dynamic config path for cross-platform compatibility
CONFIG_FILE=$HOME/.config/swixter/config.json

echo "=== Test: Model Configuration ==="

# Build the project first
echo "Building project..."
cd /home/ubuntu/workspace/swixter
bun run build > /dev/null 2>&1

# Create a test profile with model configuration using flags (non-interactive)
$CLI_CMD claude create \
  --name test-interactive-model \
  --provider anthropic \
  --api-key sk-ant-test-interactive \
  --anthropic-model claude-3-5-sonnet-20241022 \
  --default-haiku-model claude-3-5-haiku-20241022 \
  --default-opus-model claude-3-opus-20240229 \
  --default-sonnet-model claude-3-5-sonnet-20241022 \
  --quiet

echo "Profile created interactively with models"

# Verify the profile was created
if ! jq -e '.profiles["test-interactive-model"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Profile test-interactive-model not created"
    exit 1
fi

# Verify model configuration
ANTHROPIC_MODEL=$(jq -r '.profiles["test-interactive-model"].models.anthropicModel' "$CONFIG_FILE")
HAIKU_MODEL=$(jq -r '.profiles["test-interactive-model"].models.defaultHaikuModel' "$CONFIG_FILE")
OPUS_MODEL=$(jq -r '.profiles["test-interactive-model"].models.defaultOpusModel' "$CONFIG_FILE")
SONNET_MODEL=$(jq -r '.profiles["test-interactive-model"].models.defaultSonnetModel' "$CONFIG_FILE")

if [ "$ANTHROPIC_MODEL" != "claude-3-5-sonnet-20241022" ]; then
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

echo "✓ Interactive model configuration test passed"

echo "✅ All interactive model tests passed"