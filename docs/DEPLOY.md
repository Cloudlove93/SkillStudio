# EduClaw Arena 版 - 远程服务器部署文档

## 环境要求

- Ubuntu / CentOS（本文档以 Ubuntu 为例）
- Node.js 20+、pnpm、npm
- PostgreSQL 16（可复用已有数据库，端口 5435）
- 外网可访问的服务器 IP

## 1. 克隆代码

```bash
cd /your/project/path
git clone -b arena https://github.com/EduClaw-InnoSpark/EduClaw.git EduClaw-arena
cd EduClaw-arena
```

## 2. 配置环境变量

```bash
cp .env.example .env
vim .env
```

至少修改以下几项：

| 变量 | 说明 | 示例 |
|------|------|------|
| `DATABASE_URL` | PostgreSQL 连接串 | `postgres://educlawlite:密码@127.0.0.1:5435/educlawlite` |
| `LLM_BASE_URL` | LLM API 地址 | `https://your-api.com/v1` |
| `LLM_API_KEY` | LLM API Key | `sk-xxxxxxxx` |
| `LLM_MODEL` | 模型名称 | `Kimi-K2.6` |
| `JWT_SECRET` | JWT 签名密钥 | 任意长随机字符串 |
| `APP_ORIGIN` | 前端访问地址 | `http://服务器IP` |

## 3. 安装依赖并构建

```bash
pnpm install

# 构建共享模块
cd educlaw-shared && pnpm build && cd ..

# 构建后端
cd educlaw-server && pnpm build && cd ..

# 构建前端
cd educlaw-web && pnpm build && cd ..
```

## 4. 启动后端（tmux 后台运行）

```bash
cd educlaw-server

tmux new-session -d -s educlaw-server "node dist/index.js"
```

查看日志：
```bash
tmux attach -t educlaw-server
# 分离 tmux：按 Ctrl+B 然后 D
```

验证后端是否启动：
```bash
curl http://localhost:3000/healthz
# 应返回 {"ok":true,"service":"educlaw-lite-server"}
```

## 5. 启动前端（serve 托管静态文件）

```bash
cd educlaw-web/dist

# 安装 serve（首次）
npm install -g serve

# 后台启动，80 端口，支持 SPA 路由回退
nohup serve -l 80 --single > /tmp/educlaw-web.log 2>&1 &
```

验证前端：
```bash
curl -s http://localhost/ | head -1
# 应返回 <!doctype html>
```

## 6. 浏览器访问

在服务器上查看 IP：
```bash
hostname -I
```

浏览器地址栏输入：
```
http://服务器IP
```

## 7. 预置账号

部署完成后，15 个预置账号会自动创建：

- 用户名：`user1` ~ `user15`
- 密码统一为：`educlaw123`

## 常用运维命令

```bash
# 查看后端日志
tmux attach -t educlaw-server

# 停止后端
tmux kill-session -t educlaw-server

# 停止前端
pkill -f "serve -l 80"

# 重启前端
cd /your/project/path/EduClaw-arena/educlaw-web/dist
nohup serve -l 80 --single > /tmp/educlaw-web.log 2>&1 &

# 查看前端日志
cat /tmp/educlaw-web.log
```

## 更新代码

```bash
cd /your/project/path/EduClaw-arena
git pull origin arena
bash scripts/deploy-prod.sh
```

## 故障排查

| 问题 | 解决 |
|------|------|
| 后端启动失败 | 检查 `.env` 中的 `DATABASE_URL` 和 `LLM_API_KEY` |
| 前端 404 | 确认 `serve` 是在 `educlaw-web/dist` 目录下启动的 |
| 登录后空白 | 刷新页面，清除浏览器缓存 |
| LLM 调用失败 | 检查 `LLM_BASE_URL` 和 `LLM_API_KEY` 是否正确 |
