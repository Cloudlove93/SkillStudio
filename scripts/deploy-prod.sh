#!/bin/bash
set -e

# 生产部署脚本 - 一键构建 + 启动后端
# 用法：在 EduClaw-arena 目录下执行 bash scripts/deploy-prod.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== EduClaw Arena 生产部署 ==="

# 1. 安装依赖
echo "[1/4] 安装依赖..."
pnpm install

# 2. 构建 educlaw-shared
echo "[2/4] 构建 educlaw-shared..."
cd "$PROJECT_DIR/educlaw-shared"
pnpm build

# 3. 构建后端
echo "[3/4] 构建 educlaw-server..."
cd "$PROJECT_DIR/educlaw-server"
pnpm build

# 4. 构建前端
echo "[4/4] 构建 educlaw-web..."
cd "$PROJECT_DIR/educlaw-web"
pnpm build

echo ""
echo "=== 构建完成 ==="
echo ""
echo "接下来执行："
echo "  1. 启动后端：cd educlaw-server && tmux new-session -d -s educlaw-server 'node dist/index.js'"
echo "  2. 启动前端：cd educlaw-web/dist && serve -l 80 --single"
echo "  3. 浏览器访问：http://服务器IP"
