#!/bin/bash
# Test export and import configuration functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"
EXPORT_FILE="/tmp/test-export.json"

echo "=== Test: Export Configuration ==="

# Test: Export configuration
echo "Test: Export configuration to $EXPORT_FILE..."
$CLI_CMD export "$EXPORT_FILE"

# Verify export file exists
if [ ! -f "$EXPORT_FILE" ]; then
    echo "❌ Error: Export file not created"
    exit 1
fi

# Verify export file format
if ! jq -e '.profiles' "$EXPORT_FILE" > /dev/null; then
    echo "❌ Error: Export file format incorrect"
    exit 1
fi

# Verify exported configuration count
EXPORT_COUNT=$(jq '.profiles | length' "$EXPORT_FILE")
ORIGINAL_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")

if [ "$EXPORT_COUNT" != "$ORIGINAL_COUNT" ]; then
    echo "❌ Error: Exported configuration count mismatch"
    exit 1
fi

echo "✓ Export test passed"

echo "=== Test: Import Configuration ==="

# Prepare import test: delete one configuration
echo "Preparation: Delete test-anthropic configuration..."
$CLI_CMD claude delete test-anthropic

# Verify deletion successful
if jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration deletion failed"
    exit 1
fi

# Test: Import configuration
echo "Test: Import configuration from $EXPORT_FILE..."
$CLI_CMD import "$EXPORT_FILE"

# Verify import successful
if ! jq -e '.profiles["test-anthropic"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Configuration import failed"
    exit 1
fi

# Verify configuration count after import
AFTER_IMPORT_COUNT=$(jq '.profiles | length' "$CONFIG_FILE")
if [ "$AFTER_IMPORT_COUNT" != "$ORIGINAL_COUNT" ]; then
    echo "❌ Error: Configuration count mismatch after import"
    exit 1
fi

echo "✓ Import test passed"

# Cleanup
rm -f "$EXPORT_FILE"

echo "✅ All export/import tests passed"
