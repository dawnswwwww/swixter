#!/bin/bash
# Test proxy gateway token functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"
PROXY_PORT=18731

cleanup() {
    $CLI_CMD proxy stop >/dev/null 2>&1 || true
    $CLI_CMD group delete test-proxy-group --force 2>/dev/null || true
    $CLI_CMD claude delete test-proxy-profile --force 2>/dev/null || true
}

trap cleanup EXIT

cleanup

echo "=== Test: Proxy Gateway Token ==="

# Test 1: Create profile and group for proxy runtime
$CLI_CMD claude create \
  --quiet \
  --name test-proxy-profile \
  --provider anthropic \
  --api-key sk-ant-test-proxy-key

$CLI_CMD group create test-proxy-group --profiles test-proxy-profile >/dev/null 2>&1
$CLI_CMD group set-default test-proxy-group >/dev/null 2>&1

if ! jq -e '.groups[] | select(.name == "test-proxy-group")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Proxy test group was not created"
    exit 1
fi

echo "✓ Test 1 passed"

# Test 2: Start proxy with explicit group and port
START_OUTPUT=$($CLI_CMD proxy start --group test-proxy-group --port $PROXY_PORT --daemon 2>&1)
if ! echo "$START_OUTPUT" | grep -q "started"; then
    echo "❌ Error: Proxy did not report successful startup"
    echo "$START_OUTPUT"
    exit 1
fi

echo "✓ Test 2 passed"

# Test 3: Status reflects running proxy binding
STATUS_OUTPUT=$($CLI_CMD proxy status 2>&1)
if ! echo "$STATUS_OUTPUT" | grep -q "Address:"; then
    echo "❌ Error: Proxy status does not show running"
    echo "$STATUS_OUTPUT"
    exit 1
fi

if ! echo "$STATUS_OUTPUT" | grep -q "$PROXY_PORT"; then
    echo "❌ Error: Proxy status does not show expected port"
    echo "$STATUS_OUTPUT"
    exit 1
fi

echo "✓ Test 3 passed"

# Test 4: Health endpoint stays open
HEALTH_CODE=$(curl -s -o /tmp/swixter-proxy-health.out -w "%{http_code}" "http://127.0.0.1:$PROXY_PORT/health")
if [ "$HEALTH_CODE" != "200" ]; then
    echo "❌ Error: Health endpoint should return 200, got $HEALTH_CODE"
    cat /tmp/swixter-proxy-health.out 2>/dev/null || true
    exit 1
fi

echo "✓ Test 4 passed"

# Test 5: Protected route rejects missing gateway token
CHAT_NO_TOKEN_CODE=$(curl -s -o /tmp/swixter-proxy-chat-no-token.out -w "%{http_code}" \
  -X POST "http://127.0.0.1:$PROXY_PORT/v1/chat/completions" \
  -H "content-type: application/json" \
  -d '{"model":"gpt-4","messages":[]}')
if [ "$CHAT_NO_TOKEN_CODE" != "401" ]; then
    echo "❌ Error: Missing proxy token should return 401, got $CHAT_NO_TOKEN_CODE"
    cat /tmp/swixter-proxy-chat-no-token.out 2>/dev/null || true
    exit 1
fi

echo "✓ Test 5 passed"

# Test 6: Protected route accepts Swixter gateway token and reaches upstream path
CHAT_WITH_TOKEN_CODE=$(curl -s -o /tmp/swixter-proxy-chat-token.out -w "%{http_code}" \
  -X POST "http://127.0.0.1:$PROXY_PORT/v1/chat/completions" \
  -H "content-type: application/json" \
  -H "authorization: Bearer swixter-local-proxy" \
  -d '{"model":"gpt-4","messages":[]}')
if [ "$CHAT_WITH_TOKEN_CODE" = "401" ]; then
    echo "❌ Error: Valid proxy token should get past auth boundary"
    cat /tmp/swixter-proxy-chat-token.out 2>/dev/null || true
    exit 1
fi

echo "✓ Test 6 passed"

echo ""
echo "✅ All proxy gateway token tests passed"
