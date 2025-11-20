#!/bin/bash
# Swixter E2E Docker Test Script
# Tests all CLI functionality in an isolated Docker container

set -e

# Color definitions
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Project root directory
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Swixter E2E Docker Tests${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Step 1: Build project
echo -e "${YELLOW}[1/5]${NC} Building project..."
bun run build > /dev/null 2>&1
echo -e "${GREEN}✓${NC} Project build successful"
echo ""

# Step 2: Build Docker image
echo -e "${YELLOW}[2/5]${NC} Building Docker test image..."
docker build -t swixter-test -f test/docker/Dockerfile . > /dev/null 2>&1
echo -e "${GREEN}✓${NC} Docker image build successful"
echo ""

# Step 3: Start test container
echo -e "${YELLOW}[3/5]${NC} Starting test container..."
CONTAINER_ID=$(docker run -d swixter-test sleep 300)
echo -e "${GREEN}✓${NC} Container started: ${CONTAINER_ID:0:12}"
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo -e "${YELLOW}Cleaning up resources...${NC}"
    docker rm -f "$CONTAINER_ID" > /dev/null 2>&1 || true
    echo -e "${GREEN}✓ Cleanup complete${NC}"
}

# Register cleanup function
trap cleanup EXIT INT TERM

# Step 4: Copy build artifacts and test scripts to container
echo -e "${YELLOW}[4/5]${NC} Copying files to container..."
docker cp ./dist "$CONTAINER_ID:/home/testuser/"
docker cp test/scenarios "$CONTAINER_ID:/home/testuser/"
# Ensure test scripts have execute permissions (must run chmod and chown as root)
docker exec -u root "$CONTAINER_ID" sh -c 'chmod +x /home/testuser/scenarios/*.sh && chown -R testuser:testuser /home/testuser/scenarios /home/testuser/dist'
echo -e "${GREEN}✓${NC} Files copied successfully"
echo ""

# Step 5: Run test scenarios
echo -e "${YELLOW}[5/5]${NC} Running test scenarios..."
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Test scenario list
SCENARIOS=(
    "test-create.sh"
    "test-switch.sh"
    "test-list.sh"
    "test-aliases.sh"
    "test-apply.sh"
    "test-export-import.sh"
    "test-delete.sh"
    "test-errors.sh"
)

for scenario in "${SCENARIOS[@]}"; do
    TEST_NAME=$(basename "$scenario" .sh | sed 's/test-//')
    echo -e "${BLUE}▸${NC} Running test: ${YELLOW}${TEST_NAME}${NC}"

    if docker exec -u testuser "$CONTAINER_ID" bash "/home/testuser/scenarios/$scenario" 2>&1 | tee /tmp/test-output.log | grep -q "✅"; then
        echo -e "${GREEN}  ✓ Pass${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}  ✗ Fail${NC}"
        cat /tmp/test-output.log
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    echo ""
done

# Step 6: Display test report
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Test Report${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "Total tests: ${BLUE}${#SCENARIOS[@]}${NC}"
echo -e "Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Failed: ${RED}${TESTS_FAILED}${NC}"
echo ""

# If there's a config file to validate, display final configuration
echo -e "${YELLOW}Final configuration state:${NC}"
docker exec -u testuser "$CONTAINER_ID" cat /home/testuser/.config/swixter/config.json 2>/dev/null | jq '.coders, (.profiles | keys)' || echo "Configuration file does not exist"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}   ✓ All tests passed!${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}   ✗ Some tests failed${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
