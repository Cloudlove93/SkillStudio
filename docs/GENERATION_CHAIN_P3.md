# 工程三：生成链路

对应 `EduSkill-Agent-Skill-四项工程分工.xlsx` 的任务明细 E3-01 至 E3-07。基于主线的 package-as-Agent 模型实现：`agent_packages` 是 Agent，版本快照保存指令和挂载配置，Skill 及其版本沿用现有独立表。

## 行为与事务

- 引导创建确认成功后，在同一事务写入 Agent、首个 package version、Skill、首个 Skill version、版本关联、默认指令/模型和会话完成态。失败回滚，不向前端返回成功。沿用会话锁、revision 和 finalize lease；已完成会话重复确认返回已保存结果。
- 文档生成 API 增加可选 `requestId`（8–128 位字母、数字及 `._:-`，首位为字母或数字）。幂等范围是用户；相同 key 与内容重放原产物，不再次写库，key 对应不同内容时报错。事务 advisory lock 与唯一索引防止并发重复落库。模型生成在事务外，并发首次请求仍可能各调用一次模型。旧客户端不传 key 时保留原行为。
- 文档面板在本次挂载期间复用相同内容的 requestId，以覆盖连接中断重试；页面重载后不保证复用该 key。
- 生成完成页展示名称、描述、指令、模型、包含的 Skills，主操作进入该 Agent 对话，次操作查看 Skill 版本。保留完成页，并通过 `resultSession` URL 参数支持刷新恢复；侧栏“生成记录”可重新打开已有会话。
- 旧 skill-only 会话仍可查看，并明确提供“转为 Agent”。转换在原包内补齐指令和模型；重复转换不新建包或 Skill。
- AgentSummary 复用 AgentWorkspace，新增可选 `currentVersion`（当前 package version 的数据库 ID）和 `sourceSessionId`。GuidedCreationSession 新增可选 generatedAgent；旧记录缺少该字段合法。

## 来源、去重与隔离

新引导产物通过 Agent 的 `source_session_id` 及 snapshot.sourceSessionId 回溯创建会话。Skill 暴露 `originPackageId`、`originSkillId`；旧记录回退到自身 package/Skill ID。跨 Agent 复用复制版本内容并保留原始身份，不按名称匹配。ZIP 导入会清除外部数据库 ID，避免跨实例误绑定。

仓库只折叠“同用户、同原始身份、当前内容 hash 相同”的副本，保留较早的 active Skill。副本内容分化后单独显示；独立生成的同名 Skill 也单独显示。来源字段不计入内容 hash，避免仅补充来源便产生内容新版本。新引用必须验证同用户；已经保存的来源在原包删除后仍可编辑，也可通过同用户的现存副本继续复用。

同一 Agent 中 Skill UID 或目录冲突会明确拒绝，避免以同名匹配或改 UID 后破坏 SKILL.md frontmatter。需要在来源处修正标识后重试。display name 相同且标识不同可以同时挂载。创建、更新、带历史导入统一限制每个快照最多 20 个 Skills；沿用既有所有权检查和禁用项校验。

## 部署

先在部署环境运行现有 `pnpm --filter educlaw-server db:init`，再启动服务。迁移新增生成请求 key/hash、用户范围唯一索引、source session 列及索引、Skill 来源列及索引。迁移入口不是服务自动启动流程的一部分。

`GENERATION_AGENT_ENABLED=true` 为默认值；关闭后停用共用生成入口的指令/模型兜底补齐，不标记新引导会话的 Agent 结果。引导确认仍保存用户选择或默认模型，既有 Agent 架构、仓库和旧结果读取继续工作；该开关不撤销已生成的记录。

多模态发布沿用主线已有原子事务和发布回执幂等性，通过共用 package 创建方法获得默认 Agent 配置及 Skill 来源；不把多模态会话 ID 写入引导创建会话的 sourceSessionId（两种会话属于不同命名空间）。多模态结果完整预览和源会话跳转仍由对应工程对接。

## 验证记录与待验收项

已通过服务单元测试，覆盖生成模型保存、超限前置拒绝、幂等重放、会话完成/失败、旧包原地转换、用户隔离、来源验证、同名 Skill 与标识冲突。前端 DOM 测试覆盖结果预览、两个独立操作、历史转换入口和 URL 刷新恢复。服务 TypeScript 检查通过；Web 使用仓库现有基线检查，不能将它表述为全量 tsc 无错误。

真实数据库和真实模型验收（E3-07）尚未完成。本会话环境连接本机 PostgreSQL 返回 EPERM；需要监听本机端口的路由测试同样受限。现有 mock 测试不能替代数据库提交、回滚和真实模型对话证据。

可在有权限的本地终端运行新增 PostgreSQL 测试：

```sh
cd educlaw-server
GENERATION_CHAIN_POSTGRES_TESTS=1 node_modules/.bin/vitest run src/services/generation-chain.postgres.test.ts --maxWorkers=1 --pool=threads
```

测试使用现有 isolated-postgres 工具创建随机独立测试数据库并清理，只允许本机 PostgreSQL；测试账号需要创建数据库权限。它验证写入后故障回滚、Agent/Skill 关联和相同来源内容副本去重，不调用模型。未开启变量时明确跳过。

人工验收顺序：

1. 初始化测试环境 schema，以真实模型完成一条引导创建，保存 session、Agent、Skill、两类首版本 ID 和模型配置证据；两仓可见且结果页刷新可恢复。
2. 重试已完成确认、用相同 requestId 重试文档生成，核对包/Skill 数量不增加；更改内容复用 key 应失败。
3. 在保存阶段注入失败，核对四类资产表及关联无残留，再重试可完成。
4. 将 Skill 加入另一 Agent，核对来源身份与内容；同名独立资源分别保留，同源相同内容仓库折叠；修改副本后单独显示。
5. 用另一用户尝试获取、挂载、转换产物，确认不可访问；21 个 Skill 请求应被拒绝。
6. 打开旧 skill-only 会话并转换两次，核对 Skill 数量及历史版本不被复制。
7. 从结果页进入指定 Agent，使用挂载 Skill 完成一次真实教学任务对话，保存响应与执行 Skill 版本证据。

## 分支状态

本次合并冲突的工作文件已采用 origin/main 内容作为实现基线，再叠加 P3 改动。当前环境不能写 Git index，自动审批服务报 provider 配置错误，合并提交尚未完成；工作文件内容与 Git 的未解决索引状态须区分。最终需要在本地终端暂存全部本次改动并完成 merge commit。
