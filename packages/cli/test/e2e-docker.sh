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

# Step 1: Build project (Rust binary; use E2E_CARGO_PROFILE=debug for faster local iteration)
CARGO_PROFILE="${E2E_CARGO_PROFILE:-release}"
echo -e "${YELLOW}[1/5]${NC} Building project (cargo build --$CARGO_PROFILE)..."
if [ "$CARGO_PROFILE" = "release" ]; then
    cargo build --release > /dev/null 2>&1
else
    cargo build > /dev/null 2>&1
fi
SWIXTER_BIN="$PROJECT_ROOT/target/$CARGO_PROFILE/swixter"
if [ ! -x "$SWIXTER_BIN" ]; then
    echo -e "${RED}✗${NC} Binary not found: $SWIXTER_BIN"
    exit 1
fi
echo -e "${GREEN}✓${NC} Project build successful"
echo ""

# Step 1b: 非 Linux 主机（如 macOS）产出的二进制无法在 Linux 容器内运行，
# 在 rust 容器内交叉构建 Linux 二进制（registry 用命名卷缓存，产物输出到
# 独立 target/e2e-linux，避免与主机 target 互相污染；CI 的 Linux 主机不走此分支）
if ! file -b "$SWIXTER_BIN" | grep -q "ELF"; then
    echo -e "${YELLOW}[1b]${NC} Host binary is not Linux ELF; building Linux binary in container..."
    docker run --rm \
        -v "$PROJECT_ROOT:/ws" -w /ws \
        -v swixter-e2e-cargo-registry:/usr/local/cargo/registry \
        -e CARGO_TARGET_DIR=/ws/target/e2e-linux \
        rust:1-bookworm \
        cargo build --release -p swixter > /dev/null 2>&1
    SWIXTER_BIN="$PROJECT_ROOT/target/e2e-linux/release/swixter"
    if [ ! -x "$SWIXTER_BIN" ]; then
        echo -e "${RED}✗${NC} Linux binary not found: $SWIXTER_BIN"
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Linux binary build successful"
    echo ""
fi

# Step 2: Build Docker image
echo -e "${YELLOW}[2/5]${NC} Building Docker test image..."
docker build --no-cache -t swixter-test -f test/docker/Dockerfile . > /dev/null 2>&1
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

# Step 4: Copy binary and test scripts to container
echo -e "${YELLOW}[4/5]${NC} Copying files to container..."
docker cp "$SWIXTER_BIN" "$CONTAINER_ID:/home/testuser/swixter"
docker cp test/scenarios "$CONTAINER_ID:/home/testuser/"
# Ensure test scripts have execute permissions (must run chmod and chown as root)
docker exec -u root "$CONTAINER_ID" sh -c 'chmod +x /home/testuser/scenarios/*.sh /home/testuser/swixter && chown -R testuser:testuser /home/testuser/scenarios /home/testuser/swixter'
echo -e "${GREEN}✓${NC} Files copied successfully"
echo ""

# Step 5: Run test scenarios
echo -e "${YELLOW}[5/5]${NC} Running test scenarios..."
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# Test scenario list (all 18; the 4 model/provider scenarios were missing in the TS era)
# 顺序说明：前 14 个依赖逐步累积的配置状态；4 个补充场景自带状态
# （test-claude-models 会清空 swixter config 重建），放在最后执行。
SCENARIOS=(
    "test-install-detection.sh"
    "test-install-command.sh"
    "test-update-command.sh"
    "test-create.sh"
    "test-switch.sh"
    "test-list.sh"
    "test-aliases.sh"
    "test-apply.sh"
    "test-export-import.sh"
    "test-delete.sh"
    "test-errors.sh"
    "test-group.sh"
    "test-proxy.sh"
    "test-daemon.sh"
    "test-claude-models.sh"
    "test-codex-models.sh"
    "test-qwen-models.sh"
    "test-providers.sh"
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
