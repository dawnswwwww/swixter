#!/bin/bash
# 测试模型配置交互

echo "test-interactive-model" | \
node dist/cli/index.js claude create --quiet \
  --provider anthropic \
  --api-key sk-test-123 \
  --anthropic-model claude-3-5-sonnet-20241022 \
  --default-haiku-model claude-3-5-haiku-20241022
