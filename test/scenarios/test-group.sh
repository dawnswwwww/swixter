#!/bin/bash
# Test group management functionality

set -e

CLI_CMD="node /home/testuser/dist/cli/index.js"
CONFIG_FILE="$HOME/.config/swixter/config.json"

cleanup() {
    $CLI_CMD group delete test-group-1 --force 2>/dev/null || true
    $CLI_CMD group delete test-group-2 --force 2>/dev/null || true
    $CLI_CMD group delete test-group-2-renamed --force 2>/dev/null || true
    $CLI_CMD group delete test-group-duplicate --force 2>/dev/null || true
    $CLI_CMD group delete test-group-unknown --force 2>/dev/null || true
    $CLI_CMD claude delete test-group-profile-a --force 2>/dev/null || true
    $CLI_CMD claude delete test-group-profile-b --force 2>/dev/null || true
}

trap cleanup EXIT

cleanup

echo "=== Test: Group Management ==="

# Test 1: Create profiles for group membership
echo "Test 1: Create profiles for group..."
$CLI_CMD claude create \
  --quiet \
  --name test-group-profile-a \
  --provider anthropic \
  --api-key sk-ant-test-group-key-a

$CLI_CMD claude create \
  --quiet \
  --name test-group-profile-b \
  --provider anthropic \
  --api-key sk-ant-test-group-key-b

if ! jq -e '.profiles["test-group-profile-a"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Profile test-group-profile-a does not exist"
    exit 1
fi

if ! jq -e '.profiles["test-group-profile-b"]' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Profile test-group-profile-b does not exist"
    exit 1
fi

echo "✓ Test 1 passed"

# Test 2: Create a group with ordered profiles
echo "Test 2: Create group..."
$CLI_CMD group create test-group-1 --profiles test-group-profile-a,test-group-profile-b

# Verify group exists
if ! jq -e '.groups[] | select(.name == "test-group-1")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Group test-group-1 does not exist"
    exit 1
fi

# Verify group has correct profile count
PROFILES=$(jq -r '.groups[] | select(.name == "test-group-1") | .profiles | length' "$CONFIG_FILE")
if [ "$PROFILES" != "2" ]; then
    echo "❌ Error: Group should have 2 profiles, got $PROFILES"
    exit 1
fi

# Verify profile order is preserved
FIRST_PROFILE=$(jq -r '.groups[] | select(.name == "test-group-1") | .profiles[0]' "$CONFIG_FILE")
SECOND_PROFILE=$(jq -r '.groups[] | select(.name == "test-group-1") | .profiles[1]' "$CONFIG_FILE")
if [ "$FIRST_PROFILE" != "test-group-profile-a" ] || [ "$SECOND_PROFILE" != "test-group-profile-b" ]; then
    echo "❌ Error: Group profile order should be preserved"
    exit 1
fi

echo "✓ Test 2 passed"

# Test 3: List groups
echo "Test 3: List groups..."
LIST_OUTPUT=$($CLI_CMD group list 2>&1)
if ! echo "$LIST_OUTPUT" | grep -q "test-group-1"; then
    echo "❌ Error: Group list does not contain test-group-1"
    exit 1
fi

echo "✓ Test 3 passed"

# Test 4: Show group details with numbered order
echo "Test 4: Show group details..."
SHOW_OUTPUT=$($CLI_CMD group show test-group-1 2>&1)
if ! echo "$SHOW_OUTPUT" | grep -q "test-group-1"; then
    echo "❌ Error: Show output does not contain group name"
    exit 1
fi

if ! echo "$SHOW_OUTPUT" | grep -q "1\. test-group-profile-a"; then
    echo "❌ Error: Show output does not contain first profile in order"
    exit 1
fi

if ! echo "$SHOW_OUTPUT" | grep -q "2\. test-group-profile-b"; then
    echo "❌ Error: Show output does not contain second profile in order"
    exit 1
fi

echo "✓ Test 4 passed"

# Test 5: Create second group
echo "Test 5: Create second group..."
$CLI_CMD group create test-group-2 --profiles test-group-profile-b

# Verify second group exists
if ! jq -e '.groups[] | select(.name == "test-group-2")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Group test-group-2 does not exist"
    exit 1
fi

echo "✓ Test 5 passed"

# Test 6: Edit group name and profiles
echo "Test 6: Edit group..."
$CLI_CMD group edit test-group-2 --name test-group-2-renamed --profiles test-group-profile-a,test-group-profile-b

# Verify renamed group exists
if ! jq -e '.groups[] | select(.name == "test-group-2-renamed")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Group test-group-2-renamed does not exist"
    exit 1
fi

# Verify old name no longer exists
if jq -e '.groups[] | select(.name == "test-group-2")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Old group name test-group-2 should not exist"
    exit 1
fi

# Verify edited profile order is preserved
EDIT_FIRST_PROFILE=$(jq -r '.groups[] | select(.name == "test-group-2-renamed") | .profiles[0]' "$CONFIG_FILE")
EDIT_SECOND_PROFILE=$(jq -r '.groups[] | select(.name == "test-group-2-renamed") | .profiles[1]' "$CONFIG_FILE")
if [ "$EDIT_FIRST_PROFILE" != "test-group-profile-a" ] || [ "$EDIT_SECOND_PROFILE" != "test-group-profile-b" ]; then
    echo "❌ Error: Edited group profile order should be preserved"
    exit 1
fi

# Verify show output matches edited order
EDIT_SHOW_OUTPUT=$($CLI_CMD group show test-group-2-renamed 2>&1)
if ! echo "$EDIT_SHOW_OUTPUT" | grep -q "1\. test-group-profile-a"; then
    echo "❌ Error: Edited show output does not contain first profile in order"
    exit 1
fi

if ! echo "$EDIT_SHOW_OUTPUT" | grep -q "2\. test-group-profile-b"; then
    echo "❌ Error: Edited show output does not contain second profile in order"
    exit 1
fi

echo "✓ Test 6 passed"

# Test 7: Reject duplicate profiles during group create
echo "Test 7: Reject duplicate profiles during group create..."
if DUPLICATE_OUTPUT=$($CLI_CMD group create test-group-duplicate --profiles test-group-profile-a,test-group-profile-a 2>&1); then
    $CLI_CMD group delete test-group-duplicate --force 2>/dev/null || true
    echo "❌ Error: Should reject duplicate profiles during group create"
    exit 1
fi

if ! echo "$DUPLICATE_OUTPUT" | grep -qi "duplicate"; then
    echo "❌ Error: Duplicate profile create failure should mention duplicate profiles"
    echo "$DUPLICATE_OUTPUT"
    exit 1
fi

if jq -e '.groups[] | select(.name == "test-group-duplicate")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Duplicate profile create should not persist a group"
    exit 1
fi

echo "✓ Test 7 passed"

# Test 8: Reject unknown profiles during group create
echo "Test 8: Reject unknown profiles during group create..."
if UNKNOWN_OUTPUT=$($CLI_CMD group create test-group-unknown --profiles missing-profile,test-group-profile-a 2>&1); then
    $CLI_CMD group delete test-group-unknown --force 2>/dev/null || true
    echo "❌ Error: Should reject unknown profiles during group create"
    exit 1
fi

if ! echo "$UNKNOWN_OUTPUT" | grep -qi "unknown profiles\|unknown profile\|missing-profile"; then
    echo "❌ Error: Unknown profile create failure should mention unknown profiles"
    echo "$UNKNOWN_OUTPUT"
    exit 1
fi

if jq -e '.groups[] | select(.name == "test-group-unknown")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Unknown profile create should not persist a group"
    exit 1
fi

echo "✓ Test 8 passed"

# Test 9: Reject blank group name during group edit
echo "Test 9: Reject blank group name during group edit..."
if BLANK_NAME_OUTPUT=$($CLI_CMD group edit test-group-2-renamed --name "   " 2>&1); then
    echo "❌ Error: Should reject blank group name during group edit"
    exit 1
fi

if ! echo "$BLANK_NAME_OUTPUT" | grep -qi "name"; then
    echo "❌ Error: Blank group name edit failure should mention the group name"
    echo "$BLANK_NAME_OUTPUT"
    exit 1
fi

if ! echo "$BLANK_NAME_OUTPUT" | grep -qi "blank\|empty\|invalid\|required"; then
    echo "❌ Error: Blank group name edit failure should be clear"
    echo "$BLANK_NAME_OUTPUT"
    exit 1
fi

if ! jq -e '.groups[] | select(.name == "test-group-2-renamed")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Blank group name edit should leave the original group untouched"
    exit 1
fi

echo "✓ Test 9 passed"

# Test 10: Set default group
echo "Test 10: Set default group..."
$CLI_CMD group set-default test-group-2-renamed

# Verify test-group-2-renamed is now default
IS_DEFAULT=$(jq -r '.groups[] | select(.name == "test-group-2-renamed") | .isDefault' "$CONFIG_FILE")
if [ "$IS_DEFAULT" != "true" ]; then
    echo "❌ Error: test-group-2-renamed should be default, got $IS_DEFAULT"
    exit 1
fi

# Verify test-group-1 is no longer default
IS_DEFAULT_1=$(jq -r '.groups[] | select(.name == "test-group-1") | .isDefault' "$CONFIG_FILE")
if [ "$IS_DEFAULT_1" != "false" ]; then
    echo "❌ Error: test-group-1 should not be default anymore"
    exit 1
fi

echo "✓ Test 10 passed"

# Test 11: Delete group
echo "Test 11: Delete group..."
$CLI_CMD group delete test-group-1 --force 2>/dev/null

# Verify group is deleted
if jq -e '.groups[] | select(.name == "test-group-1")' "$CONFIG_FILE" > /dev/null; then
    echo "❌ Error: Group test-group-1 should be deleted"
    exit 1
fi

echo "✓ Test 11 passed"

# Test 12: Verify proxy status shows not running
echo "Test 12: Check proxy status..."
STATUS_OUTPUT=$($CLI_CMD proxy status 2>&1)
if ! echo "$STATUS_OUTPUT" | grep -q "Not running"; then
    echo "❌ Error: Proxy should not be running"
    exit 1
fi

echo "✓ Test 12 passed"

echo "✅ All group management tests passed"
