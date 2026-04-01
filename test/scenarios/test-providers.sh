#!/bin/bash
# Test provider presets functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"

echo "=== Test: Provider Presets ==="

# Test 1: List all available providers
echo "Test 1: List all available providers..."
PROVIDER_LIST=$($CLI_CMD providers list 2>&1 || true)
echo "$PROVIDER_LIST"

# Verify key new providers appear in the list
if ! echo "$PROVIDER_LIST" | grep -q "groq"; then
    echo "❌ Error: Groq provider not found in list"
    exit 1
fi
echo "✓ Groq provider found"

if ! echo "$PROVIDER_LIST" | grep -q "deepseek"; then
    echo "❌ Error: DeepSeek provider not found in list"
    exit 1
fi
echo "✓ DeepSeek provider found"

if ! echo "$PROVIDER_LIST" | grep -q "moonshot"; then
    echo "❌ Error: Moonshot provider not found in list"
    exit 1
fi
echo "✓ Moonshot (Kimi) provider found"

if ! echo "$PROVIDER_LIST" | grep -q "minimax-cn"; then
    echo "❌ Error: MiniMax CN provider not found in list"
    exit 1
fi
echo "✓ MiniMax CN provider found"

if ! echo "$PROVIDER_LIST" | grep -q "zhipu-cn"; then
    echo "❌ Error: Zhipu AI CN provider not found in list"
    exit 1
fi
echo "✓ Zhipu AI CN provider found"

if ! echo "$PROVIDER_LIST" | grep -q "dashscope"; then
    echo "❌ Error: Dashscope provider not found in list"
    exit 1
fi
echo "✓ Dashscope provider found"

echo "✓ Test 1 passed"

# Test 2: Create configuration with Groq provider
echo "Test 2: Create configuration with Groq provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-groq \
  --provider groq \
  --api-key sk-groq-test-12345 \
  --model llama-3.3-70b-versatile

# Verify configuration exists
if ! jq -e '.profiles["test-groq"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-groq does not exist"
    exit 1
fi

# Verify provider ID
PROVIDER_ID=$(jq -r '.profiles["test-groq"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "groq" ]; then
    echo "❌ Error: providerId incorrect, expected groq, got $PROVIDER_ID"
    exit 1
fi

# Verify API key
API_KEY=$(jq -r '.profiles["test-groq"].apiKey' "$CONFIG_FILE")
if [ "$API_KEY" != "sk-groq-test-12345" ]; then
    echo "❌ Error: apiKey incorrect, expected sk-groq-test-12345, got $API_KEY"
    exit 1
fi

echo "✓ Test 2 passed"

# Test 3: Create configuration with DeepSeek provider
echo "Test 3: Create configuration with DeepSeek provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-deepseek \
  --provider deepseek \
  --api-key sk-deepseek-test-67890

if ! jq -e '.profiles["test-deepseek"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-deepseek does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-deepseek"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "deepseek" ]; then
    echo "❌ Error: providerId incorrect, expected deepseek, got $PROVIDER_ID"
    exit 1
fi

echo "✓ Test 3 passed"

# Test 4: Create configuration with Chinese provider (MiniMax CN)
echo "Test 4: Create configuration with MiniMax CN provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-minimax-cn \
  --provider minimax-cn \
  --api-key sk-minimax-cn-test

if ! jq -e '.profiles["test-minimax-cn"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-minimax-cn does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-minimax-cn"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "minimax-cn" ]; then
    echo "❌ Error: providerId incorrect, expected minimax-cn, got $PROVIDER_ID"
    exit 1
fi

echo "✓ Test 4 passed"

# Test 5: Create configuration with Dashscope provider
echo "Test 5: Create configuration with Dashscope provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-dashscope \
  --provider dashscope \
  --api-key sk-dashscope-test \
  --base-url https://coding.dashscope.aliyuncs.com/v1

if ! jq -e '.profiles["test-dashscope"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-dashscope does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-dashscope"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "dashscope" ]; then
    echo "❌ Error: providerId incorrect, expected dashscope, got $PROVIDER_ID"
    exit 1
fi

# Verify baseURL was set
BASE_URL=$(jq -r '.profiles["test-dashscope"].baseURL' "$CONFIG_FILE")
if [ "$BASE_URL" != "https://coding.dashscope.aliyuncs.com/v1" ]; then
    echo "❌ Error: baseURL incorrect, got $BASE_URL"
    exit 1
fi

echo "✓ Test 5 passed"

# Test 6: Create configuration with Zhipu AI CN provider
echo "Test 6: Create configuration with Zhipu AI CN provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-zhipu-cn \
  --provider zhipu-cn \
  --api-key sk-zhipu-cn-test

if ! jq -e '.profiles["test-zhipu-cn"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-zhipu-cn does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-zhipu-cn"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "zhipu-cn" ]; then
    echo "❌ Error: providerId incorrect, expected zhipu-cn, got $PROVIDER_ID"
    exit 1
fi

echo "✓ Test 6 passed"

# Test 7: Create configuration with Moonshot (Kimi) provider
echo "Test 7: Create configuration with Moonshot provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-moonshot \
  --provider moonshot \
  --api-key sk-moonshot-test \
  --model moonshot-v1-128k

if ! jq -e '.profiles["test-moonshot"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-moonshot does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-moonshot"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "moonshot" ]; then
    echo "❌ Error: providerId incorrect, expected moonshot, got $PROVIDER_ID"
    exit 1
fi

# Verify model
MODEL=$(jq -r '.profiles["test-moonshot"].model' "$CONFIG_FILE")
if [ "$MODEL" != "moonshot-v1-128k" ]; then
    echo "❌ Error: model incorrect, expected moonshot-v1-128k, got $MODEL"
    exit 1
fi

echo "✓ Test 7 passed"

# Test 8: Create configuration with Together AI provider
echo "Test 8: Create configuration with Together AI provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-together \
  --provider together \
  --api-key sk-together-test

if ! jq -e '.profiles["test-together"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-together does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-together"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "together" ]; then
    echo "❌ Error: providerId incorrect, expected together, got $PROVIDER_ID"
    exit 1
fi

echo "✓ Test 8 passed"

# Test 9: Create configuration with Fireworks AI provider
echo "Test 9: Create configuration with Fireworks AI provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-fireworks \
  --provider fireworks \
  --api-key sk-fireworks-test

if ! jq -e '.profiles["test-fireworks"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-fireworks does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-fireworks"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "fireworks" ]; then
    echo "❌ Error: providerId incorrect, expected fireworks, got $PROVIDER_ID"
    exit 1
fi

echo "✓ Test 9 passed"

# Test 10: Create configuration with 01.ai provider
echo "Test 10: Create configuration with 01.ai provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-zeroone \
  --provider zeroone \
  --api-key sk-zeroone-test

if ! jq -e '.profiles["test-zeroone"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-zeroone does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-zeroone"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "zeroone" ]; then
    echo "❌ Error: providerId incorrect, expected zeroone, got $PROVIDER_ID"
    exit 1
fi

echo "✓ Test 10 passed"

# Test 11: Create configuration with MiniMax Global provider
echo "Test 11: Create configuration with MiniMax Global provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-minimax-global \
  --provider minimax-global \
  --api-key sk-minimax-global-test

if ! jq -e '.profiles["test-minimax-global"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-minimax-global does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-minimax-global"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "minimax-global" ]; then
    echo "❌ Error: providerId incorrect, expected minimax-global, got $PROVIDER_ID"
    exit 1
fi

echo "✓ Test 11 passed"

# Test 12: Create configuration with Zhipu AI Global provider
echo "Test 12: Create configuration with Zhipu AI Global provider..."
$CLI_CMD claude create \
  --quiet \
  --name test-zhipu-global \
  --provider zhipu-global \
  --api-key sk-zhipu-global-test \
  --auth-token sk-zhipu-global-auth

if ! jq -e '.profiles["test-zhipu-global"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration test-zhipu-global does not exist"
    exit 1
fi

PROVIDER_ID=$(jq -r '.profiles["test-zhipu-global"].providerId' "$CONFIG_FILE")
if [ "$PROVIDER_ID" != "zhipu-global" ]; then
    echo "❌ Error: providerId incorrect, expected zhipu-global, got $PROVIDER_ID"
    exit 1
fi

# Verify authToken
AUTH_TOKEN=$(jq -r '.profiles["test-zhipu-global"].authToken' "$CONFIG_FILE")
if [ "$AUTH_TOKEN" != "sk-zhipu-global-auth" ]; then
    echo "❌ Error: authToken incorrect, expected sk-zhipu-global-auth, got $AUTH_TOKEN"
    exit 1
fi

echo "✓ Test 12 passed"

# Verify total profile count
PROFILE_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
if [ "$PROFILE_COUNT" -lt "12" ]; then
    echo "❌ Error: Configuration count incorrect, expected at least 12, got $PROFILE_COUNT"
    exit 1
fi

echo "✓ All provider preset tests passed"
echo "✅ All provider preset tests passed"
