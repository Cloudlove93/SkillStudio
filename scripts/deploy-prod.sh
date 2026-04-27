#!/bin/bash
set -e

# 生产部署脚本
# 用法：在 EduClaw-arena 目录下执行 bash scripts/deploy-prod.sh

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== 生产环境部署 ==="

# 1. 安装依赖
echo "[1/5] 安装依赖..."
pnpm install

# 2. 构建 educlaw-shared
echo "[2/5] 构建 educlaw-shared..."
cd "$PROJECT_DIR/educlaw-shared"
pnpm build

# 3. 构建后端
echo "[3/5] 构建 educlaw-server..."
cd "$PROJECT_DIR/educlaw-server"
pnpm build

# 4. 构建前端
echo "[4/5] 构建 educlaw-web..."
cd "$PROJECT_DIR/educlaw-web"
pnpm build

# 5. 启动
echo "[5/5] 启动服务..."
cd "$PROJECT_DIR"

# 启动后端（如果已经有 tmux session 就先杀掉）
tmux kill-session -t educlaw-server 2>/dev/null || true
tmux new-session -d -s educlaw-server "cd $PROJECT_DIR/educlaw-server && node dist/index.js"

echo ""
echo "=== 部署完成 ==="
echo "后端: tmux session 'educlaw-server' 已在后台运行"
echo "前端静态文件: $PROJECT_DIR/educlaw-web/dist/"
echo ""
echo "前端需要用 nginx 等托管 dist/ 目录"
echo "查看后端日志: tmux attach -t educlaw-server"
echo "分离 tmux: 按 Ctrl+B 然后 D"
