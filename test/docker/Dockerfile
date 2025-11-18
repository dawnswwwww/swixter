# Swixter E2E 测试环境
FROM oven/bun:latest

# 安装基础工具
RUN apt-get update && apt-get install -y \
    jq \
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
