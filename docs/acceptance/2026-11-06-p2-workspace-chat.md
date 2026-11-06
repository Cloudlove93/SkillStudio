# P2 工作区对话验收

日期：2026-11-06。范围：分工表的 E2-01～E2-07。

分支 `feature/p2-workspace-chat` 基于 `main` 的 `8237b7d`。当时 `develop` 落后于当前实现，基于最新 `main` 保留既有 Agent 工作区、运行恢复与版本服务；本分支没有合并或推送主分支。

## 行为与接口

创建入口统一为 `POST /api/agent-workspaces/:agentId/conversations`，请求体为 `{purpose: 'run' | 'test', requestId: string}`。已有生成入口继续通过 provision 获取 Agent。配置与资产中心布局沿用现有实现。

`arena_threads.arena_config_jsonb.agentExecution` 保存 `agentId`、`name`、`instructions`、实际使用的 `model`，以及每个已启用 Skill 的 `skillId`、`skillVersionId`、`packageVersionId`、`skillUid`、`versionNumber`、名称、描述和 `skillMd`。其中 `versionNumber` / `skillMd` 对应分工约定的版本与正文。读取历史与执行时优先使用该快照，不再依赖当前配置或重新获取原 Skill 版本；消息级模型参数不能覆盖快照模型。

| 情形 | 返回或行为 |
| --- | --- |
| 模型为空 | 创建时解析服务端默认模型并保存 |
| 全部 Skill 停用 | 422 `NO_ENABLED_SKILLS`，提示到 Agent 编辑配置中启用 |
| 已启用 Skill 被移除、版本废弃或绑定缺失 | 422 `SKILL_UNAVAILABLE`，提示重新保存配置 |
| 同 Agent、同 requestId 重试 | 返回同一会话，不重复插入 |
| 同 requestId 改变 purpose | 409 `IDEMPOTENCY_CONFLICT` |
| 其他用户访问 | 404，沿用资源归属检查 |
| 旧单 Skill 普通对话创建 | 422 `AGENT_REQUIRED`，提示进入 `/agents` |

幂等创建通过事务中的 Agent 行锁串行化。重放详情在事务提交、释放连接后读取，避免大量重复请求占满连接池后互相等待。

以下旧公开入口仍可到达，但不能新建普通对话：`POST /api/arena/threads/create`、`POST /arena/chat/profile/:fileName`、`POST /arena/chat/skill/:dirName`、`POST /arena/chat/agent/:id`，以及 action `arena.thread.create` 的默认、run、test、arena 场景。Skill 优化专用入口保留，新建的优化线程带 `optimizationOnly`，不能通过普通消息接口绕过 Agent 对话。历史线程不回填该标记，仍可读取和续聊。

前端展示 Agent 名称、实际模型、可展开的固定 Skill 正文和 Agent 指令。单 Skill 使用/试跑入口改为预览并引导 Agent；旧单侧会话继续显示固定版本，旧双侧 Arena 以只读方式显示两侧固定版本与历史消息。

会话选择同步到 URL 的 `agentId` / `conversation`。创建期间的 requestId 保存在 sessionStorage，成功后清除。自动开聊等待历史成功加载，已有历史优先恢复 URL 指定会话；失败不自动创建，并清除 `autochat`。切换 Agent 后迟到的响应不会覆盖当前选择。

## 本地运行与复验

本次使用 Node 22、真实 PostgreSQL 17 和隔离数据库。外部统一登录在验收脚本中替换为仅监听本机的固定测试身份，业务接口、事务与持久化仍使用真实实现。验收脚本不调用模型，也不模拟模型回答；旧会话样例消息明确标注为预置数据。

依赖安装后，在仓库根目录先构建共享包：

```sh
node educlaw-shared/node_modules/typescript/bin/tsc -p educlaw-shared/tsconfig.json
```

`.env.local` 的本机数据库配置：

```dotenv
DATABASE_URL=postgres://educlawlite:local-dev-password@127.0.0.1:5435/educlawlite
POSTGRES_PORT=5435
```

仅当没有本机数据库时，可使用独立容器，不占用其他项目的数据库：

```sh
docker run -d --name skillstudio-p2-db \
  -e POSTGRES_USER=educlawlite -e POSTGRES_PASSWORD=local-dev-password \
  -e POSTGRES_DB=educlawlite -p 127.0.0.1:5435:5432 \
  -v skillstudio-p2-pgdata:/var/lib/postgresql/data pgvector/pgvector:pg17
```

从仓库根目录执行接口验收：

```sh
node educlaw-server/node_modules/tsx/dist/cli.mjs educlaw-server/test-utils/p2-local-acceptance.ts
```

增加 `--serve` 可保留验收环境并打开真实前端：

```sh
node educlaw-server/node_modules/tsx/dist/cli.mjs educlaw-server/test-utils/p2-local-acceptance.ts --serve
```

页面：`http://localhost:5189/agents`。本地验收账号和密码均为 `p2-local`。接口监听 `127.0.0.1:3219`。退出验收进程时自动删除它创建的随机隔离库；每次复跑重新准备数据，既有业务库不受影响。每次执行结果写入 `.runlogs/p2-local-acceptance.json`。

当前工作目录的父目录含冒号，包管理器通过 PATH 查找工具会受影响，因此这里使用本地工具的显式 Node 入口。macOS 的 Docker 若未加入 PATH，可将命令中的 `docker` 替换为 `/Applications/Docker.app/Contents/Resources/bin/docker`。

## 验证结果

真实 PostgreSQL + HTTP：7 组全部通过，见同目录 `evidence/p2-workspace-20261106/http-database.json`。

- 24 个并发相同 requestId 请求只产生一行会话，且快照仅包含 2 个已启用 Skill。
- 修改 Agent 指令与模型后，旧会话快照保持原值，新会话使用新配置。
- 全停用返回可读 422，恢复启用后可创建；版本废弃后新会话返回 422，已有历史仍可读。
- 旧 Skill 会话可读取固定版本；8 种旧创建请求均返回 422，不新增线程；跨用户读取和创建均返回 404。

前端 400 项单元测试、116 项接口约定测试通过；类型增量检查新增 0 项（已有诊断由 257 降至 249），完整前端 ESLint 通过。共享包、OpenAgent、后端和前端构建通过。后端 P2 相关 17 文件 166 项回归通过（提 PR 前重新运行，包含最后补充的事务边界用例）；后端全量为 1308 通过、10 失败、20 跳过，10 个失败在原始 main 上全部复现。

浏览器确认：Agent 及 2 个启用 Skill 可见，固定正文与指令可展开；autochat 清参并恢复指定会话；刷新不重复创建；旧单侧会话的明确链接和刷新保持原 ID；旧双侧历史消息与两侧固定版本可读；通过页面创建测试会话后刷新，历史数量保持不变。额外修复了旧单侧历史被过滤、继而被最新会话覆盖的问题，左侧独占的旧历史以只读方式保留 baseline 语义。

构建与检查汇总见 `evidence/p2-workspace-20261106/verification.json`，页面截图为同目录 `agent-conversation.jpg` 与 `legacy-skill.jpg`。

## 尚未覆盖的真实依赖与仓库既有问题

按本次约定，真实模型连接稍后配置，因此没有宣称真实 AI 输出联调通过；验收服务器主动保持模型密钥为空。正式部署仍使用项目原有统一认证网关。

执行中的任务由单个服务进程持有，重启不能续跑在途模型请求，已保存历史仍可恢复。

原始 `main` 已复现的后端全量测试失败包括：MinIO 部署断言、未提供 `.env.docker`、Python 缺少 `httpx`、旧 rubric 测试的 SQL mock 不匹配。原始 `main` 的类型检查脚本自身有 1 个 macOS 临时目录路径测试失败；Python worker 测试因环境缺少 `pytest` 未能启动。后端全量 lint 另有 `guided-creation-service.ts` 的既有多余转义错误。本次没有修改这些 P2 范围外模块，也没有把全仓库检查标记为全绿。
