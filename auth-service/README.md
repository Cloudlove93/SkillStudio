# Auth Service

统一认证服务，负责所有用户的登录、注册和登出。其他业务服务不处理认证，通过 Kong 网关获取用户身份。

pnpm workspace monorepo，包含两个子包：`auth-backend`（Express 5 API）和 `auth-frontend`（React 19 SPA）。

## 架构

### Docker 服务编排

```
                         ┌──────────────────────────────────────────┐
                         │           Docker (internal-net)          │
                         │                                          │
  浏览器 ──────────────► │  ┌─────────────────────────────────────┐  │
  auth.localhost:80      │  │  Kong :80                           │  │
  app.localhost:80       │  │  ┌─ oidc-jwt-auth 插件（Lua）       │  │
  edunex.localhost:80    │  │  │  · 校验 JWT 签名（Zitadel JWKS） │  │
                         │  │  │  · 注入 X-User-Id/Username/Email │  │
                         │  │  └──────────────────────────────────│  │
                         │  └──────┬──────────┬──────────┬────────┘  │
                         │         │          │          │            │
                auth.localhost 路由│          │          │业务域路由
                         │         ▼          ▼          ▼            │
                         │  ┌──────────┐ ┌──────────┐ ┌────────────┐ │
                         │  │auth-front│ │  Zitadel │ │ educlaw-   │ │
                         │  │end  :80  │ │  :8080   │ │ server:3000│ │
                         │  │(Nginx+SPA│ │ (OIDC    │ │ (业务后端) │ │
                         │  │ 代理/API)│ │  IdP)    │ │            │ │
                         │  └────┬─────┘ └────┬─────┘ └────────────┘ │
                         │       │ proxy      │                       │
                         │       ▼            ▼                       │
                         │  ┌──────────┐ ┌──────────┐                │
                         │  │auth-back │ │PostgreSQL│                │
                         │  │end  :3000│ │  :5432   │                │
                         │  │(Express) │ │ (educlaw)│                │
                         │  └──────────┘ └──────────┘                │
                         │       │                                    │
                         │       ▼                                    │
                         │  ┌──────────────────┐                     │
                         │  │ Zitadel Login UI │                     │
                         │  │    :3000         │                     │
                         │  │ /ui/v2/login     │                     │
                         │  └──────────────────┘                     │
                         │  ┌──────────┐ ┌──────────┐ ┌────────────┐ │
                         │  │ edunex-  │ │ edunex-  │ │ edunex-    │ │
                         │  │ web :80  │ │ server   │ │ postgres   │ │
                         │  │          │ │ :4000    │ │ :5432      │ │
                         │  └──────────┘ └──────────┘ └────────────┘ │
                         └──────────────────────────────────────────┘
```

### 认证域与业务域分离

```
auth.localhost（认证域）                           app.localhost / edunex.localhost（业务域）
┌─────────────────────────────┐                  ┌─────────────────────────┐
│  auth-frontend              │                  │  educlaw-web            │
│  ┌─────────────────────┐    │                  │  不处理登入/注册         │
│  │ /login    登录页     │    │                  │  从 NavPage 跳转进入     │
│  │ /register 注册页     │    │    token         │  通过 URL hash 接收 token│
│  │ /nav     导航页 ─────┼────┼──────────────►   │  请求带 Bearer token    │
│  └─────────────────────┘    │                  └────────────┬────────────┘
│                             │                               │
│  auth-backend               │                               ▼
│  POST /auth/password        │                  ┌─────────────────────────┐
│  POST /auth/sms/*           │                  │  Kong 网关               │
│  POST /auth/logout          │                  │  校验 JWT 签名           │
│  GET  /auth/me              │                  │  注入 X-User-Id 等头     │
│  POST /sms/send             │                  │  转发到业务后端           │
└─────────────────────────────┘                  └────────────┬────────────┘
                                                              ▼
                                                 ┌─────────────────────────┐
                                                 │  educlaw-server /        │
                                                 │  edunex-server           │
                                                 │  读取 X-User-Id 头       │
                                                 │  不校验 JWT              │
                                                 │  不处理登入/注册          │
                                                 └─────────────────────────┘
```

核心原则：

- **auth-service 是唯一的认证入口**，处理所有登入/注册/登出
- **Kong 是统一网关**，所有请求经 Kong 路由，JWT 校验在网关层完成
- **业务服务通过 NavPage 进入**，用户在 `/nav` 选择服务后跳转
- **业务服务通过 Kong 获取用户身份**，Kong 校验 JWT 后注入 `X-User-Id` 等请求头
- **业务服务不需要处理认证**，只读取 Kong 注入的用户信息

当前 host 规划：

- `auth.localhost` — 认证域，承载 auth-frontend、auth-backend、Zitadel OIDC 端点和 Zitadel Login UI
- `app.localhost` — EduClaw 业务域，保留现有 EduClaw 路由和服务名
- `edunex.localhost` — EduNex 业务域，页面流量转发到 `edunex-web`，`/api/*` 经 JWT 校验后转发到 `edunex-server`

## 功能

后端 API（auth-backend）：

- 用户名密码登录（编程式 OIDC 流程，PKCE，不跳转 Zitadel UI）
- 用户注册（自动创建 Zitadel 用户、分配角色并登入）
- 登出（吊销 refresh_token 和 access_token）
- 返回当前登录用户信息和角色（`GET /auth/me`）
- 短信验证码发送（阿里云 Dypnsapi，OTP 6 位，5 分钟有效）
- 短信验证码登录（手机号 + OTP）
- 短信验证码注册（手机号 + OTP + 用户名密码）
- Zitadel 自定义 SMS Provider 端点（`POST /sms/send`）
- OTP 速率限制：每个手机号 10 分钟内最多 3 条短信，每个验证码最多 5 次验证尝试

前端 SPA（auth-frontend）：

- 登录页（密码 + 短信验证码双 Tab）、注册页（密码 + 短信验证码双 Tab）、服务导航页（NavPage）
- 国际手机号输入组件（支持 15 个国家/地区区号）
- 集中式登入状态检查（App 挂载时执行 checkAuth）
- 已登入用户访问 `/login`、`/register` 自动跳转 `/nav`
- 未登入用户访问 `/nav` 自动跳转 `/login`
- Token 存储在 `localStorage`（跨标签页共享）
- 支持 `?logout` 参数清除 token（用于业务服务跨域登出跳转）
- 支持 `?returnTo=` 参数，登录/注册完成后跳转到指定 URL（同域或子域）
- 跨域 token 传递：通过 URL hash `#token=...` 将 token 传给业务服务
- 亮色/暗色主题切换
- 中英文国际化（zh/en）

## 技术栈

| 层       | 技术                                                               |
| -------- | ------------------------------------------------------------------ |
| 后端     | Node.js 20 + Express 5 + TypeScript 5.9（ESM）                     |
| 前端     | React 19 + React Router 7 + Zustand 5 + Tailwind CSS 4 + shadcn/ui |
| 身份认证 | Zitadel v4.13.1（OIDC/OAuth2）                                     |
| 短信     | 阿里云 Dypnsapi                                                    |
| API 网关 | Kong 3.6（自定义 Lua JWT 插件）                                    |
| 数据库   | PostgreSQL 17                                                      |
| 容器化   | Docker / Docker Compose                                            |
| 包管理   | pnpm 10.30.2（workspace monorepo）                                 |

## 认证流程

### 密码登录

```
浏览器              auth-frontend         auth-backend            Zitadel
  │                     │                     │                     │
  │  POST /auth/password│                     │                     │
  │────────────────────►│  proxy              │                     │
  │                     │────────────────────►│                     │
  │                     │                     │  createSession()    │
  │                     │                     │────────────────────►│
  │                     │                     │  sessionId          │
  │                     │                     │◄────────────────────│
  │                     │                     │  OIDC auth request  │
  │                     │                     │  (PKCE S256)        │
  │                     │                     │────────────────────►│
  │                     │                     │  authorization code │
  │                     │                     │◄────────────────────│
  │                     │                     │  exchange code →    │
  │                     │                     │  tokens             │
  │                     │                     │────────────────────►│
  │                     │                     │  access_token       │
  │                     │                     │  refresh_token      │
  │                     │◄────────────────────│                     │
  │◄────────────────────│                     │                     │
  │  tokens             │                     │                     │
  │  (存入 localStorage)│                     │                     │
```

### 跨域接入业务服务

```
浏览器(auth域)      auth-frontend         浏览器(app域)         Kong              educlaw-server
  │                     │                     │                  │                     │
  │  /nav 选择服务      │                     │                  │                     │
  │────────────────────►│                     │                  │                     │
  │  跳转               │                     │                  │                     │
  │  app.localhost/     │                     │                  │                     │
  │  #token=<token>     │                     │                  │                     │
  │                     │                     │                  │                     │
  │                     │                     │  从 hash 提取     │                     │
  │                     │                     │  token 存入       │                     │
  │                     │                     │  localStorage     │                     │
  │                     │                     │                  │                     │
  │                     │                     │  API 请求          │                     │
  │                     │                     │  Authorization:   │                     │
  │                     │                     │  Bearer <token>   │                     │
  │                     │                     │─────────────────►│  校验 JWT           │
  │                     │                     │                  │  注入 X-User-Id     │
  │                     │                     │                  │────────────────────►│
  │                     │                     │                  │                     │
  │                     │                     │                  │  响应                │
  │                     │                     │◄─────────────────│◄────────────────────│
```

## 目录结构

```
auth-service/
├── auth-backend/               # 后端 API 服务
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts            # Express 入口
│       ├── config.ts           # 环境变量配置
│       ├── logger.ts           # Pino 日志
│       ├── routes/auth.ts      # Auth 路由
│       ├── middleware/auth.ts   # 读取 Kong 注入的 X-User-* 头
│       └── services/
│           ├── zitadel-user.ts # Zitadel 用户 API 封装
│           ├── sms.ts          # 阿里云短信发送
│           └── otp.ts          # OTP 生成/验证/速率限制
├── auth-frontend/              # 前端 SPA
│   ├── Dockerfile
│   ├── nginx.conf.template     # 生产环境 Nginx 配置
│   ├── vite.config.ts
│   ├── package.json
│   └── src/
│       ├── App.tsx             # 路由 + RequireAuth
│       ├── main.tsx            # React 入口
│       ├── api/
│       │   ├── auth.ts         # 前端 auth API
│       │   └── client.ts       # fetch 封装（自动附带 Bearer token）
│       ├── stores/auth.ts      # Zustand auth store
│       ├── pages/
│       │   ├── LoginPage.tsx   # 登录页（密码 + 短信验证码 Tab）
│       │   ├── RegisterPage.tsx# 注册页（密码 + 短信验证码 Tab）
│       │   ├── NavPage.tsx     # 登录后服务导航页（角色门控）
│       │   └── auth-form-*.ts  # 表单 hooks 和公共组件
│       ├── components/
│       │   ├── phone-input.tsx # 国际手机号输入组件
│       │   ├── language-toggle.tsx
│       │   ├── theme/         # 主题切换
│       │   └── ui/            # shadcn/ui 组件
│       ├── i18n/auth-i18n.tsx # 中英文国际化
│       └── data/country-codes.ts
├── kong/
│   ├── kong.yml                # Kong 声明式配置
│   └── plugins/oidc-jwt-auth/  # 自定义 JWT 校验插件
├── docker-compose.yml          # 全部服务编排
├── example-zitadel-config.yaml
├── example-zitadel-init-steps.yaml
├── pnpm-workspace.yaml
└── package.json
```

## 环境变量

复制 `.env.example` 为 `.env` 并填写：

```env
# Kong
KONG_PROXY_PORT=80
KONG_ADMIN_PORT=8001
KONG_APP_HOST=app.localhost
KONG_AUTH_HOST=auth.localhost
KONG_EDUNEX_HOST=edunex.localhost

# Zitadel OIDC
ZITADEL_ISSUER=http://auth.localhost
ZITADEL_INTERNAL_ISSUER=http://auth.localhost
ZITADEL_CLIENT_ID=your-client-id
ZITADEL_SERVICE_PAT_FILE=/zitadel/bootstrap/login-client.pat
ZITADEL_LOGIN_REDIRECT_URI=http://auth-service:3000/auth/callback
ZITADEL_PROJECT_ID=your-project-id
ZITADEL_DEFAULT_ROLE_KEY=EduClaw

# 阿里云短信（启用短信功能时需要）
ALIYUN_ACCESS_KEY_ID=
ALIYUN_ACCESS_KEY_SECRET=
ALIYUN_SMS_SIGN_NAME=
ALIYUN_SMS_TEMPLATE_CODE=

# 前端（Docker 中留空，由 Nginx 代理）
VITE_API_BASE=

# 数据库（在 docker-compose.yml 中配置）
POSTGRES_DB=educlaw
POSTGRES_USER=admin
POSTGRES_PASSWORD=123456
PG_PORT=5432

# EduNex
EDUNEX_PG_PORT=5434
EDUNEX_POSTGRES_DB=edunex
EDUNEX_POSTGRES_USER=edunex
EDUNEX_POSTGRES_PASSWORD=edunex
EDUNEX_DB_PUSH_ON_START=1
EDUNEX_OAH_WORKSPACE_HOST_ROOT=/Users/almonster/.openagentharness/workspaces
EDUNEX_OAH_WORKSPACE_CONTAINER_ROOT=/mnt/oah-workspaces
AUTH_SECURE_COOKIES=false
```

说明：

- `ZITADEL_ISSUER` — 浏览器视角的 Zitadel 地址（token issuer）
- `ZITADEL_INTERNAL_ISSUER` — 容器内访问 Zitadel 的地址，未设置时回退到 `ZITADEL_ISSUER`
- `ZITADEL_SERVICE_PAT_FILE` — Zitadel 服务账号 PAT 文件路径（Docker 中通过 volume 自动挂载）
- `ZITADEL_PROJECT_ID` — Zitadel 项目 ID，用于角色分配和查询
- `ZITADEL_LOGIN_REDIRECT_URI` — 必须加入 Zitadel App 的 Redirect URIs 白名单
- `ALIYUN_*` — 阿里云 Dypnsapi 短信服务配置
- `KONG_EDUNEX_HOST` — EduNex 业务域 host，默认 `edunex.localhost`
- `EDUNEX_*` — EduNex 容器、数据库和运行时目录配置；敏感或项目特定配置也可以放在 `/Users/almonster/Documents/xiangmu/EduNex/.env.docker`

## 接口

### `POST /auth/password`

统一登入/注册入口。

请求体（登录）：

```json
{
  "mode": "login",
  "username": "alice",
  "password": "12345678aB."
}
```

请求体（注册）：

```json
{
  "mode": "register",
  "username": "alice",
  "email": "alice@example.com",
  "password": "12345678aB."
}
```

返回：`access_token`、`refresh_token`、`id_token`、`expires_in`

### `POST /auth/logout`

吊销 refresh_token 和 access_token，失败不阻塞。

```json
{ "refresh_token": "...", "access_token": "..." }
```

### `GET /auth/me`

需要 `Authorization: Bearer <access_token>` 头（由 Kong 校验后注入）。

返回：

```json
{
  "id": "123456789",
  "username": "alice",
  "email": "alice@example.com",
  "roles": ["EduClaw"]
}
```

### `POST /auth/sms/send`

发送短信验证码。速率限制：每个手机号 10 分钟内最多 3 条。

```json
{ "phone": "+8613800138000" }
```

返回：

```json
{ "ok": true, "otpId": "uuid", "message": "验证码已发送" }
```

### `POST /auth/sms/login`

短信验证码登录。需要先调用 `/auth/sms/send` 获取 `otpId`。

```json
{ "phone": "+8613800138000", "code": "123456", "otpId": "uuid" }
```

### `POST /auth/sms/register`

短信验证码注册。需要先调用 `/auth/sms/send` 获取 `otpId`。

```json
{
  "phone": "+8613800138000",
  "code": "123456",
  "otpId": "uuid",
  "username": "alice",
  "password": "12345678aB."
}
```

### `POST /sms/send`

Zitadel 自定义 SMS Provider 端点。Zitadel 会 POST `{ recipient, message }` 到此接口，由 auth-backend 转发到阿里云短信服务。

### `GET /healthz`

健康检查。

## 本地开发

```bash
pnpm install                            # 安装所有依赖

# 后端（tsx watch，端口 3000）
pnpm --filter auth-backend dev

# 前端（Vite dev server，端口 5173，代理 /auth 到 :3000）
pnpm --filter auth-frontend dev

# 构建
pnpm --filter auth-backend build        # tsc → auth-backend/dist/
pnpm --filter auth-frontend build       # tsc + vite → auth-frontend/dist/
```

## Docker 部署

```bash
cp .env.example .env                    # 复制并填写环境变量
docker compose build                    # 构建所有服务
docker compose up -d                    # 启动全部服务
```

服务启动后：

- `http://auth.localhost` — 认证服务（Kong 代理）
- `http://app.localhost` — EduClaw 业务应用（Kong 代理）
- `http://edunex.localhost` — EduNex 业务应用（Kong 代理）

包含的服务：PostgreSQL、Zitadel、Zitadel Login UI、Kong、auth-backend、auth-frontend、edunex-postgres、edunex-server、edunex-web。

## 接入新业务服务

新业务服务不需要处理登入/注册，只需：

1. **从 NavPage 添加入口**：在 `NavPage.tsx` 的 `services` 数组中添加服务配置（名称、URL、角色）
2. **接收 token**：业务前端从 URL hash `#token=...` 提取 token 并存入 localStorage
3. **请求带 token**：业务前端的 API 请求附带 `Authorization: Bearer <token>`
4. **读取用户信息**：业务后端从 Kong 注入的 `X-User-Id`、`X-User-Username`、`X-User-Email` 头获取用户身份
5. **登出跳转**：业务前端登出后跳转到 `auth.localhost/login?logout=1`
6. **登录后回跳**：业务前端可使用 `auth.localhost/login?returnTo=<encoded-url>` 让用户登录后自动跳回业务页面（支持同域和子域）
7. **Kong 路由**：在 `kong/kong.yml` 中添加业务服务的路由规则

## 常见问题

- `ZITADEL_CLIENT_ID` 不匹配 → token 校验失败
- `ZITADEL_LOGIN_REDIRECT_URI` 没进白名单 → 登录流程卡在 code exchange
- `ZITADEL_INTERNAL_ISSUER` 容器内不可达 → 后端无法调用 Zitadel API
- `ZITADEL_SERVICE_PAT` 权限不足 → 注册或用户查询失败
- `ZITADEL_PROJECT_ID` 未设置 → 角色分配和查询失败
- 如需重新初始化：`docker compose down -v`
