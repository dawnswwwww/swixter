#!/bin/bash
# Test list configuration functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"

echo "=== Test: List Configurations ==="

# Test 1: List configurations for claude
echo "Test 1: List all configurations for claude..."
OUTPUT=$($CLI_CMD claude list)

# Verify output contains configuration names
if ! echo "$OUTPUT" | grep -q "test-anthropic"; then
    echo "❌ Error: test-anthropic not found in claude list output"
    exit 1
fi

if ! echo "$OUTPUT" | grep -q "test-both-keys"; then
    echo "❌ Error: test-both-keys not found in claude list output"
    exit 1
fi

echo "✓ Test 1 passed"

# Test 1b: Test 'ls' alias
echo "Test 1b: List using 'ls' alias..."
OUTPUT_ALIAS=$($CLI_CMD claude ls)

# Verify alias produces same results
if ! echo "$OUTPUT_ALIAS" | grep -q "test-anthropic"; then
    echo "❌ Error: 'ls' alias output doesn't match"
    exit 1
fi

echo "✓ Test 1b passed (ls alias works)"

# Test 2: List configurations for qwen (should see the same profiles)
echo "Test 2: List all configurations for qwen..."
OUTPUT=$($CLI_CMD qwen list)

if ! echo "$OUTPUT" | grep -q "test-anthropic"; then
    echo "❌ Error: test-anthropic not found in qwen list output"
    exit 1
fi

if ! echo "$OUTPUT" | grep -q "test-ollama"; then
    echo "❌ Error: test-ollama not found in qwen list output"
    exit 1
fi

echo "✓ Test 2 passed"

# Test 3: Global providers command
echo "Test 3: List all providers..."
OUTPUT=$($CLI_CMD providers)

if ! echo "$OUTPUT" | grep -q "Anthropic"; then
    echo "❌ Error: Anthropic not found in providers output"
    exit 1
fi

echo "✓ Test 3 passed"

echo "✅ All list configuration tests passed"
