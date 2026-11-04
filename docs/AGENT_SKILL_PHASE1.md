# Agent + Skill 第一阶段

用户通过「我的 Agent」（`/agents`）创建多个教学助手，为每个助手配置名称、描述、角色指令、模型和最多 20 个 Skill。Skill 绑定到明确版本，可逐项启用、停用、移除和切换版本，同一 Skill 可用于多个 Agent。

生成后，通过「添加到 Agent 并使用」选择已有 Agent 或新建 Agent。「创建并使用 / 保存并使用」保存配置并打开运行对话；也可以新建测试对话，输入固定样例验证输出。文档生成和多模态生成已连接 Agent 入口，原 Skill 创建、优化、Arena 和版本管理继续可用。

## 执行与版本

本阶段将所有已启用 Skill 的规则显式加载到模型上下文，不增加工具调用或自动 Skill 路由。会话保存 Agent 指令、模型和每个 Skill 的版本及正文快照。修改 Agent、停用 Skill 或升级版本只影响新对话，历史会话继续使用原配置。模型留空使用后端默认模型。

运行复用现有 Run 接口与 SSE 快照恢复；刷新、切换对话只解除订阅。活动执行仍由单个服务进程持有，服务重启后可恢复已保存历史，不能续跑在途模型请求。

Agent 指令与全部启用 Skill 正文合计超过 60000 字符时拒绝运行，并返回可读错误提示精简内容。Skill 或版本失效后 Agent 列表仍可打开，失效项标记为不可用并提示重新绑定；被 Agent 引用的 Skill 包禁止删除。

Agent 对话会把全部启用 Skill 的 UID 记入回答溯源表，但没有接入单 Package 的回答优化流程，因此 Agent 回答下不显示旧的回答优化按钮。原单 Skill 回答优化保持可用。Agent 对话仍显示实际绑定的所有 Skill，可打开原 Skill 工作区继续优化和版本管理。

## 数据与启动

新增 `user_agents` 保存用户隔离的配置，`user_agent_conversations` 关联现有 Arena 线程。发布前需要执行数据库初始化：

```sh
pnpm --filter educlaw-server db:init
```

接口位于 `/api/agent-workspaces`，包括列表、创建、详情、更新，以及 `/api/agent-workspaces/:agentId/conversations` 的会话列表和幂等创建。身份沿用认证网关注入，更新使用 `expectedUpdatedAt` 检查并发冲突。

开发时前端 `/agents` HTML 导航绕过旧 Agent API 代理，JSON API 请求仍保留兼容代理。真实认证、数据库和模型调用需要现有服务配置。

## 本轮验证（2026-11-03）

- 前端 386 项单元测试、116 项合同测试通过；本机 Node 26 使用 `NODE_OPTIONS=--no-experimental-webstorage` 运行，避免其全局 localStorage 行为干扰 jsdom。
- 新增 Agent 服务、路由、运行快照测试及相关执行回归共 137 项通过。
- 前端构建与新增/修改代码 ESLint 通过；前端类型检查没有新增诊断。
- 临时 PGlite PostgreSQL 执行验证通过：完整 schema 重复初始化、跨 Package 挂载、创建与更新 Agent、权限隔离、并发冲突及重复对话请求。
- 隔离浏览器使用模拟认证/API 数据验证生成 Skill 预选、创建并使用、刷新恢复同一 Agent 对话及手机布局；没有调用真实模型。
- 后端全量构建仍有原 `auto-eval-service.ts` 缺失类型的问题。后端全量测试有 5 项失败，涉及旧 MinIO 部署断言、缺失 `.env.docker` 和本机 Python 3.9；不能据此宣称整个仓库验证通过。

真实网关、PostgreSQL 服务和模型联调尚未执行。
