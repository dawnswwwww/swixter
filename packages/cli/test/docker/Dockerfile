# Swixter E2E 测试环境
# 注意：基础镜像的 glibc 必须与构建侧对齐——CI 在 rust:1-bookworm 容器内构建
# 二进制（e2e-docker.sh 的 E2E_BUILD_IN_CONTAINER=1 分支），两者同为 bookworm。
FROM debian:bookworm-slim

# 安装基础工具
RUN apt-get update && apt-get install -y \
    jq \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 创建测试用户
RUN useradd -m -s /bin/bash testuser

# 切换到测试用户
USER testuser
WORKDIR /home/testuser

# 创建配置目录
RUN mkdir -p /home/testuser/.config/swixter

# 设置默认命令
CMD ["/bin/bash"]
