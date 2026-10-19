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
| `PI_HARNESS_SKILL_RUN_ENABLED` | Skill Run/Test 是否启用进程内 Pi Core Adapter | `true` |
| `PI_HARNESS_MAX_CONCURRENT_RUNS` | 单个 Server 进程允许的并发 Pi Run/Test 数 | `4` |
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
- `POST /arena/threads/:threadId/messages/stream`：旧 Arena 消息流的规范路径；threadId 来自 path
- `POST /arena/threads/messages/stream?threadId=123`：保留的兼容别名，复用同一处理器；query 必须为单个非空值

以上业务路由均挂载在 `/api` 下。规范消息流不接受 `threadId` query（即使与 path 相同）；两种入口都由网关注入身份并由服务层校验会话归属。未认证返回 JSON 401，缺失/歧义标识或空消息返回 JSON 400；开始 SSE 后的服务错误以 `error` 和 `stream_end {ok:false}` 结束。SSE headers、心跳和事件合同沿用原实现。

`LiteArenaPanel` 和 `SkillArenaWorkspace` 经 `sendMessageStream` 使用规范消息流。它仍是请求绑定的旧协议：客户端断连会取消执行，不能恢复在途部分输出。不要将其与当前 Run/Test 使用的异步 Run 协议混用：

| 方法 | 路径（均带 `/api` 前缀） | 含义 |
| --- | --- | --- |
| POST | `/arena/threads/:threadId/runs` | 幂等开始 Run |
| GET | `/arena/threads/:threadId/runs` | 恢复该会话历史及当前 Run |
| GET | `/arena/threads/:threadId/runs/:runId` | 获取快照 |
| GET | `/arena/threads/:threadId/runs/:runId/events` | 订阅快照；断连仅解除订阅 |
| POST | `/arena/threads/:threadId/runs/:runId/stop` | 显式停止该 Run |

异步 Run 在刷新或切换会话后继续运行，由 `use-skill-run` 恢复同一个 runId，不重新发送问题；活动状态恢复受现有服务进程生命周期限制。本次命名整理不改变任何 Run 路由或取消语义，也不修改独立的 `/arena/chat/sessions/:sessionId/messages/stream` 兼容协议。

## 版本并发与停机

旧 `POST /api/packages/:packageId/manual-edit` 现在要求 `expectedPackageVersionId`。编辑开始时捕获该值，保存时不换成刚刷新的 head；缺失返回 422，冲突返回 409 / `PACKAGE_VERSION_CONFLICT`，不增加版本。agent/rubric/skill 三种目标共用事务内 CAS；前端冲突保留草稿并提示重新加载、比较。旧客户端缺少前置条件将安全拒绝，因此发布时须同步更新前后端。内部旧优化快照写入也以服务器读取快照时的版本执行 CAS，避免生成期间被并发提交覆盖；这不新增跨交互草稿生成周期的协议。

历史回填与写入均按 Package 行锁 → Skill 锁串行化。空 skills 历史不要求无意义的映射；查询不会反复把旧 head 的摘要恢复回来。响应格式和废弃版本状态保持不变。

单进程收到 SIGTERM/SIGINT 后先将 readiness 置为 unavailable，共享 HTTP 门禁拒绝新业务请求（包括新旧消息流，503 / `SERVER_DRAINING`）并停止后台新领取；健康检查和既有 Run get/recover/events/stop 保持可用。已接受 HTTP 业务、Run 和 runner 工作有 30 秒排空，超时向 Run 发 abort，再等待 5 秒；最后共用最多 5 秒执行“关闭 HTTP → 确认处理器结束 → 关闭数据库”。Compose 停机宽限为 45 秒。普通请求等待模型期间即使没有占用 DB 连接，也不能提前关闭 pool。

业务 Router 由 `createTrackedRouter` 包装注册的处理器；共享请求令牌同时等待响应生命周期、处理 Promise 或 callback middleware 的 next/正常 finish。socket close 不等于业务完成，响应发完后的异步清理也会继续计数。强制断连后若无法确认结束，跳过数据库关闭并以非零状态退出，记录 `shutdown.unconfirmed` / `shutdown.incomplete`，不声称任务已清理。新增业务 Router 应沿用该工厂，异步业务须返回 Promise 或按 callback middleware 合同调用 next，不能派发未登记的后台保存。

后台 runner 的 `stop()` 只停止新领取；`waitForIdle()` 才确认已接受批次结束。现有后台模型调用不支持可靠 abort，超出宽限时按未确认排空处理。生产停机不使用可能提前释放 reservation 的 `dispose()`。页面刷新/切换仍只断开订阅，不停止 Run；本机制不提供跨进程恢复、多副本协调或跨重启续跑。

## 日志说明

- 统一使用 `pino` 输出结构化日志
- 请求链路透传 `x-request-id`
- 模型调用前后会打印输入摘要、输出摘要、接口状态和错误信息

## 提示词管理

- 统一放在 [`src/prompts`](./src/prompts)
- 服务层只负责组装上下文和调用，不再内嵌长提示词正文
