#!/bin/bash
# Test Qwen model configuration

set -e

CLI_CMD="node dist/cli/index.js"
# Get dynamic config path for cross-platform compatibility
CONFIG_FILE=$HOME/.continue/config.yaml

echo "=== Test: Qwen Model Configuration ==="

# Build the project first
echo "Building project..."
bun run build > /dev/null 2>&1

# Clean up any existing config
rm -f "$CONFIG_FILE"

# Test 1: Create qwen profile with model (non-interactive)
echo "Test 1: Create qwen profile with model..."
$CLI_CMD qwen create \
  --quiet \
  --name test-qwen-model \
  --provider custom \
  --api-key sk-or-test \
  --base-url https://openrouter.ai/api/v1 \
  --model gpt-4 \
  --apply > /dev/null 2>&1

# Verify YAML contains model
if ! grep -q "model: gpt-4" "$CONFIG_FILE"; then
    echo "❌ Error: Model not found in config.yaml"
    echo "Expected: model: gpt-4"
    echo "Config file content:"
    cat "$CONFIG_FILE" 2>&1 || echo "Config file not found"
    exit 1
fi

echo "✓ Model correctly written to config.yaml"

# Test 2: Verify model is in correct location
echo "Test 2: Verify model structure..."
# Check that model is under the correct model entry
if ! grep -A 5 "title: test-qwen-model" "$CONFIG_FILE" | grep -q "model: gpt-4"; then
    echo "❌ Error: Model not found under correct profile"
    exit 1
fi

echo "✓ Model is in correct profile structure"

# Test 3: Create another profile with different model
echo "Test 3: Create second profile with different model..."
$CLI_CMD qwen create \
  --quiet \
  --name test-qwen-ollama \
  --provider ollama \
  --base-url http://localhost:11434 \
  --model llama2 \
  --apply > /dev/null 2>&1

# Verify both models exist
if ! grep -q "model: gpt-4" "$CONFIG_FILE" || ! grep -q "model: llama2" "$CONFIG_FILE"; then
    echo "❌ Error: Not all models preserved"
    exit 1
fi

echo "✓ Multiple models correctly preserved"

# Test 4: Non-interactive creation with model
echo "Test 4: Non-interactive creation with model..."
$CLI_CMD qwen create \
  --quiet \
  --name test-qwen-quiet \
  --provider custom \
  --api-key sk-test \
  --base-url https://api.openai.com/v1 \
  --model gpt-3.5-turbo \
  --apply > /dev/null 2>&1

# Verify model is set
if ! grep -q "model: gpt-3.5-turbo" "$CONFIG_FILE"; then
    echo "❌ Error: Model not set in quiet mode"
    exit 1
fi

echo "✓ Model correctly set in quiet mode"

# Test 5: Apply profile with model
echo "Test 5: Apply profile with model..."
$CLI_CMD qwen switch test-qwen-model > /dev/null 2>&1
$CLI_CMD qwen apply > /dev/null 2>&1

# Verify the active profile's model is in config
if ! grep -A 5 "title: test-qwen-model" "$CONFIG_FILE" | grep -q "model: gpt-4"; then
    echo "❌ Error: Active profile's model not in config"
    exit 1
fi

echo "✓ Active profile's model correctly applied"

echo ""
echo "✅ All Qwen model configuration tests passed!"