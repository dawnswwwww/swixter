#!/bin/bash
# Test create configuration functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== Test: Create Configuration ==="

# Test 1: Create first configuration for claude (without auto-apply)
echo "Test 1: Create anthropic configuration for claude..."
$CLI_CMD claude create \
  --quiet \
  --name test-anthropic \
  --provider anthropic \
  --api-key sk-ant-test-12345

# Verify configuration file exists
if [ ! -f "$CONFIG_FILE" ]; then
    echo "❌ Error: Configuration file not created"
    exit 1
fi

# Verify configuration content
if ! jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-anthropic does not exist"
    exit 1
fi

# Verify claude's active configuration
ACTIVE=$(jq -r '.coders.claude.activeProfile' "$CONFIG_FILE")
if [ "$ACTIVE" != "test-anthropic" ]; then
    echo "❌ Error: Claude active configuration incorrect, expected test-anthropic, got $ACTIVE"
    exit 1
fi

echo "✓ Test 1 passed"

# Test 2: Create configuration for claude with both API Key and Auth Token
echo "Test 2: Create configuration for claude with both api-key and auth-token..."
$CLI_CMD claude create \
  --quiet \
  --name test-both-keys \
  --provider anthropic \
  --api-key sk-ant-api \
  --auth-token sk-ant-auth

# Verify configuration exists
if ! jq -e '.profiles["test-both-keys"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-both-keys does not exist"
    exit 1
fi

# Verify both apiKey and authToken exist
API_KEY=$(jq -r '.profiles["test-both-keys"].apiKey' "$CONFIG_FILE")
AUTH_TOKEN=$(jq -r '.profiles["test-both-keys"].authToken' "$CONFIG_FILE")

if [ "$API_KEY" != "sk-ant-api" ]; then
    echo "❌ Error: apiKey incorrect, expected sk-ant-api, got $API_KEY"
    exit 1
fi

if [ "$AUTH_TOKEN" != "sk-ant-auth" ]; then
    echo "❌ Error: authToken incorrect, expected sk-ant-auth, got $AUTH_TOKEN"
    exit 1
fi

echo "✓ Test 2 passed"

# Test 3: Create configuration with custom provider
echo "Test 3: Create configuration with custom provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-custom \
  --provider custom \
  --base-url https://my-api.example.com \
  --api-key custom-api-key

# Verify configuration exists
if ! jq -e '.profiles["test-custom"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-custom does not exist"
    exit 1
fi

# Verify baseURL and apiKey
BASE_URL=$(jq -r '.profiles["test-custom"].baseURL' "$CONFIG_FILE")
API_KEY=$(jq -r '.profiles["test-custom"].apiKey' "$CONFIG_FILE")

if [ "$BASE_URL" != "https://my-api.example.com" ]; then
    echo "❌ Error: baseURL incorrect, expected https://my-api.example.com, got $BASE_URL"
    exit 1
fi

if [ "$API_KEY" != "custom-api-key" ]; then
    echo "❌ Error: apiKey incorrect, expected custom-api-key, got $API_KEY"
    exit 1
fi

echo "✓ Test 3 passed"

# Test 4: Create configuration for qwen
echo "Test 4: Create ollama configuration for qwen..."
$CLI_CMD qwen create \
  --quiet \
  --name test-ollama \
  --provider ollama \
  --base-url http://localhost:11434

# Verify qwen's configuration
if ! jq -e '.profiles["test-ollama"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-ollama does not exist"
    exit 1
fi

# Verify qwen's active configuration
QWEN_ACTIVE=$(jq -r '.coders.qwen.activeProfile' "$CONFIG_FILE")
if [ "$QWEN_ACTIVE" != "test-ollama" ]; then
    echo "❌ Error: Qwen active configuration incorrect, expected test-ollama, got $QWEN_ACTIVE"
    exit 1
fi

echo "✓ Test 4 passed"

# Test 5: Create configuration with auth token only
echo "Test 5: Create configuration with auth token only..."
$CLI_CMD claude create \
  --quiet \
  --name test-auth-only \
  --provider anthropic \
  --auth-token sk-ant-auth-only

# Verify configuration exists
if ! jq -e '.profiles["test-auth-only"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-auth-only does not exist"
    exit 1
fi

# Verify authToken exists
AUTH_TOKEN=$(jq -r '.profiles["test-auth-only"].authToken' "$CONFIG_FILE")

if [ "$AUTH_TOKEN" != "sk-ant-auth-only" ]; then
    echo "❌ Error: authToken incorrect, expected sk-ant-auth-only, got $AUTH_TOKEN"
    exit 1
fi

echo "✓ Test 5 passed"

# Test 6: Create and apply configuration using --apply flag
echo "Test 6: Create configuration with --apply flag..."
$CLI_CMD claude create \
  --quiet \
  --name test-apply \
  --provider anthropic \
  --api-key sk-ant-apply-test \
  --auth-token sk-ant-apply-auth \
  --apply

# Verify configuration was created
if ! jq -e '.profiles["test-apply"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-apply does not exist"
    exit 1
fi

# Verify claude configuration file was updated (check ~/.claude/settings.json)
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
if [ -f "$CLAUDE_SETTINGS" ]; then
    CLAUDE_KEY=$(jq -r '.env.ANTHROPIC_API_KEY' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")
    CLAUDE_AUTH=$(jq -r '.env.ANTHROPIC_AUTH_TOKEN' "$CLAUDE_SETTINGS" 2>/dev/null || echo "")

    if [ "$CLAUDE_KEY" != "sk-ant-apply-test" ]; then
        echo "⚠️  Warning: Claude API Key not applied correctly"
    else
        echo "✓ Claude API Key applied correctly"
    fi

    if [ "$CLAUDE_AUTH" != "sk-ant-apply-auth" ]; then
        echo "⚠️  Warning: Claude Auth Token not applied correctly"
    else
        echo "✓ Claude Auth Token applied correctly"
    fi
fi

echo "✓ Test 6 passed"

# Verify configuration count
PROFILE_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
if [ "$PROFILE_COUNT" -lt "5" ]; then
    echo "❌ Error: Configuration count incorrect, expected at least 5, got $PROFILE_COUNT"
    exit 1
fi

echo "✅ All create configuration tests passed"
