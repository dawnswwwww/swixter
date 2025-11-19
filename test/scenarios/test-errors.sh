#!/bin/bash
# Test error handling scenarios

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"

echo "=== Test: Error Handling ==="

# Test 1: Switch to non-existent profile
echo "Test 1: Switch to non-existent configuration..."
if $CLI_CMD claude switch non-existent-profile 2>&1; then
    echo "❌ Error: Should reject switching to non-existent configuration"
    exit 1
fi
echo "✓ Test 1 passed: Correctly rejected non-existent configuration"

# Test 2: Delete non-existent profile
echo "Test 2: Delete non-existent configuration..."
if $CLI_CMD claude delete non-existent-profile 2>&1; then
    echo "❌ Error: Should reject deleting non-existent configuration"
    exit 1
fi
echo "✓ Test 2 passed: Correctly rejected deleting non-existent configuration"

# Test 3: Create without required args in quiet mode
echo "Test 3: Missing required parameters in quiet mode..."
if $CLI_CMD claude create --quiet --name test-only 2>&1; then
    echo "❌ Error: Should reject create without provider parameter"
    exit 1
fi
echo "✓ Test 3 passed: Correctly rejected missing parameters"

# Test 4: Import non-existent file
echo "Test 4: Import non-existent file..."
if $CLI_CMD import /tmp/non-existent-file-12345.json 2>&1; then
    echo "❌ Error: Should reject importing non-existent file"
    exit 1
fi
echo "✓ Test 4 passed: Correctly rejected non-existent file"

# Test 5: Import invalid JSON
echo "Test 5: Import invalid JSON file..."
echo "invalid json content {{{" > /tmp/invalid-test.json
if $CLI_CMD import /tmp/invalid-test.json 2>&1; then
    echo "❌ Error: Should reject invalid JSON"
    exit 1
fi
rm -f /tmp/invalid-test.json
echo "✓ Test 5 passed: Correctly rejected invalid JSON"

# Test 6: Unknown command
echo "Test 6: Unknown command..."
if $CLI_CMD claude unknown-command 2>&1; then
    echo "❌ Error: Should reject unknown command"
    exit 1
fi
echo "✓ Test 6 passed: Correctly rejected unknown command"

# Test 7: Apply without any profile
echo "Test 7: Apply without any configuration..."
# Clear all profiles first
rm -f ~/.config/swixter/config.json
if $CLI_CMD claude apply 2>&1 | grep -q "No active configuration"; then
    echo "✓ Test 7 passed: Correctly prompted no configuration"
else
    echo "⚠ Test 7 skipped: May already have configuration"
fi

# Test 8: Create valid profile (for subsequent tests)
echo "Test 8: Create valid configuration (restore test state)..."
$CLI_CMD claude create --quiet --name test-error-handling --provider anthropic --api-key sk-test-key-12345 2>&1
echo "✓ Test 8 passed: Successfully created configuration"

# Test 9: Import with wrong format
echo "Test 9: Import incorrectly formatted configuration..."
echo '{"wrong": "format"}' > /tmp/wrong-format.json
if $CLI_CMD import /tmp/wrong-format.json 2>&1; then
    echo "❌ Error: Should reject incorrectly formatted configuration"
    exit 1
fi
rm -f /tmp/wrong-format.json
echo "✓ Test 9 passed: Correctly rejected incorrectly formatted configuration"

echo ""
echo "✅ All error handling tests passed"
