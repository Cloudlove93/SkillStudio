# EduSkill 接入 Inno Agent Harness：架构设计

> - 文档状态：架构讨论定稿 v1.6，架构边界与首批交付范围已确认，可交接编写工程规范
> - 初稿日期：2026-09-04；最近修订：2026-09-08
> - 适用读者：产品、研发、测试、架构评审者，以及后续维护者
> - Inno 兼容基准：inno-agent 0.5.4，提交 fcc669fd4a1164156b4056e52eb6681ec3abf4a9
> - 当前产品范围：用户自己的 Skill 仓库；不建设公开 Skill 广场
> - 本文只确定架构和工程边界，不代表已经批准开始实施

## 1. 结论

EduSkill 当前能够创建、运行、测试和优化 Skill，但主要运行方式仍是把 Skill 内容拼接进提示词。它可以评价提示词效果，却不能证明同一个 Skill 安装到 Inno Agent 后会被正确发现、读取辅助文件、调用工具并完成任务。

本次调整采用以下总体方案：

1. Inno Agent 是第一优先目标，第一阶段只支持一套固定版本的真实 Inno Harness。
2. 正式测试使用原生 Inno Headless Server，不在 EduSkill 中重写或近似模拟 Agent 循环。
3. EduSkill 继续承担多用户控制面；实际 Harness 在独立 Runner 中运行。
4. Skill 从单个 Markdown 字符串升级为完整目录，支持 SKILL.md、scripts、references 和 assets。
5. 内部使用 SkillVersion → HarnessBuild → Release 三层模型，保证“测试什么，就下载和安装什么”。
6. Run、Test、Arena 和 Optimization 共用同一条 Harness 执行链路。
7. 生成后的同一份 Bundle 必须依次通过静态检查、Inno 能力检查、真实行为测试和全新实例安装测试。
8. Runner 从第一版开始实行运行隔离、默认拒绝、最小授权、配额、审计和可靠清理。
9. 在大规模调整版本和存储模型前，先用最小 Runner Spike 跑通真实 Inno 端到端链路。
10. 现有 Skill 按版本渐进迁移；新建 Inno Skill 默认使用新 Harness。
11. 核心契约不依赖 Inno 或 Pi 私有类型，为以后接入其他 Harness 保留独立 Adapter 和 Runner。

一句话概括：

> EduSkill 负责生产、验证、比较和保存 Skill；固定版本的原生 Inno 负责证明 Skill 在目标平台中的真实行为。

## 2. 为什么需要调整

### 2.1 EduSkill 与 Inno 当前存在三类差异

| 方面 | EduSkill 当前方式 | Inno Agent 实际方式 |
|---|---|---|
| Skill 内容 | 主要保存 skillMd 字符串 | Skill 是包含 SKILL.md 和辅助资源的目录 |
| 执行方式 | 将 Skill 全文拼入 system prompt | Pi AgentSession 进行多轮工具调用和渐进式资源加载 |
| 评价对象 | 主要评价最终回答文本 | 还需要评价发现、工具、文件、artifact 和终止行为 |

因此，“EduSkill 中回答效果不错”不能直接等价为“Inno Agent 中可用”。

### 2.2 Inno 中的内容边界

Inno Agent 对下面三类内容有不同处理：

| 内容 | 作用 |
|---|---|
| agent.md | 工作区长期背景、身份、偏好和通用规则 |
| .skills/<name>/SKILL.md | 某项专项能力的触发条件、流程和输出要求 |
| rubric.md | EduSkill 的评价资产，不属于 Inno 运行契约 |

影响 Agent 行为的规则必须进入 agent.md 或 Skill；只用于评判结果的标准留在 EduSkill rubric 中。不能依赖运行时注入 rubric 来掩盖 Skill 本身缺少必要规则。

### 2.3 Inno Skill 是目录

目标结构遵循 Agent Skills 规范：

~~~text
skill-name/
├── SKILL.md
├── scripts/
├── references/
└── assets/
~~~

其中 description 既是展示信息，也是 Skill 发现和路由依据。完整正文与辅助资源可以按需加载，不应假设整个 Skill 永远被完整塞入 system prompt。

### 2.4 原生 Inno 不能作为共享单例直接接入

目标版本的 Inno Agent 提供独立于 Electron 的 Node HTTP Server 和 REST/SSE 接口，但其运行模型围绕一个活动 session 和共享串行队列组织。它适合个人 Agent，不适合作为多个 EduSkill 用户共享的可变单例。

EduSkill 可以直接运行原生 Inno 后端，但生命周期需要按场景区分：Test、Arena 和自动化验证按 Attempt 隔离；多轮交互 Run 按 conversation 独占并保留同一个 session、home 和 workspace。任何两个 conversation 或测试 Attempt 都不能共享可变实例。

## 3. 目标、非目标与验收定义

### 3.1 目标

- 单个 Skill 可以从个人仓库下载，并直接安装到固定版本的 Inno Agent。
- SKILL.md 及其 scripts、references、assets 能够完整导入、版本化、测试和导出。
- EduSkill 可以使用真实 Inno Harness 执行 Run 和 Test。
- Arena 两侧在相同环境中比较，差异只能来自待比较的 Skill。
- 优化后的候选 Skill 必须重新经过真实 Harness 回归。
- 每次运行能追溯 Skill、Bundle、Inno、模型、工具、工作区和 artifact。
- 多用户并发时不发生 session、文件、凭据或工具结果串扰。
- 以后增加其他 Harness 时，不重写版本、运行、测试、Arena 和优化主流程。

### 3.2 非目标

- 不把 EduSkill 改造成 Inno Agent 的完整替代品。
- 不移植 Inno 的桌面界面、导航和其他与 Skill 行为无关的产品模块。
- 不在 EduSkill 中重新实现 Inno 的 Agent 循环、记忆、调度或渠道逻辑。
- 不在第一阶段实现第二套生产 Harness。
- 不建设公开 Skill 广场、公共目录、评分、收藏、推荐或公开 Content Hub。
- 不立即下线当前 Prompt Runtime。
- 不允许 Skill 在没有 Sandbox 的情况下任意执行 shell、脚本或访问网络。

Workspace Preset 和个人仓库到 Inno 的私有直连可以后续增加，但不阻塞单 Skill 的核心链路。

### 3.3 “直接适合 Inno”的验收定义

| 层级 | 验收要求 |
|---|---|
| 格式兼容 | 符合 Agent Skills 和目标 Inno 的目录、命名及 frontmatter 约束 |
| 安装兼容 | 最终 Bundle 能被全新 Inno 实例安装、发现和读取 |
| 资源兼容 | Skill 能访问自己声明的 scripts、references 和 assets |
| 工具兼容 | 只使用目标 Inno 实际存在的工具和参数 |
| 行为兼容 | 能在固定版本的原生 Inno 中完成黄金任务 |
| 治理兼容 | 运行可版本化、审计、比较、复现和回退 |

只有同时达到这些要求，个人仓库中的版本才能标记为“Inno 已验证、可安装”。该标记的统一含义是：

> 已在指定 Inno Profile、模型、工具权限、Workspace fixture 和测试环境下验证通过。

验证结论不是对所有 Inno 版本、模型和部署环境的永久保证。界面必须同时显示 Inno Profile、模型、权限摘要、验证时间和报告入口；用户改用未覆盖的模型、Profile 或权限组合时，状态显示为“当前配置未覆盖”，不能继续沿用原验证结论。

## 4. 总体架构

~~~mermaid
flowchart LR
    UI[EduSkill Web] --> API[EduSkill 控制面]
    API --> REPO[个人 Skill 仓库]
    API --> APP[Run / Test / Arena / Optimization]
    APP --> REG[Harness Registry]
    REG --> LEGACY[旧 Prompt Adapter]
    REG --> IA[Inno Adapter]
    REG -.未来.-> OA[其他 Harness Adapter]

    IA --> Q[Run Queue]
    Q --> IR[隔离 Inno Runner]
    IR --> NATIVE[原生 Inno Headless Server]
    NATIVE --> SESSION[Pi AgentSession]
    SESSION --> WS[Attempt 或 conversation 专属 workspace]

    API --> DB[(PostgreSQL)]
    API --> OBJ[(对象存储)]
    IR --> OBJ
~~~

### 4.1 控制面

EduSkill API 负责：

- 用户、权限和个人 Skill 仓库；
- SkillVersion、HarnessBuild 和 Release 生命周期；
- Run、Test、Arena 和优化编排；
- 任务队列、租约、取消和结果读取；
- 评价、状态展示和审计查询。

控制面不直接操作 Pi AgentSession，也不在 API 进程中执行 Skill 脚本。

### 4.2 Harness Registry

Registry 根据 Harness Profile 将统一运行请求路由到对应 Adapter。第一阶段只提供：

- 旧 Prompt Adapter：兼容尚未迁移的 Skill；
- Inno Adapter：唯一正式目标 Harness；
- Fake Adapter：只用于公共契约测试，不能产生“Inno 已验证”结论。

### 4.3 Inno Adapter 与 Runner

Inno Adapter 是薄控制层，负责把 EduSkill 的公共请求转换为 Inno HTTP/SSE 调用，并把原生事件转换为公共事件。Runner 负责原生进程、临时目录、Sandbox、资源限制、artifact 和清理。

Inno 或 Pi 的私有类型、工具名和事件结构只能存在于 Inno Builder、Adapter 和 Runner 内部。

## 5. Skill 生命周期与数据模型

### 5.1 Package 与单 Skill Release

现有 Package 继续作为 EduSkill 中的创作、组织和评测容器，不直接等同于 Inno 的安装包。它可以包含工作区背景、评价标准、初始文件和多个 Skill，但一个 Inno Skill Release 永远只对应其中一个 SkillVersion。

~~~text
Package
├── agent.md                 → Workspace fixture
├── 初始工作区文件            → Workspace fixture
├── rubric.md                → Evaluator config
└── 多个 Skill
    └── SkillVersion
        └── HarnessBuild
            └── 单 Skill Release
~~~

四类输入必须分别记录和计算 hash：

| 类型 | 包含内容 | 是否进入 Skill Release |
|---|---|---|
| Skill 内容 | SKILL.md、scripts、references、assets | 是 |
| Workspace fixture | agent.md、初始工作区文件和测试数据 | 否，只在运行时物化 |
| Runtime config | Inno Profile、模型、工具权限、网络策略和资源限制 | 否，只进入运行配置与 provenance |
| Evaluator config | rubric.md、断言和评分方法 | 否，只供 EduSkill 评价结果 |

Package 可以为一次运行选定上述内容，但 HarnessRunRequest 必须引用各自的不可变版本或 hash，不能把整个 Package ZIP 当成单 Skill Release。

### 5.2 用户看到的状态

产品界面使用简单状态：

~~~text
编辑中 → 验证中 → 测试通过 → 可安装
                  ↘ 验证失败 / 条件兼容
~~~

“Release”是内部工程名称，表示个人仓库中不可变、已验证的可安装版本，不表示公开上架。

### 5.3 三层内容模型

| 对象 | 作用 | 可变性 |
|---|---|---|
| SkillVersion | 保存用户确认过的一版 Skill 文件关系 | 被 Build 引用后不可修改 |
| HarnessBuild | 保存某个 Harness Profile 实际测试的文件清单与 hash | 完成后不可修改 |
| Release | 指向一个通过门禁的 HarnessBuild，并赋予仓库版本号 | 冻结后不可更换 Build |

关系如下：

~~~text
SkillVersion
    ↓ 固定 Builder + 固定 Inno Profile
HarnessBuild（bundleHash）
    ↓ 完整验证通过
Release（个人仓库可安装版本）
~~~

用户后续编辑会创建新的 SkillVersion，不会改变已存在的 Release。

### 5.4 运行模型

| 对象 | 作用 |
|---|---|
| Conversation | 多轮交互的逻辑边界，包含多个串行 Run |
| Run | 一次用户可见的执行请求；交互场景中通常对应一轮消息 |
| Attempt | Run 的一次实际执行或重试 |
| RuntimeLease | 将一个测试 Attempt 或交互 Conversation 绑定到专属 Inno 实例 |
| Event | 按序号持久化的统一运行事件 |
| Artifact | 运行产生的文件或其他制品 |
| ValidationReport | 静态、能力、行为和安装测试结果 |

Run 始终引用实际执行的 HarnessBuild，不能只记录“当前 Skill”。重试创建新的 Attempt，不覆盖前一次失败证据。Test 和 Arena 的 RuntimeLease 随 Attempt 结束；交互式 RuntimeLease 随 Conversation 跨轮次保留。

### 5.5 数据库与对象存储

PostgreSQL 保存关系和事务：

- Skill、SkillVersion、Harness Profile、HarnessBuild 和 Release；
- 文件清单、hash、状态、Run、Attempt 和验证报告；
- artifact 元数据、权限、provenance 和引用关系。

对象存储保存实际字节：

- SKILL.md、scripts、references 和 assets；
- 冻结后的 ZIP 或 tarball；
- 原生事件附件、诊断信息和运行 artifact。

每个文件使用 SHA-256 校验。Bundle manifest 按规范化路径排序后计算 bundleHash。对象 key 使用服务端安全标识或内容 hash，不直接拼接用户文件名。

### 5.6 不可变与幂等规则

- 相同 SkillVersion、Profile、Builder 和输入 hash 的构建应复用同一结果。
- Release 只能指向通过规定门禁的 HarnessBuild。
- 修正内容必须创建新版本，不能原地替换 Build 或 Release 文件。
- 弃用 Release 只改变默认展示与安装资格，不删除历史内容。
- blob 只有在没有任何 Version、Build、Release、Run 或 Artifact 引用并经过保留期后才能清理。
- 版本冻结、版本号唯一性和引用建立在一个数据库事务中完成。

## 6. Inno-first 与多 Harness 扩展

### 6.1 第一阶段只提供一套 Inno 配置

首个正式 Profile 为：

~~~text
inno-agent@0.5.4
commit: fcc669fd4a1164156b4056e52eb6681ec3abf4a9
~~~

它固定 Inno 提交、依赖锁文件、Pi SDK、Skill 加载方式、工具目录、事件映射和运行镜像。用户不需要在 core、learning、connected 等人为拆分的模式之间选择。

Inno 升级且行为发生变化时，创建新的 Profile。旧 Release 和历史 Run 继续指向原 Profile。

### 6.2 扩展单元

每种 Harness 由五部分组成：

| 组件 | 职责 |
|---|---|
| Harness Definition | 声明 Harness 类型和公共能力 |
| Harness Profile | 固定具体版本、配置、镜像与能力快照 |
| Target Builder | 将 SkillVersion 构建为目标 Harness 文件 |
| Runtime Adapter | 控制原生 Harness 并转换公共事件 |
| Runner | 提供依赖、隔离、配额和运行生命周期 |

未来新增 Harness 时增加这五部分，不修改现有 Inno Release，也不把条件分支散落到 Arena、测试和优化服务。

### 6.3 公共能力与原生能力

核心层只使用稳定能力概念，例如文件读写、搜索、artifact 和结构化输出；具体工具名和参数由 Adapter 解释。无法统一的能力保留为目标平台扩展，不强行压成最低公分母。

公共事件保留跨 Harness 可理解的字段，同时保存原生事件引用，避免排障时丢失平台细节。

### 6.4 接口冻结前的可靠性门禁

正式冻结 Adapter 协议前，应：

- 从固定版本 Inno 提取 session、工具、事件、artifact、取消和错误语义；
- 选择一套结构明显不同的成熟 Harness 作为设计对照，但不在第一阶段接入生产；
- 输出能力矩阵、事件映射和错误语义表；
- 用 Inno Adapter 与 Fake Adapter 运行同一组契约测试；
- 确认核心业务代码没有导入 Inno 或 Pi 私有类型。

这项调研用于验证抽象是否可靠，不等于提前建设第二套 Harness。

## 7. 原生 Inno Runner

### 7.1 必须运行真实 Inno

正式行为验证和安装冒烟测试必须进入固定提交构建的原生 Inno Headless Server。EduSkill 不复制 Pi Agent 循环，也不根据源码自行实现一套“相似 Harness”。

构建 Runner 镜像时应：

- 使用目标提交和仓库锁文件；
- 固定 Node 运行环境，目标版本要求 Node 20.6 或以上；
- 记录镜像摘要、Inno、Pi、Adapter 和 Builder 版本；
- 保留 Inno Agent 的 MIT 许可证及相关声明。

开发环境可以使用以下原生入口；实际参数由 Runner 分配：

~~~text
npm run server -- --home <temp-home> --workspace <temp-workspace> --port <port>
npm run server:sandbox -- --home <temp-home> --workspace <temp-workspace> --port <port>
~~~

### 7.2 通用启动与清理流程

1. Worker 领取任务并获得短期租约。
2. 创建独立 home、workspace 和 artifact 临时目录。
3. 物化只读 HarnessBuild 与测试 fixture。
4. 启动固定版本原生 Inno Server，并完成健康检查。
5. 通过 Inno 自己的接口安装或加载同一 bundleHash 的 Skill。
6. 创建 session，并通过原生 HTTP/SSE 接口执行消息。
7. 持久化统一事件和原生事件引用。
8. 在有限重试预算内收集显式声明的 artifact，完成安全校验后上传；失败时记录明确终止原因。
9. 到达当前场景的生命周期终点后执行幂等清理。

一个原生 Inno 实例同一时刻只能绑定一个 EduSkill conversation 或 Attempt。预热池只能保存没有用户状态的空实例；无法证明彻底重置时必须销毁重建。

### 7.3 两种生命周期

| 场景 | 实例归属 | 状态保留 | 清理时机 |
|---|---|---|---|
| Test、Arena、Release 验证 | 一个 Attempt 独占一个 Inno 实例 | 仅在本次 Attempt 内保留 | 成功、失败、取消或超时后立即销毁 |
| 多轮交互 Run | 一个 conversation 独占一个 Inno 实例 | 多轮共用 session、home 和 workspace | 用户结束、空闲超时、达到最长生命周期或实例失去健康状态后销毁 |

Test、Arena 和 Release 验证的重试必须创建全新的实例和 Attempt，不能复用上一次失败后的 session。Arena 两侧分别使用独立实例，但使用相同镜像、Profile、fixture、权限和资源配置。

多轮交互 conversation 通过专属运行租约绑定实例。同一 conversation 内的用户轮次串行进入原生 Inno 队列，前一轮生成的文件和 Agent 状态在后续轮次继续可见；不同 conversation 即使属于同一用户也不得共享 session 或 workspace。

取消交互式 Run 时，首先中止当前轮次。只有 Adapter 能确认原生 Inno 已进入稳定终止状态且健康检查通过时，conversation 才能继续复用该实例；否则销毁实例并将 conversation 标记为中断，不能把状态未知的 session 交给下一轮。

初版不实现 conversation 休眠后恢复原生进程。需要跨进程恢复时，只能基于持久化对话记录和经过定义的 workspace 快照启动新实例，并明确标记为“恢复运行”，不能声称与原进程内 session 完全等价。

### 7.4 控制接口

控制面只需要理解以下动作：

~~~text
prepare(targetBuild, fixture, harnessProfile, policy)
run(messages, model, limits)
stream(events)
cancel(runId)
collectArtifacts(runId)
dispose(runId)
~~~

这些动作构成应用层契约，不暴露 AgentSession 内部状态。

### 7.5 任务、重试和事件可靠性

- Worker 使用租约、心跳和短期内部凭据领取任务。
- 租约失效后任务可被重新领取，但旧 Worker 不能继续写结果。
- 重试创建新 Attempt，并记录原因与前序 Attempt。
- Event 使用单调递增序号持久化，SSE 断线后可以续传。
- cancel、超时和 Worker 丢失都转换为稳定终止状态。
- artifact 下载使用短期授权，不暴露对象存储管理凭据。

建议统一事件至少包括：

~~~text
run_started
agent_status
text_delta
reasoning_delta  # 可选
tool_started
tool_input_delta
tool_finished
artifact_created
permission_required
run_failed
run_finished
~~~

reasoning_delta 是 Harness 能力协商后的可选事件。原生 Harness 不产生、模型不支持或产品策略关闭时不得导致运行失败。普通用户是否可见由产品策略决定；兼容判断、重放和核心审计均不得依赖 reasoning_delta 或模型私有思考过程。

## 8. 个人 Skill 仓库与交付物

### 8.1 核心交付物

| 交付物 | 用途 | 当前优先级 |
|---|---|---|
| Inno Skill Release | 下载并安装一个 SkillVersion 的已验证文件目录 | 核心 |
| EduSkill Archive | 备份 Source、Build、rubric、历史和 provenance | 辅助 |
| Inno Workspace ZIP / Preset | 携带 agent.md 和多个工作区 Skill | 后续 |

当前只要求个人仓库保存草稿、历史版本和 Release。公开检索、运营和分发不在范围内。

个人仓库中的内容默认私有。服务端每次读取、下载和安装授权都必须校验所有者或组织权限，不能把不可猜测 ID 当作访问控制。对象存储仅签发短期、单对象授权。

每个 Release 至少记录名称、版本、所有者、来源与许可证、目标 Inno Profile、文件 manifest、bundleHash、能力与权限要求、验证报告、兼容状态和创建时间。

### 8.2 单 Skill Release 格式

- 压缩包中恰好有一个 SKILL.md，并位于包根目录。
- scripts、references 和 assets 位于同一 Skill 根目录。
- frontmatter name 同时满足 Agent Skills 和目标 Inno 约束。
- 不包含 .git、node_modules、缓存、临时文件、凭据或本机绝对路径。
- 不允许 symlink、路径穿越和大小写冲突路径。
- 文件排序、换行和归档时间规范化，保证相同内容得到相同 hash。
- 安装身份以已校验的 frontmatter name 为准，不依赖下载文件名。

Inno 的 Skill ZIP 安装器会递归选择发现的第一个 SKILL.md。因此包含多个 Skill 的 Package ZIP 不能进入单 Skill 安装入口，否则可能只安装其中一个。平台必须从交付类型上阻止这种误用。

### 8.3 Script 声明与执行边界

Agent Skills 允许 scripts 目录，但没有替 EduSkill 定义生产级依赖安装和权限协议。为避免产生只能在开发者电脑运行的 Skill，每个可执行脚本必须在 HarnessBuild manifest 中声明：

- 相对于 Skill 根目录的脚本路径；
- 运行时名称、版本约束、入口和调用方式；
- 依赖清单、锁文件或可复现的依赖来源；
- 工作目录、必要参数和输入文件；
- 网络、凭据和 Harness capability 要求；
- 时间、内存、输出大小等资源限制；
- 预期 Artifact 路径或收集规则。

这些声明属于 EduSkill 的 Build/Release 元数据，不额外发明一个要求 Inno 原生识别的配置文件。目标 Harness 真正需要的标准依赖文件和锁文件可以作为 Skill 文件进入 Bundle，但必须经过 Builder 和安全校验。

脚本不得依赖本机绝对路径、开发机全局依赖或文件可执行位。Runner 使用显式运行时调用入口。第一阶段只允许实施计划列入白名单的运行时和依赖方式；未声明或无法锁定的运行时、依赖与网络需求属于硬错误。

首版允许按声明准备额外依赖。这里“直接安装”表示安装内容符合 Inno 格式且无需手工改写 Skill；“可以执行”表示目标环境满足该版本声明的运行时、依赖、配置和权限条件。

个人仓库分别展示以下运行条件，且与验证状态独立：

| 环境要求 | 含义 |
|---|---|
| 安装即可使用 | 在指定 Inno Profile 的已配置基础环境中，无需额外准备该 Skill 的依赖 |
| 需要准备环境 | 需要按说明补充运行时、依赖或外部服务配置后再使用 |

带额外依赖的 Release 必须随包提供标准依赖文件、可复现的准备步骤和环境检查方法；SKILL.md 应通过相对路径引用这些说明。平台尽量自动检查可检测的条件，无法确认的条件明确列出，不默认视为满足。准备说明、依赖文件与 Skill 一起冻结，后续改动需要新版本并重新验证。

平台验证从干净环境开始，按随包提供的同一套步骤完成依赖准备，再由原生 Inno 执行任务；报告记录实际安装版本和环境配置。完整通过准备与运行验证的 Release 可以标记“Inno 已验证”，即使它同时标记“需要准备环境”。后者说明使用前提，不代表只完成了部分验证。

用户端的软件安装和凭据配置由用户主动执行或授权。首版提供检查结果与准备说明，不建设通用一键依赖安装系统。依赖准备与正式任务执行分开，准备阶段需要的联网权限不自动延续到运行阶段。

### 8.4 Artifact 收集边界

Runner 不上传整个 workspace。Artifact 只允许通过以下来源显式产生：

1. 写入 workspace 下约定的 artifacts/ 目录；
2. Inno 工具结果明确登记的相对文件路径；
3. Run Policy 中预先声明、限定在 workspace 内的 artifactRules。

Runner 收集前必须规范化路径并校验所有权、文件类型、大小、数量、symlink 和目录穿越。依赖目录、缓存、临时文件、隐藏运行状态和普通日志默认排除。Artifact manifest 记录相对路径、内容 hash、媒体类型、大小、来源工具或规则以及产生它的事件序号。

多轮交互 Run 使用内容 hash 和事件序号识别本轮新增或变化的 Artifact，避免每轮重复上传整个目录。Artifact 不会自动成为其他 Run 的输入；只有显式加入新的 Workspace fixture 后才能复用。

### 8.5 同一份文件贯穿全链路

~~~text
HarnessBuild
→ 行为测试
→ 安装冒烟测试
→ 冻结 Release
→ 个人仓库下载 ZIP
→ 未来由 Inno 私有拉取或受认证安装
~~~

任何改变内容的操作都必须发生在冻结前。冻结后，下载和安装服务只能读取该 Release，不能再次调用模型、补字段或重新生成文件。

未来直连可以将同一文件树封装为 Inno 支持的 tar.gz；ZIP 与 tarball 容器可以不同，但解包后的 manifest 和内容 hash 必须一致。直连优先采用 Inno 在用户授权后从个人私有源拉取 Release。该能力只保留接口边界，本期不实施 Content Hub。

## 9. 生成、校验与兼容结论

### 9.1 流水线

~~~text
用户编辑
→ 创建 SkillVersion
→ 使用固定 Inno Profile 构建 HarnessBuild
→ 计算 bundleHash
→ Agent Skills 与 Bundle 静态校验
→ Inno 工具和能力校验
→ 原生 Inno 黄金任务测试
→ 全新 Inno 实例安装冒烟测试
→ 冻结个人仓库 Release
~~~

生成器、构建器、校验器和 Runner 相互独立。生成模型不能自行宣布自己的结果已经兼容 Inno。

### 9.2 内容原则

- description 同时说明“做什么”和“什么时候使用”，并覆盖用户真实表达。
- 正文不假设始终被完整注入 system prompt。
- 详细资料进入 references，仅在需要时读取。
- 稳定、机械、可验证的操作优先进入 scripts。
- 文件引用使用相对 Skill 根目录的路径。
- 只能引用目标 Inno Profile 真实存在的工具。
- 工具条件、输入、失败处理和终止条件必须明确。
- 输出文件说明格式、位置和完成标准；需要交付给用户的文件写入约定的 artifacts/ 目录或使用允许的显式登记方式。
- 教育类 Skill 不得伪造学习证据、掌握度或学习者档案更新。

### 9.3 分层校验

| 层级 | 内容 |
|---|---|
| 规范 | frontmatter、命名、description 和目录结构 |
| Bundle | 引用、路径、安全规则、脚本依赖和文件完整性 |
| 能力 | 目标 Inno 是否具有所需工具、配置和权限 |
| 行为 | 原生 Inno 是否完成黄金任务及预期工具和 artifact |
| 安装 | 最终 Bundle 能否在全新 Inno 实例中安装并被发现 |

以下问题必须阻止生成“Inno 已验证”的 Release：

- frontmatter、目录、路径或 Bundle 安全规则不合法；
- 引用文件、脚本依赖或必要输入缺失；
- 使用目标 Inno 不存在的工具或错误参数；
- 原生 Inno 无法加载、发现或触发 Skill；
- 黄金任务、工具轨迹、artifact 或安装测试失败；
- 安装测试文件 hash 与待冻结 Bundle 不一致；
- 任务必需的外部能力没有可验证的测试条件。

固定章节、示例数量、表达风格和非必要文档完整度属于质量建议，可以产生警告，但不能代替兼容测试。只能完成部分外部验证的版本保留为草稿并标记“条件兼容”，不能标记“完整兼容”。

### 9.4 能力清单与错误模型

平台维护由目标源码生成并人工复核的 Inno 能力清单，记录工具名、schema、版本、可用条件、状态、副作用和测试方法。产品上仍只有一套 Inno Harness，不把能力清单做成多个用户 Profile。

错误使用稳定分类和错误码，至少区分：

- 格式与文件错误；
- 能力或权限缺失；
- Skill 未发现或未触发；
- 工具调用失败；
- 安装失败；
- Inno 运行异常；
- 超时、取消和资源超限。

每份验证报告记录 Inno Profile、Pi、Builder、Adapter、模型、工具权限、Workspace fixture、测试环境、bundleHash 和验证时间。这些字段共同构成验证范围；其中任何关键字段变化都需要新报告，不能把旧结论自动继承到未覆盖配置。

## 10. Run、Test、Arena 与优化

四种场景共用同一 Harness 请求、Registry、Adapter、Runner、事件流和结果结构：

~~~mermaid
flowchart LR
    RUN[Run] --> H[统一 Harness 执行]
    TEST[Test] --> H
    ARENA[Arena] --> H
    OPT[Optimization] --> H
    H --> E[运行事实]
    E --> UI[结果展示]
    E --> TV[Test Evaluator]
    E --> AV[Arena Evaluator]
    E --> OV[Optimization Gate]
~~~

Harness 只负责执行并产生事实，不负责判断回答好坏。Test、Arena 和 Optimization 的 evaluator 在运行后解释同一份证据。

不同场景只允许改变：

- 用户消息或测试样本；
- 断言和评分方法；
- 待比较的 SkillVersion；
- 是否根据结果创建新的候选 SkillVersion。

它们不能各自临时拼装 Skill 或改变底层 Inno 行为。

### 10.1 Arena 公平性

Arena 开始前计算环境指纹。除待比较的 Skill Build 外，以下内容必须一致：

- 模型和采样参数；
- Inno Profile 和 system context；
- 工具注册与权限；
- 初始 workspace fixture；
- 网络策略；
- token、时间和资源限制。

环境指纹不同则拒绝比较，不能在评分后再解释差异。

### 10.2 优化闭环

优化器读取回答、工具轨迹、文件、artifact、权限违规和 rubric 结果，创建新的候选 SkillVersion。候选版本重新经过构建、行为测试和安装门禁，不能直接覆盖 SkillVersion、HarnessBuild 或 Release。

## 11. 安全、隔离与审计

### 11.1 基本原则

- Test、Arena 和 Release 验证的每个 Attempt 使用独立 home、workspace、session 和临时凭据。
- 多轮交互 conversation 使用专属环境跨轮次保留状态，但绝不与其他 conversation 共享。
- HarnessBuild 只读挂载；只允许在当前 workspace 写入。
- shell 与 Skill 任意联网权限默认关闭；模型服务、依赖源和搜索/API 的访问按第 11.4 节分别授权。
- Runner 不继承 EduSkill 数据库或对象存储管理凭据。
- 成功、失败、取消和超时都进入幂等清理流程。
- artifact 在清理前按有限预算上传并校验；永久失败时记录错误并进入短期隔离保留，保留期结束后仍必须清理。

### 11.2 实际部署分级

| 环境 | 隔离方式 | 能力限制 |
|---|---|---|
| 本地开发 | 独立 Inno 进程和临时目录 | 只允许受控工具和配置的模型入口；shell、任意脚本和 Skill 任意联网关闭 |
| CI / 兼容测试 | 一次性容器或等价 Sandbox | 只开放测试声明需要的能力与 fixture |
| 生产环境 | Runner Pool，每个测试 Attempt 或交互 conversation 租约进入专属容器或等价 Sandbox | 按 capability 最小授权，执行配额、网络策略和审计 |

独立进程是生命周期边界，不是操作系统安全边界。任何环境一旦允许 shell、用户脚本、用户控制命令或不受信任网络访问，就必须使用容器或等价 Sandbox。

### 11.3 权限、凭据和配额

实际权限由三者取交集：

~~~text
Harness Profile 可提供能力
∩ Skill 声明的需要
∩ 本次 Run Policy 的授权
~~~

任一层未授权都不得执行。交互式运行可以产生 permission_required 事件；自动测试和 Arena 不等待人工确认，未预授权即明确失败。

密钥和外部凭据以短期、最小范围方式注入，不写入 Bundle、workspace、事件正文或 artifact。每个测试 Attempt 或交互 conversation 运行租约都限制 CPU、内存、磁盘、运行时间、token、工具调用次数和 artifact 大小；交互配额同时设置单轮上限与 conversation 累计上限。

### 11.4 按用途授权网络访问

“外网默认关闭”是指 Skill 不具有任意联网权限，不表示阻断原生 Inno 连接已配置的模型服务。首版采用以下规则：

| 用途 | 允许范围 | 生效阶段 |
|---|---|---|
| 模型调用 | 平台配置的模型服务或模型网关入口；凭据由平台管理 | 原生 Inno 执行期间 |
| 依赖下载 | 批准的软件源及声明的依赖来源 | 隔离的环境准备阶段，完成后撤销 |
| 搜索与外部 API | 已配置的 Inno 工具及本次运行明确授权的服务 | 对应任务执行期间 |

首版优先使用已配置的 Inno 搜索/API 工具。直接抓取任意网页或脚本访问任意网址不默认开放，确有需求时作为独立能力评估和授权。允许访问模型入口，不代表 Skill 脚本可以取得模型密钥或获得同等调用权限。

网络访问由执行环境的出口策略或受控代理强制约束，并配合工具权限校验；Skill 提示词和工具声明本身不构成网络安全边界。具体域名、端口及重定向规则在实施配置中固定，并在 Runner Spike 中验证允许与拒绝路径确实生效。

运行前检查所需网络能力。交互式 Run 缺少授权时按第 11.3 节请求权限；自动测试和 Arena 使用预先固定的授权，执行中不得自行扩大访问范围。依赖准备使用独立的权限策略，下载权限不得自动延续到正式任务。

联网权限与对外操作权限分别管理。发送消息、提交数据、创建定时任务等操作需要独立授权；允许访问某个服务不等于允许执行其所有操作。自动验证使用明确的测试账户或受控集成环境，外部能力未验证时按第 9.3 节标记兼容范围。

验证报告记录批准的服务、网络策略版本及脱敏后的实际访问摘要。环境指纹包含网络策略；策略改变后不自动沿用旧配置的验证结论。

### 11.5 Provenance

每次运行至少保存：

- 用户、Skill、SkillVersion、HarnessBuild 和 bundleHash；
- Harness Definition、Profile、Adapter、Builder 和镜像摘要；
- 模型、参数、system context hash 和工具注册表 hash；
- workspace fixture hash 和权限策略；
- 工具调用、输入输出文件和 artifact；
- token、耗时、错误与终止原因；
- 统一事件和原生事件引用。

保存目标是复现和审计 Tool、Event、Result、Artifact、模型与环境等稳定事实，不是无限保存模型内部过程。reasoning_delta 即使存在也只是可选诊断信息，不是 provenance 完整性的必要条件。

## 12. 迁移方案

迁移采用版本级渐进策略：

~~~text
v1_prompt   现有文本注入运行时
v2_harness  新的 Harness 执行层，首个实现为真实 Inno
~~~

现有 Skill 不一次性切换。先无损转换存储格式，再进行真实 Inno Shadow 验证；只有通过门禁的具体 SkillVersion 才切换到 v2。明确面向 Inno 新建的 Skill 默认使用 v2。

### 首批交付范围

首批交付的用户验收目标是：在个人仓库中选择一个 Skill，通过真实 Inno 执行任务并查看工具轨迹与输出文件；下载同一份 Skill，在干净的目标 Inno 环境中安装并复现关键行为。

首批交付覆盖下面 Phase 0 至 Phase 3 的必要工作。Phase 0.5 是内部可行性验证，Phase 1 是存储建设步骤，都不单独代表用户验收完成。Arena、自动优化和完整仓库治理在后续阶段接入；首批必须具备的内容追溯、私有权限、运行隔离与安装验证仍须落实。

### Phase 0：冻结兼容基准

- 固定 Inno、Pi、Agent Skills、Builder 和 Adapter 版本。
- 建立黄金 Skill、正反触发样本、workspace fixture 和期望工具轨迹。
- 建立 Inno 能力矩阵、事件映射和错误语义。

### Phase 0.5：最小 Runner Spike

在修改 SkillVersion、HarnessBuild、对象存储等正式数据模型前，先用固定 Skill 和固定 fixture 验证原生 Inno。正常完成与执行中取消采用独立用例：

~~~text
公共准备：启动固定版本原生 Inno → 安装固定 Skill → 创建 Session
正常完成：真实 Tool Call → SSE → 收集 Artifact → 正常终止 → 清理
执行中取消：确认工具正在执行 → 发出 Cancel → 确认执行停止 → 清理
~~~

Spike 使用最小控制程序，不接入生产数据库或完整仓库与调度系统。执行必须使用原生 Inno，不能由 Fake Adapter 代替。四组验收如下：

| 验收组 | 必须证明的行为 |
|---|---|
| 正常完成 | 固定 Skill 安装和发现成功；原生工具实际执行，SSE 可观测，输出文件通过断言并被收集 |
| 多轮连续 | 第一轮生成文件，第二轮在同一实例和 Session 中读取并修改；轮次串行，会话状态保持连续 |
| 执行中取消与清理 | 工具仍在执行时发出 Cancel，确认工具及其子进程停止；销毁后不残留进程、监听端口、临时 home 或 workspace |
| 隔离与权限 | 两个独立实例并行运行，无法读取彼此的文件或会话；允许的模型入口可用，未授权网络访问被阻止 |

取消测试不能在任务完成后才发出请求，也不能只以收到取消响应或 SSE 断开作为通过依据。取消请求到最终终止之间允许接收收尾事件；最终终止后不得继续执行工具或修改文件，迟到事件不能重新推进已终止轮次的状态。交互实例能否复用仍按第 7.3 节的状态与健康检查判断。

每组保留原生事件、统一事件映射、文件断言及进程清理证据，并按执行前约定的次数重复运行。原生事件必须能够解释公共结果和终止状态，连续测试不得存在状态串扰。

性能测量记录冷启动时间、单实例内存、Skill 安装耗时、首 Token 时间、Cancel 延迟和 Cleanup 时间。报告同时记录机器资源、模型、样本及测量起止点，区分模型响应等待与 Runner 启动开销。具体超时、性能门槛和重复次数由实施计划根据部署资源在执行前确定；测量结果用于实例池、并发和容量预算。

四组功能检查全部通过、测量与诊断证据完整，并满足执行前约定的门槛，才允许进入 Phase 1。失败项必须修复并重测，或修订架构后重新评审；单次成功演示不作为正式开发的准入依据。

Spike 代码默认视为验证性代码。只有经过正式接口、错误处理、安全和测试审查后，才能选择性演进为生产 Runner；不得因为“已经跑通”就直接进入生产。若 Spike 无法证明取消、清理或事件映射可靠，应先修订 Runner 架构，再开始 Phase 1。

### Phase 1：多文件 Skill 与个人仓库

- 将现有 skillMd 无损迁移为只包含 SKILL.md 的 SkillVersion。
- 支持 scripts、references 和 assets。
- 建立 manifest、对象存储、内容 hash 和不可变 HarnessBuild。
- 建立 Script 声明、运行时白名单和 Artifact 显式收集规则。
- 支持单 Skill ZIP 与静态兼容报告。

这一步只改变存储与导出，不改变旧 Skill 的默认运行结果。

### Phase 2：原生 Inno Shadow Run

- 建立 Harness Registry、Inno Adapter、任务队列和独立 Runner。
- 使用同一内部样本同时运行 v1 与 v2。
- v2 结果只用于比较、调试和建立兼容门槛，不直接替换用户结果。

### Phase 3：切换 Run 与 Test

- 通过门禁的 SkillVersion 默认使用 v2。
- 前端展示工具轨迹、artifact 和结构化失败原因。
- 保留按 SkillVersion 回退 v1 的能力。
- 完成第 14.2 节三类样本的用户验收，包括仓库下载和独立、干净目标 Inno 实例的安装运行。
- 在首批可安装版本形成前接入自动安装冒烟测试，下载复用测试过的同一份 ZIP。

### Phase 4：切换 Arena 与优化

- Arena 使用统一 Harness 与环境指纹。
- 优化质量门禁加入触发、工具、文件和 artifact 检查。
- 历史结果保留原 runtime 标识，不重新解释。

### Phase 5：交付能力扩展与升级治理

- 扩大安装回归样本和兼容配置覆盖，维护已建立的下载与安装一致性。
- 根据需要增加 Workspace Preset 导出。
- 预留个人仓库到 Inno 私有直连边界，但本期不实现 Content Hub。
- 建立 Inno 升级兼容矩阵和旧 Profile 保留策略。

### 12.1 回退与旧运行时退出

- 回退单位是 SkillVersion 或 Harness Profile，不回滚历史数据。
- Harness 故障时只切回受影响版本；新旧运行证据均保留。
- 已冻结 Bundle 继续通过 hash 指向原始内容。
- 目标 Skill 迁移完成、稳定观察期结束且失败率与回退率达到门槛后，停止为 Inno Skill 创建新的 v1 运行。
- 历史 v1 记录永久保留其真实 runtime 身份。

## 13. 工程调整范围

### 13.1 共享契约

预计调整 educlaw-shared/index.ts，并在体量增长后拆分专用 harness contract：

- Skill 文件、manifest、SkillVersion、HarnessBuild 和 Release；
- Harness Definition、Profile、Run、Attempt、Event 和 Artifact；
- capability、错误码、资源限制和 provenance。

### 13.2 服务端控制面

预计调整：

- 多文件 Skill 导入、版本化、构建和导出服务；
- 静态校验、能力校验与 Release 门禁；
- Run/Test/Arena/Optimization 到统一 Harness Port 的接入；
- 任务租约、取消、SSE 续传和 artifact 授权；
- 数据库迁移、对象引用与垃圾回收。

重点影响现有：

- educlaw-server/src/services/package-service.ts
- educlaw-server/src/services/arena-service.ts
- educlaw-server/src/services/answer-skill-optimization-service.ts

### 13.3 新的 Runner workspace

Runner 建议作为 monorepo 独立 workspace，负责：

- 构建或拉取固定版本 Inno 镜像；
- 物化 HarnessBuild 与 fixture；
- 启动、健康检查和停止原生 Inno Server；
- 调用原生 HTTP/SSE 接口；
- 应用 Sandbox、权限与资源限制；
- 转换事件、上传 artifact 并清理。

Runner 不负责用户、仓库版本、Arena 评分或产品状态。

### 13.4 前端

预计增加：

- Skill 文件树和辅助文件编辑；
- 目标 Inno 版本与兼容状态；
- 验证报告、工具轨迹和 artifact；
- 可安装版本与 ZIP 下载；
- “安装即可使用 / 需要准备环境”标记、环境检查结果与随包准备说明；
- 清晰的能力缺失、权限和测试失败说明。

用户界面不需要暴露 Source、Target Build、Adapter 等内部术语。

## 14. 测试与完成标准

### 14.1 必要测试

| 测试层 | 关键断言 |
|---|---|
| 单元测试 | manifest、hash、路径、安全规则、错误映射和幂等逻辑 |
| Script / Artifact | 未声明依赖被阻止；只收集显式输出；缓存、临时文件和越界路径不进入 Artifact |
| Adapter 契约 | Inno 与 Fake Adapter 遵守同一公共请求、事件和取消语义 |
| Runner Spike | 正常完成、多轮连续、执行中取消与清理、隔离与权限四组通过；性能测量与重复运行证据完整 |
| 原生集成 | 固定 Inno 能发现 Skill、调用真实工具并产生预期 artifact |
| 安装冒烟 | 同一 bundleHash 能安装到全新 Inno 实例 |
| Arena | 两侧环境指纹一致，只有 Skill Build 不同 |
| 隔离与故障 | 多用户不串扰；取消、超时、Worker 丢失和重试正确收尾 |
| 网络授权 | 模型入口可用；未授权目标被阻止；准备阶段下载权限在执行阶段失效；对外操作独立鉴权 |
| 迁移 | 旧内容无损、历史 runtime 不改写、版本级回退有效 |

### 14.2 首批交付验收

首批交付覆盖个人 Skill 仓库、原生 Inno 运行、过程与产物查看、同一版本导出，以及干净目标 Inno 环境中的安装验证。先通过 Runner Spike，再推进正式系统改造；不包含公开 Skill 广场、第二套生产 Harness，以及 Arena 和 Optimization 的完整改造，仅保留相应接入边界。

首批至少选定以下三类代表性 Skill，并在执行前冻结输入、预期行为及输出断言：

| 样本类型 | 主要验证内容 |
|---|---|
| 纯指令 Skill | 自然语言发现、显式触发、多轮交互状态连续性 |
| 带参考文件的 Skill | 完整目录导出、相对路径读取、按需加载参考资料 |
| 带脚本并生成文件的 Skill | 运行时与依赖、真实工具调用、Artifact 收集与交付 |

三类样本均须完成“个人仓库选择 → 真实 Inno 运行 → 下载同一 ZIP → 干净目标 Inno 安装 → 关键行为复现”。不要求模型逐字输出相同，但必须通过预先定义的行为和文件断言。

验收报告记录 Bundle 与 ZIP 的 hash、Inno Profile、模型、权限、fixture、依赖环境、工具轨迹和输出证据。目标实例只能按声明步骤准备运行环境，不得沿用平台测试实例的会话、缓存或未声明依赖；格式上能安装但脚本无法执行，仍视为未通过。

脚本语言、白名单及具体依赖版本依据第三类样本与 Runner Spike 结果确定，不预设“仅支持 Node”或“依赖必须打包为单文件”。带额外依赖的样本必须验证随包准备步骤可在干净环境复现；缺少必需依赖时应给出明确检查结果，不能显示环境已就绪。

### 14.3 整体架构验收标准

以下条件全部满足，才能认为本文整体接入方案完成；其中 Arena 与 Optimization 属于首批交付之后的验收范围：

1. 一组代表性 Skill 能从个人仓库下载并安装到目标 Inno。
2. 下载文件与行为测试、安装测试使用相同 bundleHash。
3. 原生 Inno 实际完成预期触发、工具调用、文件操作和 artifact。
4. Run、Test、Arena 和 Optimization 使用同一 Harness 执行入口。
5. 并发隔离测试没有 session、文件和凭据串扰。
6. 所有运行可以追溯到固定 Profile、Build、模型和工具环境。
7. 新 Harness 的契约样例不要求核心业务导入 Inno/Pi 私有类型。
8. 旧 Skill 能按版本迁移、回退，历史运行记录保持真实身份。

## 15. 主要风险

| 风险 | 应对 |
|---|---|
| Inno 或 Pi 升级导致行为漂移 | 固定提交、锁文件和镜像；新版本建立新 Profile 与回归矩阵 |
| 在 EduSkill 复制 Inno 逻辑造成长期分叉 | 始终调用固定版本原生 Inno，只维护薄 Adapter |
| 原生 Inno 单 session 被错误共享 | 实例租约绑定单 conversation/Attempt；无法安全重置即销毁 |
| 多 Harness 抽象过早变成最低公分母 | 公共能力只覆盖稳定概念，平台差异保留为 Adapter 扩展 |
| 统一事件丢失 Inno 细节 | 同时保存统一事件和原生事件引用 |
| 工具执行扩大攻击面 | 独立 Runner、默认拒绝、Sandbox、配额和审计 |
| description 路由不稳定 | 正向、负向和多 Skill 冲突样本共同测试 |
| Arena 环境不同导致结论无效 | 比较前强制校验环境指纹 |
| Bundle 和 artifact 数据增长 | manifest、对象存储、内容寻址、引用检查和延迟清理 |
| 双运行时长期并存 | 为 v1 设置迁移指标、稳定观察期和明确退出条件 |

## 16. 已确认决策

| 编号 | 决策 |
|---|---|
| D1 | 兼容必须同时覆盖安装和真实行为 |
| D2 | Inno-first；核心契约保持 multi-harness-ready |
| D3 | 个人仓库以不可变 Inno Skill Release 为核心交付物 |
| D4 | 使用独立 Runner 驱动原生 Inno；测试按 Attempt、交互按 conversation 管理实例生命周期 |
| D5 | 采用 SkillVersion → HarnessBuild → Release |
| D6 | 第一阶段只提供一套固定版本的真实 Inno Profile |
| D7 | 分层校验；同一 Bundle 通过原生行为与安装双测试，并显式声明 Script 与 Artifact 边界 |
| D8 | Run、Test、Arena 和优化共用 Harness 执行协议 |
| D9 | 安全规则统一，开发、CI 和生产使用分级隔离 |
| D10 | 先完成最小 Runner Spike，再按具体 SkillVersion 进行 Shadow 验证和渐进迁移 |

上述决策均于 2026-09-04 在讨论中确认；2026-09-06 的首轮架构评审进一步明确了 Package 边界、两类 Runner 生命周期、前置 Spike、验证范围、可选 reasoning 以及 Script/Artifact 契约，未改变总体方向。

2026-09-08 确认并冻结第 14.2 节首批交付范围，以三类代表性 Skill 的“真实运行、下载、干净 Inno 安装复现”为验收目标；安装验证前移至 Phase 3，Arena 与自动优化保留在后续阶段。架构讨论至此定稿，后续工程规范细化实施任务、配置与验收方式；真实运行可行性仍须由 Runner Spike 验证。

同日确认允许按声明准备额外依赖：Skill 安装内容无需手工改写，环境前提须可检查、可按随包步骤复现。仓库区分两类环境要求；是否验证通过另行标记，首版不建设通用一键环境安装系统。

同日确认网络按用途授权：指定模型入口、准备阶段依赖源和运行阶段搜索/API 分别管理，Skill 任意联网默认关闭；访问规则由执行环境强制执行，对外操作另行授权。

同日确认 Runner Spike 以正常完成、多轮连续、执行中取消与清理、隔离与权限四组验收作为正式开发准入；性能门槛和重复次数在执行前确定，取消必须在实际执行过程中验证。

## 17. 实施计划前需要定下的参数

这些问题不改变本文架构，但必须在对应实施阶段给出明确配置和验收值：

- 第一阶段允许哪些脚本语言及依赖安装方式；
- Runner 的超时、并发与资源限制，以及 Spike 的性能门槛和重复次数；先根据部署资源设定验收值，再通过实测校准运行配置；
- 按第 11.4 节确定首版模型入口、批准依赖源、搜索/API 服务的具体域名、端口和出口策略；
- artifact 的单次大小、总容量和保留期限；
- 黄金测试允许的非确定性范围和重试次数；
- Inno Profile 升级的负责人、触发条件和兼容观察期；
- v1 退出所需的覆盖率、失败率和回退率门槛；
- 第二套生产 Harness 的准入标准；
- 未来私有直连采用 Inno 私有源拉取还是受认证安装 API。

这些参数应进入后续实施计划、配置规范或运行手册，不能依靠代码默认值和口头约定。

## 18. 参考资料与代码依据

### Inno Agent 与规范

- [Inno Agent README](https://github.com/hhyqhh/inno-agent/blob/fcc669fd4a1164156b4056e52eb6681ec3abf4a9/README.md)
- [Inno Agent Pi Runner](https://github.com/hhyqhh/inno-agent/blob/fcc669fd4a1164156b4056e52eb6681ec3abf4a9/apps/inno-agent/src/agent/pi-runner.ts)
- [Inno Agent Extension 与工具注册](https://github.com/hhyqhh/inno-agent/blob/fcc669fd4a1164156b4056e52eb6681ec3abf4a9/apps/inno-agent/src/agent/inno-extension.ts)
- [Inno Agent Skill 教程](https://github.com/hhyqhh/inno-agent/blob/fcc669fd4a1164156b4056e52eb6681ec3abf4a9/docs/use-cases/skill-tutorial.md)
- [Inno Agent Content Hub 格式](https://github.com/hhyqhh/inno-agent/blob/fcc669fd4a1164156b4056e52eb6681ec3abf4a9/scripts/content-hub-server/README.md)
- [Agent Skills Specification](https://agentskills.io/specification)

### EduSkill 当前实现

- [平台说明](../EDUSKILL_PLATFORM_OVERVIEW.md)
- [PackageSkill 与版本快照类型](../../educlaw-shared/index.ts)
- [Skill 生成、校验、导入和导出](../../educlaw-server/src/services/package-service.ts)
- [Arena 选择、Prompt 构造与运行](../../educlaw-server/src/services/arena-service.ts)
- [回答级 Skill 优化](../../educlaw-server/src/services/answer-skill-optimization-service.ts)
