# EduClaw Arena 版 - 生产部署完整流程

## 一、环境准备

远程服务器需要：
- Ubuntu 20.04+（或其他 Linux）
- Node.js 20+、`pnpm`、`npm`
- PostgreSQL 16（已有数据库服务，端口 5435）
- 服务器外网 IP 或内网 IP

检查是否已安装：
```bash
node --version    # 需 >= 20
pnpm --version    # 需 >= 9
npm --version
```

没装的话：
```bash
curl -fsSL https://get.pnpm.io/install.sh | sh -
source ~/.bashrc
```

---

## 二、克隆代码

```bash
cd /inspire/qb-ilm/project/ai4education/zhouaimin-p-zhouaimin/lzx
git clone -b arena https://github.com/EduClaw-InnoSpark/EduClaw.git EduClaw-arena
cd EduClaw-arena
```

---

## 三、配置环境变量

```bash
cp .env.example .env
vim .env
```

**必须修改的项：**

```
DATABASE_URL=postgres://educlawlite:你的数据库密码@127.0.0.1:5435/educlawlite
LLM_BASE_URL=https://api.moonshot.ai/v1
LLM_API_KEY=你的API密钥
LLM_MODEL=kimi-k2.6
LLM_BASELINE_MODEL=kimi-k2.6
APP_ORIGIN=http://你的服务器IP
SEED_USERS=false
```

如果需要预置登录账号，请显式开启并设置强密码：

```
SEED_USERS=true
SEED_USER_NAMES=user1,user2,user3,user4,user5
SEED_USER_PASSWORD=换成至少12位的强密码
```

---

## 四、一键构建

```bash
bash scripts/deploy-prod.sh
```

这个脚本会自动完成：
1. `pnpm install` 安装依赖
2. 构建 `educlaw-shared`
3. 构建 `educlaw-server`
4. 构建 `educlaw-web`

---

## 五、启动后端

```bash
cd educlaw-server
tmux new-session -d -s educlaw-server "node dist/index.js"
```

验证后端是否启动：
```bash
curl http://localhost:3000/healthz
# 应返回 {"ok":true,"service":"educlaw-lite-server"}
```

---

## 六、启动前端

```bash
cd educlaw-web/dist

# 首次安装 serve
npm install -g serve

# 启动前端（80端口，支持SPA路由）
nohup serve -l 80 --single > /tmp/educlaw-web.log 2>&1 &
```

验证前端：
```bash
curl -s http://localhost/ | head -1
# 应返回 <!doctype html>
```

---

## 七、放行防火墙（关键！）

如果浏览器访问不了，大概率是防火墙没开 80 端口：

```bash
# Ubuntu
ufw allow 80/tcp
ufw reload

# 或 CentOS
firewall-cmd --permanent --add-port=80/tcp
firewall-cmd --permanent --add-port=3000/tcp
firewall-cmd --reload
```

---

## 八、浏览器访问

查看服务器 IP：
```bash
hostname -I
```

浏览器地址栏输入：
```
http://服务器IP
```

如果启用了预置账号，登录用户名和密码以 `.env` 中的 `SEED_USER_NAMES` / `SEED_USER_PASSWORD` 为准。公网环境不要使用默认密码。

---

## 常用运维

```bash
# 查看后端日志
tmux attach -t educlaw-server
# 分离：Ctrl+B 然后 D

# 停止后端
tmux kill-session -t educlaw-server

# 停止前端
pkill -f "serve -l 80"

# 重启前端
cd educlaw-web/dist
nohup serve -l 80 --single > /tmp/educlaw-web.log 2>&1 &

# 更新代码后重新部署
git pull origin arena
bash scripts/deploy-prod.sh
```
