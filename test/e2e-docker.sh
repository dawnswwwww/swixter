#!/bin/bash
# Swixter E2E Docker 测试脚本
# 在隔离的Docker容器中测试CLI所有功能

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目根目录
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   Swixter E2E Docker 测试${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# 步骤 1: 构建 Docker 镜像
echo -e "${YELLOW}[1/5]${NC} 构建 Docker 测试镜像..."
docker build -t swixter-test -f test/docker/Dockerfile . > /dev/null 2>&1
echo -e "${GREEN}✓${NC} Docker 镜像构建成功"
echo ""

# 步骤 2: 启动测试容器
echo -e "${YELLOW}[2/5]${NC} 启动测试容器..."
CONTAINER_ID=$(docker run -d swixter-test sleep 300)
echo -e "${GREEN}✓${NC} 容器已启动: ${CONTAINER_ID:0:12}"
echo ""

# 清理函数
cleanup() {
    echo ""
    echo -e "${YELLOW}清理资源...${NC}"
    docker rm -f "$CONTAINER_ID" > /dev/null 2>&1 || true
    echo -e "${GREEN}✓ 清理完成${NC}"
}

# 注册清理函数
trap cleanup EXIT INT TERM

# 步骤 3: 复制源代码到容器
echo -e "${YELLOW}[3/5]${NC} 复制源代码到容器..."
docker cp ./src "$CONTAINER_ID:/home/testuser/"
docker cp ./package.json "$CONTAINER_ID:/home/testuser/"
docker cp ./bun.lock "$CONTAINER_ID:/home/testuser/" 2>/dev/null || true
docker cp test/scenarios "$CONTAINER_ID:/home/testuser/"
echo -e "${GREEN}✓${NC} 文件复制成功"
echo ""

# 步骤 4: 安装依赖
echo -e "${YELLOW}[4/5]${NC} 安装依赖..."
docker exec -u testuser "$CONTAINER_ID" sh -c 'cd /home/testuser && bun install > /dev/null 2>&1'
echo -e "${GREEN}✓${NC} 依赖安装成功"
echo ""

# 步骤 5: 运行测试场景
echo -e "${YELLOW}[5/5]${NC} 运行测试场景..."
echo ""

TESTS_PASSED=0
TESTS_FAILED=0

# 测试场景列表
SCENARIOS=(
    "test-create.sh"
    "test-switch.sh"
    "test-list.sh"
    "test-export-import.sh"
    "test-delete.sh"
)

for scenario in "${SCENARIOS[@]}"; do
    TEST_NAME=$(basename "$scenario" .sh | sed 's/test-//')
    echo -e "${BLUE}▸${NC} 运行测试: ${YELLOW}${TEST_NAME}${NC}"

    if docker exec -u testuser "$CONTAINER_ID" bash "/home/testuser/scenarios/$scenario" 2>&1 | tee /tmp/test-output.log | grep -q "✅"; then
        echo -e "${GREEN}  ✓ 通过${NC}"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        echo -e "${RED}  ✗ 失败${NC}"
        cat /tmp/test-output.log
        TESTS_FAILED=$((TESTS_FAILED + 1))
    fi
    echo ""
done

# 步骤 6: 显示测试报告
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}   测试报告${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "总测试数: ${BLUE}${#SCENARIOS[@]}${NC}"
echo -e "通过: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "失败: ${RED}${TESTS_FAILED}${NC}"
echo ""

# 如果有验证配置文件，显示最终配置
echo -e "${YELLOW}最终配置状态:${NC}"
docker exec -u testuser "$CONTAINER_ID" cat /home/testuser/.config/swixter/config.json | jq '.activeProfile, (.profiles | keys)'
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}   ✓ 所有测试通过！${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 0
else
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}   ✗ 有测试失败${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    exit 1
fi
