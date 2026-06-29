# educlaw-server

## 项目名称

`educlaw-server` 是 EduSkill 的后端服务，负责认证、智能体包管理、对话工作台和版本管理能力。

## 服务启动方式

```bash
cd educlaw-server
pnpm install
pnpm dev
```

生产构建与启动：

```bash
pnpm build
node dist/index.js
```

常用检查：

```bash
pnpm test
pnpm lint
pnpm format
```

## 环境变量

最少需要准备这些变量：

| 变量 | 说明 | 默认值 / 备注 |
| --- | --- | --- |
| `PORT` | 服务端口 | `3000` |
| `DATABASE_URL` | PostgreSQL 连接串 | 本地开发默认指向 `127.0.0.1:5435` |
| `LLM_BASE_URL` | 模型服务地址 | 默认 `https://api.openai.com/v1` |
| `LLM_API_KEY` | 模型服务密钥 | 生产必填 |
| `LLM_MODEL` | 默认模型 | `gpt-4.1-mini` |
| `LLM_BASELINE_MODEL` | Arena baseline 模型 | 可选 |
| `LLM_TIMEOUT_MS` | 模型调用超时 | `300000` |
| `LLM_NETWORK_RETRIES` | 模型网络重试次数 | `2` |
| `APP_ORIGIN` | 前端来源白名单 | `http://localhost:4173` |
| `BODY_LIMIT` | 请求体大小限制 | `100mb` |
| `UPLOAD_LIMIT_MB` | 上传文件大小限制 | `25` |
| `SEED_USERS` | 是否注入种子用户 | 开发环境默认开启 |
| `SEED_USER_NAMES` | 种子用户名列表 | 逗号分隔 |
| `SEED_USER_PASSWORD` | 种子用户密码 | 生产开启种子用户时必须替换 |
| `INVITE_CODE` | 注册邀请码 | 可留空 |

本地开发建议把真实配置放在工作区根目录的 `.env.local`，不要提交到仓库。

## 接口说明

主要接口分组：

- `POST /auth/login`：登录
- `GET /auth/me`：读取当前登录用户
- `GET /packages`：智能体包列表
- `POST /packages/generate`：生成智能体包
- `POST /packages/generate/stream`：流式生成智能体包
- `POST /packages/:packageId/manual-edit`：保存 `agent.md` / `rubric.md` / `SKILL.md`
- `GET /packages/:packageId/versions`：版本列表
- `POST /packages/:packageId/versions/compare`：版本对比
- `GET /arena/threads`：对话线程列表
- `POST /arena/threads/messages/stream`：流式对话

## 日志说明

- 统一使用 `pino` 输出结构化日志
- 请求链路透传 `x-request-id`
- 模型调用前后会打印输入摘要、输出摘要、接口状态和错误信息

## 提示词管理

- 统一放在 [`src/prompts`](./src/prompts)
- 服务层只负责组装上下文和调用，不再内嵌长提示词正文
