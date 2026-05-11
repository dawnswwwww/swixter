#!/bin/bash
# Test daemon mode functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
PID_FILE="$HOME/.config/swixter/ui.pid"
LOG_FILE="$HOME/.config/swixter/ui.log"

echo "=== Test: Daemon Mode ==="

# Test 1: Status when not running
echo "Test 1: Check status when not running..."
OUTPUT=$($CLI_CMD ui --status 2>&1)
if echo "$OUTPUT" | grep -q "not running"; then
    echo "✓ Test 1 passed"
else
    echo "❌ Error: Expected 'not running' status"
    echo "   Got: $OUTPUT"
    exit 1
fi

# Test 2: Start daemon
echo "Test 2: Start daemon in background..."
$CLI_CMD ui --daemon > /dev/null 2>&1

# Wait for daemon to start
sleep 3

# Verify PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo "❌ Error: PID file not created"
    exit 1
fi

# Verify PID file is valid JSON
PID=$(jq -r '.pid' "$PID_FILE")
PORT=$(jq -r '.port' "$PID_FILE")
if [ "$PID" == "null" ] || [ "$PID" == "" ]; then
    echo "❌ Error: PID file missing pid field"
    exit 1
fi
if [ "$PORT" == "null" ] || [ "$PORT" == "" ]; then
    echo "❌ Error: PID file missing port field"
    exit 1
fi

echo "✓ Test 2 passed (daemon started, PID=$PID, PORT=$PORT)"

# Test 3: Check status when running
echo "Test 3: Check status when running..."
OUTPUT=$($CLI_CMD ui --status 2>&1)
if echo "$OUTPUT" | grep -q "is running"; then
    echo "✓ Test 3 passed"
else
    echo "❌ Error: Expected 'is running' status"
    echo "   Got: $OUTPUT"
    exit 1
fi

# Test 4: Verify HTTP endpoint responds
echo "Test 4: Verify HTTP endpoint..."
if curl -s "http://127.0.0.1:$PORT/api/version" > /dev/null 2>&1; then
    echo "✓ Test 4 passed"
else
    echo "❌ Error: HTTP endpoint not responding on port $PORT"
    exit 1
fi

# Test 5: Stop daemon
echo "Test 5: Stop daemon..."
OUTPUT=$($CLI_CMD ui --stop 2>&1)
if echo "$OUTPUT" | grep -q "stopped"; then
    echo "✓ Test 5 passed"
else
    echo "❌ Error: Expected 'stopped' message"
    echo "   Got: $OUTPUT"
    exit 1
fi

# Verify PID file removed
if [ -f "$PID_FILE" ]; then
    echo "❌ Error: PID file not removed after stop"
    exit 1
fi

# Test 6: Status after stop
echo "Test 6: Check status after stop..."
OUTPUT=$($CLI_CMD ui --status 2>&1)
if echo "$OUTPUT" | grep -q "not running"; then
    echo "✓ Test 6 passed"
else
    echo "❌ Error: Expected 'not running' status after stop"
    echo "   Got: $OUTPUT"
    exit 1
fi

# Test 7: Start daemon with custom port
echo "Test 7: Start daemon with custom port..."
$CLI_CMD ui --daemon --port 9876 > /dev/null 2>&1
sleep 3

PORT=$(jq -r '.port' "$PID_FILE")
if [ "$PORT" != "9876" ]; then
    echo "❌ Error: Custom port not respected, expected 9876, got $PORT"
    exit 1
fi

# Verify HTTP on custom port
if curl -s "http://127.0.0.1:9876/api/version" > /dev/null 2>&1; then
    echo "✓ Test 7 passed"
else
    echo "❌ Error: HTTP endpoint not responding on custom port 9876"
    exit 1
fi

# Cleanup daemon from test 7
$CLI_CMD ui --stop > /dev/null 2>&1 || true

# Test 8: Foreground start (backgrounded) → status detects it
echo "Test 8: Foreground start, then detect via status..."
nohup $CLI_CMD ui > /tmp/ui-foreground.log 2>&1 &
sleep 3

# Verify PID file exists
if [ ! -f "$PID_FILE" ]; then
    echo "❌ Error: PID file not created for foreground instance"
    exit 1
fi

# Verify status shows running
OUTPUT=$($CLI_CMD ui --status 2>&1)
if echo "$OUTPUT" | grep -q "is running"; then
    echo "✓ Test 8 passed"
else
    echo "❌ Error: Expected 'is running' for foreground instance"
    echo "   Got: $OUTPUT"
    exit 1
fi

# Test 9: Stop foreground instance
echo "Test 9: Stop foreground instance..."
OUTPUT=$($CLI_CMD ui --stop 2>&1)
if echo "$OUTPUT" | grep -q "stopped"; then
    echo "✓ Test 9 passed"
else
    echo "❌ Error: Expected 'stopped' message for foreground instance"
    echo "   Got: $OUTPUT"
    exit 1
fi

# Verify PID file removed after stop
if [ -f "$PID_FILE" ]; then
    echo "❌ Error: PID file not removed after stopping foreground instance"
    exit 1
fi

# Test 10: Status after foreground stop shows not running
echo "Test 10: Check status after foreground stop..."
OUTPUT=$($CLI_CMD ui --status 2>&1)
if echo "$OUTPUT" | grep -q "not running"; then
    echo "✓ Test 10 passed"
else
    echo "❌ Error: Expected 'not running' after foreground stop"
    echo "   Got: $OUTPUT"
    exit 1
fi

echo "✅ All daemon mode tests passed"
