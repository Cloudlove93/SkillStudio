# EduSkill 项目详细报告

> 文档版本：V1.0  
> 编制日期：2026-10-29  
> 核对范围：当前仓库代码、激活路由、数据库结构、Docker Compose 配置及本地运行状态  
> 项目目录：E:\EduClaw-arena  
> 当前代码基线：分支 feat/pi-harness-skill-run-test，提交 8627e1e  
> 安全说明：本文只记录环境变量名称和系统边界，不包含任何 API Key、密码、PAT、Client Secret 或其他真实凭据。

---

## 1. 执行摘要

EduSkill 是一个面向教育场景的 Skill 全生命周期建设与验证平台。平台将教师、教研员和教育产品团队原本分散在提示词、聊天记录、教学文档和个人经验中的方法，转化为可运行、可测试、可比较、可优化、可版本化和可交付的标准 Skill 数字资产。

从当前代码实现看，EduSkill 已经超出“通过自然语言生成 Skill”的单点工具范畴，形成了一个包含以下闭环能力的平台：

1. 通过引导对话、文档、结构化表单、音视频素材或 ZIP 包创建 Skill；
2. 在统一工作区中管理 Skill、对话、版本和运行记录；
3. 使用指定 Skill 版本执行真实教育任务；
4. 通过 Arena 对两个版本或“有 Skill / 无 Skill”结果进行对比；
5. 从一条具体回答反向诊断 Skill，生成修改草稿、Diff 和试运行结果；
6. 经人工确认后保存为新版本，并保留完整来源和历史记录；
7. 通过 ZITADEL、Kong 和独立 auth-service 提供统一身份认证及应用入口保护；
8. 通过 PostgreSQL、S3 兼容对象存储和 Python Media Worker 支撑持久化与多模态处理。

项目当前已经具备较完整的本地容器化运行能力。主应用、认证系统、数据库、对象存储、API、Web 前端以及媒体 Worker 均被纳入 Docker；主应用就绪检查能够确认数据库和对象存储状态。整体适合作为教育 Skill 研发平台、内部试验平台、教学能力资产化工具，以及后续面向学校或教育机构扩展的技术底座。

---

## 2. 项目背景与问题定义

生成式 AI 在教育场景中的常见障碍并不是模型完全无法回答，而是高质量方法难以稳定复用：

- 同类任务每次都要重新描述教学目标、学生对象、处理步骤和输出格式；
- 教师和教研人员的经验通常停留在个人文档或单次对话中，难以团队协作；
- 提示词修改缺少正式版本，无法准确知道某次结果由哪一版规则产生；
- 输出好坏缺少对比和评价依据，修改容易依赖主观感受；
- 单次回答出问题后，很难定位应该修改哪个 Skill、哪条规则；
- 视频、音频和课堂素材中包含大量隐性经验，但人工整理成本高；
- 用户、资源、模型调用、媒体处理和身份认证通常分散在多个系统中。

EduSkill 的核心思路是把“教育方法”当作长期维护的数字资产，而不是一次性提示词。平台围绕 Skill 建立创建、使用、测试、对比、诊断、优化、发布和回退的连续闭环。

~~~mermaid
flowchart LR
    A[经验 / 文档 / 音视频素材] --> B[创建 Skill]
    B --> C[校验与版本化]
    C --> D[真实任务运行]
    D --> E[固定版本测试]
    E --> F[Arena 对比]
    F --> G[回答级诊断]
    G --> H[修改草稿与 Diff]
    H --> I[试运行与质量门禁]
    I --> J[确认新版本]
    J --> D
~~~

---

## 3. 产品定位

### 3.1 一句话定位

EduSkill 是一个面向教育场景的 Skill 创建、运行、评测、优化和版本治理平台。

### 3.2 当前产品边界

当前平台的第一核心对象是 Skill，而不是通用聊天机器人、模型训练平台或传统知识库。系统可以调用大模型，但其主要价值不在提供一个通用问答页面，而在于把教育任务的工作方法固化为结构化、可审计的 Skill。

平台底层仍保留 Package 概念。Package 是存储、快照、导入导出和兼容边界，可以包含 agent.md、rubric.md 和一个或多个 skills/<dir-name>/SKILL.md；用户界面则已经演进为以 Skill 为中心的工作台。

### 3.3 核心价值

| 价值方向 | 平台体现 |
| --- | --- |
| 教育经验资产化 | 将教学目标、策略、边界、输入输出和评价标准固化为 Skill |
| 可复用 | 同一 Skill 可以用于多条任务对话和不同输入 |
| 可验证 | 支持固定版本运行、Arena 对比、评分报告和试运行 |
| 可治理 | Skill 与 Package 均具有版本、来源、备注、比较、回退和废弃机制 |
| 可追溯 | 回答保存实际使用的模型、上下文、Skill 及 Skill Version |
| 可协作 | 标准 Markdown、ZIP 导入导出和集中仓库便于交付与共享 |
| 可扩展 | 模型、对象存储、认证和媒体 Worker 均采用独立边界 |
| 多模态提炼 | 从视频和音频中生成转写、帧证据、候选知识和 Skill 草稿 |

---

## 4. 目标用户与适用场景

### 4.1 一线教师

适合需要重复完成备课、教案设计、课堂活动设计、分层教学、作业反馈、评价量表、学生答疑和学习支持的教师。教师不必直接编写复杂的系统提示词，可以通过引导式对话描述自己的目标、学生特征和教学经验。

典型场景：

- 将成熟的备课流程转化为可复用 Skill；
- 为不同年级或学习水平生成稳定格式的教学方案；
- 对同一教学问题比较两个 Skill 版本的效果；
- 从失败回答反向修改教学规则；
- 从课堂视频中提取教学行为、案例和反例。

### 4.2 教研员与课程设计人员

适合需要沉淀方法论、审核教学策略、维护课程标准和组织教师协作的教研团队。

典型场景：

- 把教研文档批量转换为 Skill；
- 用 Rubric 对生成内容进行结构化评估；
- 维护机构级 Skill 版本和变更记录；
- 通过 Arena 验证修改是否真正提升教学质量；
- 对候选知识进行人工审核后再发布。

### 4.3 教育产品与内容团队

适合教育产品经理、内容运营、课程研发和知识工程团队，用于建设面向特定学科、课程或任务的 AI 能力库。

典型场景：

- 建设标准化的教育 Skill 仓库；
- 将课程材料、培训视频和专家经验转换为产品能力；
- 管理生成内容的适用边界、风险提示和验收标准；
- 通过 ZIP 交付或迁移 Skill 资产。

### 4.4 AI 应用研发与测试人员

适合需要验证模型、提示策略、运行时和多模态链路的研发、算法和质量团队。

典型场景：

- 测试兼容 OpenAI 协议的不同模型服务；
- 对 baseline 与 enhanced 两侧进行结果对比；
- 验证版本绑定、流式响应、幂等、并发冲突和恢复机制；
- 测试视频转写、关键帧、视觉证据和候选生成链路；
- 建立端到端验收与回归样例。

### 4.5 学校、教育机构和平台管理员

适合需要统一登录、角色管理、私有化部署、资源隔离和服务运维的管理员。

典型场景：

- 使用 ZITADEL 管理用户、角色和登录；
- 通过 Kong 统一保护多个应用入口；
- 监控数据库、对象存储、API 和媒体 Worker；
- 配置模型、存储和认证环境变量；
- 逐步扩展 Worker 数量和计算资源。

### 4.6 企业与研究团队

除教育机构外，本项目也适合作为研究“经验如何转化为可运行智能体能力”的实验平台，尤其适用于需要版本证据、人工审核和多模态来源追踪的团队。

---

## 5. 已实现功能地图

### 5.1 Skill 创建

#### 引导式对话共创

- 用户从教学目标或精选教育场景开始；
- 平台通过多轮对话补全目标、对象、依据、策略、边界和效果证据；
- 前端提供教育场景选项、进度、轮次导航和确认页；
- 创建会话、消息、草稿、字段状态和修订号均持久化；
- 支持未完成创建会话的恢复；
- 用户确认后生成标准 Skill 内容并保存首个版本。

#### 文档生成 Skill

- 支持从 DOCX、Markdown、TXT、CSV、JSON、YAML 及常见文本或代码文件创建 Skill；
- 每份文档可独立生成一个 Skill；
- 支持批量文档任务和统一补充要求；
- 前端展示等待、处理中、成功和失败状态；
- 文档解析与生成过程不要求用户手写完整 Skill 结构。

#### 结构化完整填写

- 通过表单输入 Skill 名称、服务对象、使用场景、核心任务、输入、输出和规则；
- 支持添加教学材料和边界条件；
- 适合已经明确知道 Skill 内容的专业用户；
- 可先填写部分内容，再进入对话继续补全。

#### 多模态创建

- 支持以视频或音频作为主要来源；
- 支持单次上传与分片上传；
- 对媒体进行质量检查、音频提取、转写、关键帧和视觉信号处理；
- 生成带来源信息的证据卡和多类候选知识；
- 候选经过多阶段验证、人工选择和确认后形成 Skill 草稿；
- 发布过程保留操作回执、证据引用和版本来源。

#### ZIP 导入

- 支持导入标准 Package / Skill ZIP；
- 校验 Skill 文件、Package 结构和版本快照；
- 导入后的 Skill 进入统一仓库，可继续运行、测试、优化和导出。

### 5.2 Skill 仓库与工作区

- 统一展示已生成、已导入和创建中的 Skill；
- 支持搜索、打开、重命名、删除、批量删除、导入和导出；
- 左侧工作区管理常用 Skill 和对话；
- 每个 Skill 可以建立多条独立任务对话；
- 支持对话切换、重命名、删除和状态恢复；
- 右侧 Inspector 展示 Skill 详情、版本、运行信息和优化上下文；
- URL 状态与工作区状态联动，支持刷新后恢复主要视图；
- 主路径 / 与 /skills 均进入 Skill-first 工作台。

### 5.3 Skill 运行与测试

- 使用当前版本或指定 Skill Version 执行真实任务；
- 支持多轮对话、流式输出和推理内容展示；
- 回答记录绑定实际使用的 Skill Version；
- 运行失败可以重试，不覆盖已有对话；
- 支持异步运行状态和页面恢复；
- 支持重新使用历史版本执行原问题；
- 运行与测试共享执行基础，但分别表达“真实使用”和“固定条件验证”。

### 5.4 Arena 双侧对比

- 左右两侧可以选择不同 Skill Version；
- 一侧可以不加载 Skill，作为基础模型回答；
- 同一问题在两侧分别执行并流式展示；
- 保存每侧使用的 Skill、版本、模型和上下文；
- 支持生成维度评分、摘要、推荐侧和胜负结论；
- 任一侧回答都可以继续进入回答级优化；
- Arena 线程、变体、消息、运行和回答来源均有持久化结构。

### 5.5 回答级交互式优化

这是当前系统最具差异化的能力之一。系统不是只给出“回答不好”的评价，而是从具体回答追溯到对应 Skill 版本，并形成可审核的修改闭环。

~~~mermaid
flowchart LR
    A[选择一条回答] --> B[恢复问题、上下文、回答侧和版本]
    B --> C[生成问题诊断和改进建议]
    C --> D[定位目标 Skill]
    D --> E[生成修改草稿]
    E --> F[展示逐行 Diff]
    F --> G[用户继续调整]
    G --> H[多样本试运行]
    H --> I[质量门禁]
    I --> J[保存新版本]
    J --> K[用新版本重跑原任务]
~~~

具体能力包括：

- 从使用、测试或 Arena 的回答发起优化；
- 保留 answer side、message id、evidence version、工作版本等溯源信息；
- 支持单 Skill 与多 Skill 协同修改；
- 多 Skill 修改可以批量生成、依次确认并分别形成版本；
- 展示原始内容、建议内容和逐行差异；
- 支持通过自然语言继续调整草稿；
- 使用多个测试样本验证修改；
- 版本变化时支持 rebase，避免覆盖最新修改；
- 用户确认后才写入新版本；
- 优化任务支持恢复、取消、拒绝和重启。

### 5.6 Package 级优化与兼容能力

底层仍保留 Package 生成、预览、校验、完整更新、交互式优化、版本比较、回退和导出等能力。部分旧版 Agent、Profile、Sidebar 和事件接口已进入兼容或退役路径；新业务设计应优先使用 Skill-first API，而不是继续扩展旧接口。

### 5.7 版本管理

- Skill 版本具有连续版本号、来源、基础版本、内容哈希、状态和备注；
- 来源类型覆盖 generated、imported、optimized、manual、interactive 和 rollback；
- 支持预览历史版本；
- 支持当前版本与历史版本比较；
- 回退操作创建一个新版本，不覆盖旧历史；
- 非当前版本可以废弃和恢复；
- Package Version 保存完整 JSONB 快照；
- Package 与 Skill Version 通过关系表保持明确对应；
- 导出 ZIP 可用于交付、备份或迁移。

### 5.8 用户认证与管理

- 支持用户名和密码登录；
- 支持注册后创建 ZITADEL 用户并分配默认角色；
- 支持短信验证码发送、登录和注册接口；
- 支持获取当前用户信息和角色；
- 支持 access token、refresh token 和注销撤销；
- 前端根据角色识别管理员；
- 主工作区和管理页均受认证保护；
- Kong 在网关层验证 JWT，并向内部服务注入用户标识头。

### 5.9 平台基础能力

- PostgreSQL 业务持久化；
- S3 兼容对象存储及签名 URL；
- SSE / 流式模型响应；
- 请求 ID 与结构化日志；
- 幂等键与请求哈希；
- 数据库和对象存储就绪检查；
- HTTP drain、后台任务停止、等待空闲和强制关闭等优雅停机机制；
- 前后端共享多模态合同；
- Markdown、GFM、代码高亮、公式和富文本渲染；
- Docker Compose 一键组织基础设施和应用服务。

---

## 6. 核心业务流程

### 6.1 从经验到 Skill

1. 用户选择引导对话、文档、结构化填写、多模态或 ZIP 导入；
2. 平台提取目标、对象、场景、策略、输入输出、边界和证据；
3. 用户检查平台整理出的结构化内容；
4. 服务端调用配置的大模型生成标准 Skill；
5. 系统进行格式和业务约束校验；
6. 保存 Package、Skill 和首个 Skill Version；
7. Skill 出现在仓库并可立即运行。

### 6.2 从 Skill 到真实使用

1. 用户从仓库选择 Skill；
2. 新建一条任务对话；
3. 选择当前版本或指定历史版本；
4. 输入真实教育任务；
5. 服务端将 Skill、上下文和问题交给模型运行时；
6. 前端接收流式输出；
7. 对话和实际版本信息持久化，供后续比较和优化使用。

### 6.3 从问题回答到 Skill 改进

1. 用户在具体回答下选择优化；
2. 系统恢复问题、上下文、回答、模型和 Skill Version；
3. 用户选择系统建议或输入期望；
4. 平台定位需要修改的 Skill；
5. 生成修改草稿和 Diff；
6. 用户确认或继续自然语言调整；
7. 系统运行测试样本并给出质量结果；
8. 通过门禁且用户确认后创建新版本；
9. 使用新版本重新运行原任务，验证真实效果。

### 6.4 从音视频到 Skill

1. 用户选择或上传视频、音频；
2. 服务端生成上传意图和对象存储路径；
3. 文件完成后记录素材元数据和完整性信息；
4. 质量 Worker 使用 FFprobe、FFmpeg 和确定性规则检查素材；
5. 蒸馏 Worker 提取音频、执行 faster-whisper 转写并物化关键帧；
6. Node 控制面组织证据、候选抽取、视觉模型分析和多阶段验证；
7. 用户审核素材概览和候选知识；
8. 系统生成 RIA Skill 草稿和证据引用；
9. 用户确认发布，形成正式 Skill Version。

### 6.5 登录到受保护 API

1. 用户通过 app.localhost 或 auth.localhost 进入登录流程；
2. auth-frontend 调用 auth-backend；
3. auth-backend 与 ZITADEL 完成密码、短信或 OIDC 会话流程；
4. 客户端获得令牌并请求用户信息；
5. 对受保护 API 的请求经过 Kong；
6. Kong 插件验证签名、issuer、audience 和有效期；
7. Kong 清理外部伪造的身份头并注入可信 X-User-* 头；
8. educlaw-server 以 X-User-Id 作为资源所有权和数据隔离依据。

---

## 7. 总体技术架构

~~~mermaid
flowchart TB
    U[教师 / 教研员 / 管理员 / 研发测试]
    K[Kong API Gateway]
    AF[auth-frontend]
    AB[auth-backend]
    Z[ZITADEL + Login UI]
    ADB[(Auth PostgreSQL)]
    W[educlaw-web\nReact Skill-first 工作台]
    S[educlaw-server\nExpress API 与业务编排]
    SH[educlaw-shared\n多模态共享合同]
    OA[openagent\n消息与运行时边界]
    LLM[兼容 OpenAI 协议的模型服务]
    DB[(EduSkill PostgreSQL)]
    OS[(SeaweedFS S3 兼容对象存储)]
    QW[Media Quality Workers ×2]
    DW[Media Distillation Workers ×2]

    U --> K
    K --> AF
    K --> W
    AF --> AB
    AB --> Z
    Z --> ADB
    K --> S
    W --> S
    S --> DB
    S --> OS
    S --> LLM
    S --> SH
    S --> OA
    QW <--> S
    DW <--> S
    QW --> OS
    DW --> OS
~~~

### 7.1 分层说明

| 层级 | 模块 | 主要职责 |
| --- | --- | --- |
| 接入层 | Kong | 域名路由、JWT 校验、身份头注入、应用与认证服务反向代理 |
| 身份层 | auth-service、ZITADEL | 登录、注册、短信、OIDC、用户、角色和令牌管理 |
| 展示层 | educlaw-web | Skill-first 工作台、创建向导、运行、Arena、优化、版本和管理页 |
| API 与业务编排层 | educlaw-server | 路由、授权、领域服务、模型调用、版本事务、媒体作业调度 |
| 共享合同层 | educlaw-shared | 多模态对象、状态、枚举和严格解析规则 |
| Agent 运行边界 | openagent | 消息标准化、模型 transport 与 runtime 类型边界 |
| 异步计算层 | python/media_worker | 媒体探测、质量检查、转写、关键帧和蒸馏 |
| 数据层 | PostgreSQL | 用户资源、版本、会话、运行、优化和媒体作业状态 |
| 文件层 | SeaweedFS S3 | 音视频、帧、转写和其他不可变媒体对象 |
| 模型层 | 外部或私有模型网关 | 文本生成、评分、候选、验证、RIA 和视觉分析 |

---

## 8. 代码架构说明

### 8.1 根目录与 Monorepo

项目采用 pnpm workspace 管理 TypeScript 子项目，根 package.json 提供统一 build、lint、test、type check 和 security audit 命令。

| 目录 | 说明 |
| --- | --- |
| educlaw-web | React 前端应用 |
| educlaw-server | Express 后端与业务服务 |
| educlaw-shared | 跨端共享类型与多模态合同 |
| openagent | Agent 消息和运行时抽象 |
| python/media_worker | Python 媒体异步 Worker |
| auth-service | ZITADEL、Kong、认证前后端及独立数据库 |
| spikes/pi-core | Pi Agent Core 验证性实现 |
| docs | 产品、架构、设计、运维和实施文档 |
| scripts | 类型基线、Worker 测试和工程校验脚本 |

### 8.2 前端 educlaw-web

主要技术：React 19、TypeScript 5.9、Vite 7、Tailwind CSS 4、Zustand、React Router、AI SDK、BlockNote、React Markdown、KaTeX、Shiki 和 Vitest。

架构特点：

- App.tsx 只负责路由、认证门禁、全局主题和通知；
- 登录页、管理页和 Skill-first 工作台采用懒加载；
- SkillFirstWorkspace 是主容器，负责仓库、详情、运行、Arena、优化和创建流程的状态组合；
- components/skill-workspace 进一步按功能拆分运行区、版本区、Inspector、创建面板和多模态向导；
- Zustand 管理登录状态和部分跨组件状态；
- 前端通过流式接口呈现模型输出，并处理刷新恢复和临时状态；
- 对 Markdown、公式、代码和富文本结果提供专业渲染；
- 存在可访问性、视觉合同、URL 状态和工作区挂载等专项测试。

### 8.3 后端 educlaw-server

主要技术：Node.js、TypeScript、Express 5、PostgreSQL、AWS S3 SDK、Pi Agent Core / Pi AI、Pino、Multer、JWT、bcryptjs 和 Vitest。

后端由路由层和服务层组成：

- routes/packages.ts：Package 创建、导入、导出、版本、优化和删除；
- routes/skills.ts：Skill 仓库与 Skill 操作入口；
- routes/arena.ts：Arena 线程、消息、运行、报告与流式接口；
- routes/answer-skill-optimizations.ts：回答级优化任务；
- routes/actions.ts：创建流程和多模态等动作型 API；
- routes/compat.ts：旧接口兼容和明确退役响应；
- services 目录包含一百余个 TypeScript 服务文件，按版本、生成、运行、优化、多模态、存储、健康和关闭流程拆分。

后端启动过程会：

1. 配置 CORS、请求上下文、压缩和请求体限制；
2. 初始化数据库与对象存储健康服务；
3. 注册 livez、readyz、healthz；
4. 注册 /api 新接口与兼容接口；
5. 检查数据库连接；
6. 按开关启动多模态 pipeline runner；
7. 监听端口并处理 SIGTERM / SIGINT；
8. 关停时停止接收新请求、等待运行任务、终止剩余任务并关闭连接池。

### 8.4 educlaw-shared

当前共享模块重点是 multimodal-contract.ts。该文件不是简单 DTO 集合，而是多模态链路的严格领域合同，包含：

- 主来源类型、证据类型、声明类型和转写状态；
- 上传模式、媒体作业类型、作业状态和流水线阶段；
- 语义时刻、帧来源信号和质量降级；
- 多轮候选 pass、候选元数据和选择上限；
- V1 / V2 / V3 候选验证证明；
- RIA Skill 关系、证据引用和发布回执；
- 对持久化状态与公开状态的严格解析和交叉引用检查。

该设计降低了前端、Node 控制面和 Python Worker 对状态含义理解不一致的风险。

### 8.5 openagent

openagent 提供消息、类型、transport 和 runtime 边界，使业务代码不必直接耦合某一个模型 SDK 的内部表示。其价值包括：

- 统一用户、助手、工具和推理消息；
- 在前端 AI SDK 与后端 Agent Runtime 之间建立稳定边界；
- 为后续替换模型或运行时保留适配层；
- 减少业务模块重复处理模型消息格式。

### 8.6 Python Media Worker

媒体 Worker 使用 Python 3.11，核心模块包括：

- ffprobe_adapter：读取媒体容器、时长、编码和音轨信息；
- ffmpeg_adapter：执行音频提取、转码和帧处理；
- asr_adapter：使用 faster-whisper 进行语音识别；
- frame_materializer：按语义时刻和规则生成实际帧；
- frame_quality：对模糊、黑帧等质量信号进行检测；
- visual_signal_detector：发现视觉内容变化和关键线索；
- quality_check_executor：执行媒体质量作业；
- distillation_executor：执行转写、帧和证据物化；
- internal_client：通过内部 API 领取、心跳和完成作业；
- worker_main：轮询、退避、超时、身份和生命周期管理。

Worker 不直接连接业务数据库，而通过服务令牌访问 Node 控制面。这一边界有利于权限控制、作业租约和未来横向扩展。

### 8.7 auth-service

认证模块是独立容器栈，包括：

- ZITADEL：身份、用户、项目、角色、会话和 OIDC；
- zitadel-login：ZITADEL 登录 UI；
- auth-backend：密码、短信、注册、用户查询、角色分配和令牌交换；
- auth-frontend：登录、注册、导航和门户页面；
- Kong：统一网关和 JWT 验证；
- Auth PostgreSQL：ZITADEL 独立数据库；
- 自定义 oidc-jwt-auth 插件：验证 JWT 并注入可信身份头。

认证服务与主应用通过外部 Docker 网络 auth-service_internal-net 连接，保持两个 Compose 项目独立，同时允许 Kong 路由到 educlaw-web 和 educlaw-server。

---

## 9. 数据架构

### 9.1 当前实际业务表

本地数据库当前存在 19 张 public 表：

| 领域 | 表 | 作用 |
| --- | --- | --- |
| Package | agent_packages | Package 主记录和当前版本 |
| Package | agent_package_versions | Package JSONB 全量快照 |
| Skill | agent_package_skills | Package 内 Skill 身份和状态 |
| Skill | agent_skill_versions | 独立 Skill 版本、来源、哈希和状态 |
| 版本映射 | agent_package_version_skills | Package Version 与 Skill Version 对应关系 |
| 引导创建 | skill_guided_creation_sessions | 创建会话、草稿、确认和生成结果 |
| 引导创建 | skill_guided_creation_messages | 创建对话消息 |
| 幂等 | api_idempotency_keys | 幂等键、请求哈希和缓存响应 |
| Arena | arena_threads | Arena 或 Skill 对话线程 |
| Arena | arena_thread_variants | 左右侧 Skill 与版本绑定 |
| Arena | arena_messages | 对话内容和 reasoning content |
| Arena | arena_answer_runs | 问题与两侧答案的完整来源 |
| Arena | arena_runs | 运行过程和评分报告 |
| 回答优化 | answer_skill_optimization_runs | 回答级诊断、草稿、测试和保存状态 |
| 优化兼容 | optimization_runs | Package / 旧流程优化运行 |
| 交互优化 | interactive_optimization_sessions | 交互式优化消息、问题和采纳项 |
| 自动评测兼容 | auto_eval_specs | 历史自动评测规范 |
| 自动评测兼容 | auto_eval_runs | 历史自动评测运行 |
| 多模态 | skill_media_jobs | 媒体作业、租约、进度和结果 |

### 9.2 数据设计特点

- 业务主键使用 bigint / bigserial；
- 用户归属以 user_id 文本字段隔离；
- Package 快照、Skill 快照和复杂状态使用 JSONB；
- Skill Version 同时保存版本号、来源、基础版本、内容哈希和生命周期；
- 关键关系使用复合唯一约束和外键，避免跨 Package 误引用；
- 多处使用 check 约束限制状态组合；
- 幂等表防止重试造成重复版本或重复写入；
- Arena 和回答优化保存明确 provenance，保证历史结果不会随当前版本改变。

### 9.3 数据文档注意事项

仓库内部分历史数据库文档不能单独作为最终事实来源。当前数据库结构应以 db-schema.ts 和实际数据库为准。auto_eval_specs 与 auto_eval_runs 仍存在于当前 schema 和本地数据库中，但它们更接近历史兼容结构，不应据此推断当前主工作台仍暴露完整自动评测产品入口。

### 9.4 当前迁移方式

当前项目通过幂等的 create table if not exists、alter table 和约束补齐语句初始化或演进数据库。这种方式适合快速本地部署和持续兼容，但在正式多环境发布中，建议逐步引入带版本号、可审计、可回滚的迁移工具和迁移记录表。

---

## 10. 模型调用与 Agent 运行原理

### 10.1 模型配置

主服务使用以下环境变量接入模型，本文不记录真实值：

- LLM_BASE_URL：兼容 OpenAI 协议的服务地址；
- LLM_API_KEY：模型服务密钥；
- LLM_MODEL：默认模型；
- LLM_BASELINE_MODEL：Arena 基础侧模型；
- MULTIMODAL_ADLER_MODEL：多模态结构分析模型；
- MULTIMODAL_CANDIDATE_MODEL：候选提取模型；
- MULTIMODAL_VALIDATION_MODEL：候选验证模型；
- MULTIMODAL_RIA_MODEL：RIA Skill 生成模型；
- MULTIMODAL_VISION_MODEL：视觉理解模型。

不同角色可以使用同一个模型，也可以在部署环境中分别配置，以平衡质量、成本和吞吐量。

### 10.2 Skill Run

Skill Run 将选定 Skill Version 的标准内容、用户问题和历史上下文组合为模型运行输入。后端通过 Pi Agent Core / Pi AI 和 openagent 边界执行，并将文本与推理内容以流式事件发送给前端。运行记录保存实际使用版本，避免“当前 Skill 已更新导致历史回答无法解释”。

### 10.3 Arena

Arena 为同一问题构造两个明确的运行条件。两侧可以是不同 Skill Version，也可以将一侧设为空，形成“基础模型 vs Skill 增强”的实验。报告阶段再基于 Rubric 或评分维度形成对比结论。

### 10.4 生成与优化的质量控制

平台通过以下机制降低模型输出直接落库的风险：

- Skill Markdown 格式校验；
- 生成前和发布前的人工确认；
- 内容哈希与版本冲突检查；
- 草稿 Diff；
- 多样本试运行；
- 多模态候选 V1 / V2 / V3 验证；
- 证据 ID 和来源交叉校验；
- 幂等键和修订号；
- rebase 和并发冲突处理。

---

## 11. 多模态处理架构

### 11.1 设计原则

多模态链路采用“Node 控制面 + Python 计算面 + 对象存储”的分工：

- Node 控制面负责状态机、权限、作业租约、模型调用、证据组织和发布事务；
- Python Worker 负责 FFmpeg、FFprobe、ASR 和帧级确定性处理；
- 对象存储保存原始媒体和派生对象；
- PostgreSQL 保存元数据、作业状态和可恢复的业务状态。

### 11.2 当前媒体 Worker 拓扑

- 质量检查 Worker：2 个副本；
- 蒸馏 Worker：2 个副本；
- 每个 Worker 具有独立 identity；
- Worker 轮询内部 action 接口领取任务；
- 通过心跳续租，崩溃后任务可以回收；
- 支持最大时长、请求超时、空闲退避和执行模式隔离。

### 11.3 证据与候选

系统区分转写证据、帧证据和其他来源事实，并为每个证据保存来源、时间位置、素材引用和 provenance。候选按框架、原则、案例、反例、术语和融合结果等 pass 分类，再进行验证和人工选择。

这一设计的核心价值是：最终 Skill 不只是“模型看过视频后生成的文字”，而是可以追溯到具体素材、时间点、转写或帧的可审核结果。

### 11.4 性能与资源考虑

- 默认 faster-whisper 可使用 CPU int8，便于普通本地环境运行；
- 长视频的转写和关键帧会显著增加处理时间；
- ASR 模型首次启动可能需要下载或预热；
- 生产环境可以使用 GPU、独立 Worker 节点和更大的并发；
- 对象存储、数据库和 Worker 吞吐需要按素材规模共同评估；
- 当前 Compose 已具备横向增加 Worker 的基础，但仍需配套资源限制和监控。

---

## 12. 身份认证与安全架构

### 12.1 认证边界

ZITADEL 是身份事实来源，Kong 是受保护 API 的信任入口，auth-backend 是业务化登录和注册适配层，educlaw-server 不自行解析外部 JWT，而是读取 Kong 验证后注入的身份头。

### 12.2 Kong 插件行为

自定义 oidc-jwt-auth 插件会：

- 从 Authorization 或允许的请求位置提取令牌；
- 清除请求中原有的 X-User-Id、X-User-Username 和 X-User-Email；
- 校验 JWT 签名、issuer、audience 和时间；
- 将验证后的 subject 和用户信息注入内部请求；
- 按路由决定是否必须携带令牌。

### 12.3 主服务授权

educlaw-server 的 requireAuth 读取 X-User-Id，并将其用于 Package、Skill、Arena 和优化记录的所有权隔离。该模式简单高效，但前提是主服务不能被不可信客户端绕过 Kong 直接访问。

### 12.4 本地与生产差异

当前认证栈适合本地联调，生产化前应处理：

- ZITADEL 当前 TLS disabled，仅适合本地网关后的 HTTP 通信；
- Kong Admin 端口 8001 当前映射到宿主机，生产环境应关闭或限制；
- Compose 中存在便于本地运行的默认存储凭据，生产必须覆盖；
- Master Key、数据库密码、PAT、短信密钥和模型 Key 应进入专用 Secret 管理；
- 主 API 端口不应直接暴露到公网；
- 应为 app、auth 和 ZITADEL 配置正式 HTTPS、域名和可信反向代理；
- 应定期轮换密钥并保留认证审计日志。

---

## 13. Docker 部署拓扑

### 13.1 主应用 Compose

| 服务 | 作用 | 当前状态特征 |
| --- | --- | --- |
| educlaw-db | PostgreSQL 17 | 健康检查，持久卷 |
| educlaw-db-init | 初始化数据库 | 一次性任务，成功后退出 |
| educlaw-server | API 与业务编排 | readyz 健康检查，优雅停机 |
| educlaw-web | Nginx 承载 React 应用 | 反向代理 API 与认证 |
| educlaw-minio | SeaweedFS mini，S3 兼容 | 健康检查，媒体持久卷 |
| educlaw-minio-init | 存储初始化边界 | 一次性任务 |
| quality worker ×2 | 媒体质量检查 | 独立执行模式 |
| distillation worker ×2 | ASR 与媒体蒸馏 | 独立执行模式 |

说明：服务名称沿用 educlaw-minio，但当前镜像实际为 SeaweedFS 4.51 的 S3 兼容模式。

### 13.2 认证 Compose

| 服务 | 作用 |
| --- | --- |
| postgres | ZITADEL 独立数据库 |
| zitadel | 身份服务 |
| zitadel-login | 官方登录 UI |
| auth-backend | 认证业务 API |
| auth-frontend | 登录与注册页面 |
| kong | app.localhost、auth.localhost 等域名网关 |

### 13.3 网络关系

两个 Compose 项目通过外部网络 auth-service_internal-net 相连。主应用的 educlaw-web 和 educlaw-server 加入该网络，Kong 因此可以在不暴露内部端口的情况下访问它们。

### 13.4 数据持久化

- postgres-data：EduSkill 主数据库；
- minio-data：SeaweedFS 对象数据；
- auth-postgres-data：认证数据库；
- zitadel-bootstrap：ZITADEL 初始化结果和服务凭据文件。

---

## 14. 工程质量与测试

### 14.1 工程命令

根项目提供以下统一质量入口：

- pnpm build：依次构建 shared、openagent、server 和 web；
- pnpm check:types：执行前端类型增量基线检查；
- pnpm lint：检查前后端代码；
- pnpm test：运行脚本、后端、前端和 Python Worker 测试；
- pnpm check：组合类型、lint、test 和 build；
- pnpm security:audit：生产依赖安全审计。

### 14.2 测试范围

静态文件清点显示仓库具有约 181 个 TypeScript / JavaScript 测试文件，Python media_worker/tests 下有 14 个 Python 测试文件。测试覆盖的主题包括：

- Skill 版本、历史、并发和幂等；
- Package 生成、导入、优化和回退；
- Arena 运行、来源和报告；
- 回答级优化与 rebase；
- 工作区状态、URL 状态、恢复和可访问性；
- 多模态合同、状态机、证据、候选和发布；
- 媒体探测、FFmpeg、ASR、关键帧和质量检测；
- 健康检查、优雅停机和对象存储；
- 类型基线与验证脚本。

上述为测试文件数量和测试主题，不等同于代码覆盖率。正式发布仍应输出实际 coverage、端到端通过率和关键场景验收记录。

### 14.3 可观测性

当前已有：

- Pino 结构化日志；
- x-request-id / 请求上下文；
- livez、readyz 和 healthz；
- 数据库与对象存储分项健康状态；
- Worker identity、心跳、租约和执行状态；
- 多模态进度、降级和失败状态；
- 优雅停机过程日志。

后续建议补充 Prometheus 指标、OpenTelemetry Trace、队列延迟、模型 token / 成本、作业失败率和业务转化指标。

---

## 15. 当前本地部署状态

### 15.1 核对时间

2026-10-29，本报告编制期间对当前本地环境进行了只读检查。

### 15.2 主应用状态

- EduSkill PostgreSQL：运行中且 healthy；
- EduSkill Server：运行中且 healthy；
- SeaweedFS S3：运行中且 healthy；
- EduSkill Web：运行中；
- 质量 Worker：2 个运行中；
- 蒸馏 Worker：2 个运行中；
- 主应用根地址 http://app.localhost/ 抽检返回 HTTP 200；
- /readyz 返回 ready；
- readyz 的 database 与 objectStorage 均为 ok。

### 15.3 认证状态

- Kong：运行中且 healthy；
- Auth PostgreSQL：运行中且 healthy；
- ZITADEL：运行中且 healthy；
- ZITADEL Login：运行中且 healthy；
- auth-backend 与 auth-frontend：运行中；
- 前序部署验收中已完成 SSO 登录进入 EduSkill 工作区；
- 本次报告编制时，对 http://auth.localhost/login 的一次独立 HTTP 抽检出现 502，随后一次客户端网络检查受本地代理连接异常影响而无法复核。

因此，认证容器当前并非整体宕机，但在下一次交付验收前应执行一次完整登录回归，并重点检查 Kong 到 auth-frontend / ZITADEL Login 的上游路由、容器 DNS 和启动顺序。

### 15.4 工作区状态

当前仓库存在尚未提交的 Docker、认证和环境模板相关改动，包括新增 auth-service 目录。本文没有修改业务逻辑，也没有覆盖、重置或清理这些部署改动。

---

## 16. 技术优势

### 16.1 不是一次性生成，而是完整生命周期

从创建到使用、比较、诊断、修改、测试和版本保存形成闭环，明显优于只生成一个 Markdown 文件的工具。

### 16.2 回答与版本强关联

历史回答保存实际使用的 Skill Version、模型和上下文，使结果可解释、可复现，适合教育质量审查和实验分析。

### 16.3 人工审核位于关键门禁

系统在生成确认、候选选择、草稿 Diff 和正式发布等关键位置保留人类决策，不让模型输出无条件进入正式资产。

### 16.4 多模态结果具有证据链

转写、帧、候选和最终 Skill 之间存在明确引用关系，便于审核“这条规则来自哪里”。

### 16.5 版本模型较成熟

Package 快照和 Skill 独立版本同时存在，支持历史比较、内容哈希、来源、回退、废弃和恢复。

### 16.6 服务边界清晰

Web、API、认证、数据库、对象存储、模型和媒体 Worker 均可独立部署和扩展。

### 16.7 对失败和恢复有系统性考虑

项目包含幂等、修订号、租约、心跳、重试、rebase、页面恢复、就绪检查和优雅停机，不只是理想路径实现。

---

## 17. 当前限制与风险

### 17.1 认证入口存在待回归项

认证容器健康，但报告编制时曾出现 auth.localhost/login 502。需要通过端到端登录测试确认是瞬时上游、代理环境还是路由配置问题。

### 17.2 网关信任边界必须严格保持

educlaw-server 信任 Kong 注入的 X-User-Id。如果生产环境直接暴露 Server 端口，客户端可能绕过 JWT 验证伪造身份头。生产部署必须保证 API 只接受来自可信网关或内部网络的流量。

### 17.3 本地默认值不能直接用于生产

对象存储默认账号、TLS disabled、Kong Admin 端口等都为本地便利设置。生产必须显式覆盖并进行安全收口。

### 17.4 数据迁移缺少正式版本管理

当前 schema 通过代码内幂等 SQL 演进，随着表和约束继续增加，排查多环境差异的成本会上升。

### 17.5 新旧模型并存带来理解成本

系统同时存在 Package、Skill、旧 Agent / Profile 兼容接口和部分历史自动评测表。需要持续明确“主路径、兼容路径、已退役路径”，避免新功能误接旧接口。

### 17.6 多模态计算成本高

长视频、ASR、关键帧和视觉模型调用会消耗较多 CPU、GPU、存储和模型预算。需要限额、队列指标、取消机制和成本统计。

### 17.7 质量评价仍需要业务基准

已有 Arena、Rubric 和质量门禁，但教育效果最终需要真实教师评审、学科基准集和长期用户反馈，不能只依赖模型自评。

### 17.8 缺少正式覆盖率与生产 SLO

测试文件较多，但当前报告未取得统一覆盖率、性能基准、并发上限和服务等级目标。

### 17.9 环境变量较多

模型、认证、存储和 Worker 使用多组配置。缺少校验时，可能在启动后较晚阶段才暴露错误。建议增加启动前环境诊断和配置分组文档。

---

## 18. 建议的后续演进路线

### P0：部署与安全收口

1. 完成 auth.localhost、app.localhost 的完整登录回归；
2. 增加登录、/auth/me、受保护 /api 和注销的自动烟测；
3. 正式环境关闭 Kong Admin 公网映射；
4. 使用 HTTPS、正式域名和 Secret 管理；
5. 限制 educlaw-server 只接受网关或内部网络访问；
6. 为所有关键环境变量增加启动时校验，错误信息只显示变量名不显示值；
7. 为数据库和对象存储建立备份与恢复演练。

### P1：工程治理

1. 引入版本化数据库迁移工具；
2. 维护“激活、兼容、退役”API 清单；
3. 输出测试覆盖率和关键流程端到端报告；
4. 增加 Prometheus / OpenTelemetry；
5. 记录模型调用耗时、token、成本和失败类型；
6. 为媒体队列增加等待时间、租约回收和吞吐仪表盘；
7. 固化一键验收脚本和发布检查表。

### P2：产品与教育质量

1. 建立按学科、学段和任务分类的 Skill 模板库；
2. 建设真实教师评审集和标准 Rubric；
3. 增加团队级共享、审核、发布和权限；
4. 提供 Skill 使用效果、失败原因和版本胜率分析；
5. 将 Arena 结果转化为可持续回归的测试集；
6. 增加敏感内容、未成年人数据和版权材料的审核策略。

### P3：规模化与生态

1. 将媒体 Worker 部署到独立 CPU / GPU 节点；
2. 评估更专业的队列和任务调度系统；
3. 支持多租户配额、计费和组织级资产；
4. 建设 Skill Marketplace 或机构内部发布中心；
5. 提供稳定 SDK、CLI 和外部系统集成接口；
6. 支持更多模型厂商和模型路由策略；
7. 形成教育 Skill 标准、评测基准和资产治理规范。

---

## 19. 项目适用性结论

### 适合

- 教育机构内部建设和验证 AI Skill；
- 教师经验、教研文档和课程视频的结构化沉淀；
- 需要明确版本、证据和人工审核的 AI 能力生产；
- 模型、Prompt / Skill 和多模态流水线的研发测试；
- 私有化或内网部署的教育 AI 平台原型与中台。

### 当前不应直接假设已满足

- 未经安全加固即可公网生产运行；
- 已具备大规模多租户 SaaS 的配额、计费和组织治理；
- 已通过教育效果的长期实证验证；
- 已具备完善的生产 SLO、全链路监控和灾备；
- 所有历史兼容模块都属于当前产品主功能。

总体判断：项目已经具备较强的产品完整度和技术深度，尤其在 Skill 版本治理、回答级优化和多模态证据链方面具有明显特色。下一阶段的重点不应只是继续增加功能，而应优先完成认证稳定性、安全收口、正式迁移、端到端验收和教育质量基准建设。

---

## 20. 术语表

| 术语 | 含义 |
| --- | --- |
| Skill | 可复用的教育任务能力单元，主要以标准 SKILL.md 表达 |
| Package | Skill 的底层存储、快照、导入导出和兼容容器 |
| Skill Version | 某一 Skill 的不可变历史版本 |
| Package Version | 某一时点 Package 的完整快照 |
| Arena | 对两个版本或两种运行条件进行同题对比的空间 |
| Baseline | 未增强或基础对照侧 |
| Enhanced | 使用 Skill 或增强配置的实验侧 |
| Provenance | 回答、证据或版本的来源和使用上下文 |
| Evidence | 从素材中提取、可定位和可引用的证据单元 |
| Candidate | 从证据中提炼、尚待验证和选择的候选知识 |
| RIA | 平台用于把候选知识组织为 Skill 草稿的结构化生成阶段 |
| Quality Gate | 保存或发布前必须通过的质量检查 |
| Rebase | 当前版本变化后，将优化草稿重新应用到最新版本 |
| Lease | Worker 对异步作业的限时领取权，可通过心跳续租 |
| S3 Compatible | 与 Amazon S3 API 兼容的对象存储接口 |
| OIDC | OpenID Connect，认证和用户身份协议 |

---

## 21. 主要事实来源

本报告以以下实际代码和配置为主要依据：

- README.md
- docs/EDUSKILL_PLATFORM_OVERVIEW.md
- docs/current-chat-architecture.md
- docs/2026-08-23-multimodal-skill-pack-operations-runbook.md
- docs/2026-08-20-multimodal-skill-pack-implementation-spec-feishu-v2.md
- package.json 及各子项目 package.json
- educlaw-web/src/App.tsx
- educlaw-web/src/pages/SkillFirstWorkspace.tsx
- educlaw-web/src/components/skill-workspace/
- educlaw-server/src/index.ts
- educlaw-server/src/routes/
- educlaw-server/src/services/db-schema.ts
- educlaw-server/src/services/
- educlaw-shared/src/multimodal-contract.ts
- openagent/src/
- python/media_worker/
- docker-compose.yml
- auth-service/docker-compose.yml
- auth-service/kong/kong.yml
- auth-service/auth-backend/src/
- 本地 Docker 容器状态、readyz 响应和实际数据库表清单

身份系统的本地部署方式同时参考了项目提供的认证服务资料与 ZITADEL 部署说明。本文将外部资料中的操作说明仅作为部署参考，最终项目事实仍以当前仓库配置和实际运行结果为准。

---

## 22. 文档维护建议

每次发生以下变化时应同步更新本报告：

- 主工作区新增或移除用户功能；
- 路由从兼容状态转为正式激活或退役；
- 数据表、状态机或版本规则变化；
- 认证网关、域名、角色或登录流程变化；
- Docker 服务、网络、端口或持久卷变化；
- 多模态 Worker、模型角色或对象存储变化；
- 测试覆盖率、生产 SLO 或安全策略建立；
- 完成正式生产部署或教育效果验收。
