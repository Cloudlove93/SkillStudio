# EduSkill 多模态 Skill Pack 功能实现规范书

> **历史版本，不得作为 Codex 实施依据。** 本文件已由 `2026-08-20-multimodal-skill-pack-implementation-spec-feishu-v2.md` 取代；多模态 Skill Pack 的范围、数据库约束、对象永久保留、音频 M1 和 Python Worker 横向扩展均以 V2 为准。

> 文档状态：待产品与工程审核  
> 当前约束：**本文档未审核通过前，不编码、不建表、不提交、不推送。**  
> 第一阶段目标：先完成“单个视频 → 可追溯证据 → 单个 Skill → 测试 → 发布 → Arena 验证”的最小闭环。

| 文档信息 | 内容 |
|---|---|
| 适用项目 | EduSkill |
| 面向人员 | 产品、架构、后端、前端、算法、测试、运维 |
| 设计原则 | 复用现有 Package、Skill Version、Package Version 和 Arena，不另建发布体系 |
| 接口原则 | 沿用现有 `POST /api` 和点分 action，不修改现有 action 名称和请求结构 |
| 数据原则 | PostgreSQL 保存业务状态，MinIO/S3 保存实际文件，已发布历史不可覆盖 |

## 1. 一页说明

### 1.1 要解决什么问题

EduSkill 增加“素材蒸馏”入口。用户提交教学视频后，系统提取转录、时间戳和关键帧等证据，经用户确认后生成 Skill，完成测试并发布到现有 Package 与 Arena。

### 1.2 五个核心概念

| 概念 | 通俗解释 | 用户看到什么 |
|---|---|---|
| Skill Pack | 一次素材蒸馏工作的容器；后续可包含多个 Skill | 一个有名称、素材、进度、审核状态和发布记录的任务 |
| Skill | 可独立触发和执行的一组教学方法或规则 | 可编辑的 Skill 内容、适用范围、步骤和边界 |
| 素材 Asset | 用户上传或系统派生的文件 | 原视频、转录、关键帧；不展示对象键等技术信息 |
| 证据 Evidence | 从素材中提取、能定位回原材料的内容 | 视频时间点、转录片段、关键帧、来源类型和置信度 |
| 版本 Version | 发布时固定下来的不可变快照 | Package/Skill 历史、对应素材和证据，可复查、可回退 |

### 1.3 用户完整流程

| 步骤 | 用户操作与界面 | 系统行为 |
|---:|---|---|
| 1. 创建 | 新建“素材蒸馏”任务 | 创建 Pack 草稿并持久化 |
| 2. 上传 | 上传本地视频或填写直接视频 URL | 校验权限、格式、大小和远程地址安全 |
| 3. 解析 | 查看进度，可刷新或离开页面 | Worker 转码、提取音频、转录、抽帧；状态写入 PostgreSQL |
| 4. Overview 确认 | 查看摘要、证据缺口和不确定项 | 保存用户确认记录后才进入候选生成 |
| 5. 候选 Skill 确认 | 查看、编辑、接受或拒绝主要候选 | 生成 Skill 草稿并固定证据引用 |
| 6. 测试 | 查看触发、禁触发、执行质量和证据引用结果 | 使用固定输入、模型、Prompt 和资产运行测试 |
| 7. 发布确认 | 最终检查 Skill、测试结果和资产清单 | 原子创建 Package Version、Skill Version 和引用关系 |
| 8. Arena 验证 | 在现有 Arena 中运行和复查 | 使用发布时固定的版本、资产和证据 |
| 9. 失败重试/继续 | 查看明确失败原因，选择重试或继续 | 从最近有效检查点恢复，不依赖浏览器临时状态 |
| 10. 取消/删除 | 取消处理中任务或删除草稿 | 停止新任务、逻辑删除；已发布历史引用继续保留 |

**恢复要求：**处理过程中刷新页面、重新登录、关闭浏览器或换设备后，用户仍能从 Pack 详情恢复进度。前端不得作为任务状态的唯一来源。

### 1.4 三个人工确认点

| 确认点 | 用户确认内容 | 未确认时 |
|---|---|---|
| Overview | 视频主旨、结构、关键内容、证据缺口和不确定项 | 不生成候选 Skill |
| 候选 Skill | Skill 名称、规则、步骤、适用范围、边界和证据 | 不进入正式测试 |
| 发布 | Skill 最终内容、测试结果、版本资产和风险提示 | 不创建发布版本 |

## 2. 分阶段范围

| 阶段 | 包含 | 不包含 | 验收标准 | 回退方式 |
|---|---|---|---|---|
| M1 | 单个本地视频或直接视频 URL；转录、抽帧、证据确认；一个主要 Skill；测试、发布和 Arena | YouTube/B站/抖音页面；登录、付费墙、DRM；多 Skill；PDF/DOCX/图片/OCR 正式支持 | 一段中文教学视频从上传到 Arena 全链路成功，历史版本可复查 | 功能开关关闭；新表保留但不参与旧流程；删除未发布草稿 |
| M2 | 一个 Pack 多个 Skill；关系编排；Pack 路由、禁触发和兄弟 Skill 混淆测试 | 新文档类型 | 多 Skill 能固定版本发布并正确路由 | 回退到 M1 单 Skill 展示和运行路径 |
| M3 | PDF、DOCX、Markdown、图片、独立音频、OCR、页码和区域证据 | 高级语义检索 | 每种素材均有可定位证据和对应错误处理 | 按素材类型关闭入口，不影响视频链路 |
| M4 | 运行时证据增强、多 Skill 组合、可选 pgvector | 另建发布体系 | 在固定版本上证明检索质量和成本可接受 | 回退到关键词、标签和关系选择 |

### 2.1 M1 输入边界

| 支持 | 不支持 |
|---|---|
| 本地视频上传 | YouTube、B站、抖音等网页解析 |
| HTTP(S) 地址直接返回视频文件 | 需要 Cookie、登录、会员或付费墙的地址 |
| 用户有权使用的教学视频 | DRM、版权保护绕过或第三方平台限制绕过 |
| 无 GPU 的本地降级处理 | 把生产模型和硬件规格写死在代码中 |

## 3. 异常场景与用户呈现

| 场景 | 服务端处理 | 用户看到的内容 |
|---|---|---|
| 未添加素材 | 禁止启动处理 | “请先上传或添加一个视频” |
| 重复素材 | 可信 SHA-256 相同则提示重复，可复用已验证文件 | “该视频已添加”，不创建重复任务 |
| 损坏文件 | 真实文件签名或媒体探测失败 | “视频损坏或格式不受支持”，允许替换 |
| 超大文件 | 上传申请和服务端读取均拒绝 | 展示大小上限，不开始处理 |
| URL 返回网页 | 拒绝 HTML 或非视频响应 | “该地址不是可直接下载的视频文件” |
| 视频无音轨 | 跳过 Whisper，保留关键帧路径 | “未检测到音频，将仅分析画面” |
| 识别不到内容 | 保留处理记录，不自动生成空 Skill | “未提取到足够内容”，允许补充或取消 |
| 处理超时 | 任务进入可重试失败，释放租约 | 展示失败阶段和“重试”按钮 |
| 部分成功 | 保存成功产物，标记缺失项和降级路径 | 展示“部分完成”及具体缺失内容 |
| AI 空响应/无效 JSON | 有限修复一次；仍失败则停止当前阶段 | 展示可重试错误，不伪造结果 |
| AI 限流/token 用尽 | 根据错误类型退避或停止 | 展示“服务繁忙”或“输入过长”，给出下一步 |
| 浏览器关闭/重新登录 | 状态和检查点继续保存在后端 | 返回页面后继续显示真实进度 |
| 处理期间删除 | 事务标记取消，Worker 后续回写被拒绝 | 显示已取消，不出现“复活”任务 |

## 4. MinIO 与文件存储

MinIO 可以理解为 EduSkill 的“大文件仓库”。它保存视频、音频、图片、DOCX、关键帧等实际文件。

**MinIO 不是业务数据库，也不是 AI。** 它不会判断文件属于谁、任务到哪一步，也不会生成 Skill。

| 存储位置 | 保存内容 | 示例 |
|---|---|---|
| PostgreSQL | 名称、用户归属、状态、版本、证据位置、文件哈希和关系 | “视频属于用户 A”“Skill Version 3 引用了关键帧 8” |
| MinIO/S3 | 实际二进制文件 | 原始视频、音频、关键帧、图片、DOCX |

### 4.1 为什么不放数据库或项目目录

- 大视频会使数据库备份、恢复和迁移变慢；数据库更适合结构化查询。
- 对象存储更适合大文件上传、下载、生命周期和容量扩展。
- 项目本地目录无法在多台服务器间可靠共享，容器重建还可能丢失文件。

### 4.2 各环境方案

| 环境 | 方案 |
|---|---|
| 本地 Docker | MinIO |
| 自动化测试 | 临时本地存储或内存 Fake，测试结束自动清理 |
| 生产 | 部署方可选择 MinIO、阿里云 OSS、腾讯云 COS、AWS S3 等 S3 兼容存储 |

普通用户不会直接操作 MinIO，前端只展示上传、进度、证据和结果。

## 5. 架构与职责边界

| 组件 | 主要职责 | 明确禁止 |
|---|---|---|
| React 前端 | 上传、进度、人工确认、Skill 编辑、测试和发布 | 不作为状态事实来源；不直接判断对象权限 |
| TypeScript 服务 | 登录态、授权、状态机、任务编排、AI 调用、发布事务和审计 | 不把大文件写进 PostgreSQL |
| PostgreSQL | Pack、运行、任务、证据、版本、幂等和审计 | 不保存视频和关键帧正文 |
| Python Worker | 转码、抽帧、音频提取、Whisper、后续 OCR | 不创建 Package/Skill；不决定发布；不持有无限制业务数据库账号 |
| MinIO/S3 | 原文件和派生文件 | 不承担业务权限、状态和版本逻辑 |
| 现有模型网关 | 文本/视觉 AI 调用、超时、日志脱敏 | 不把模型名称和参数写死在业务流程中 |
| 现有版本/Arena | 发布、历史、运行和评估 | 不读取最新素材替代历史版本资产 |

### 5.1 Worker 通信与租约

Worker 通过带内部令牌的内部 action 领取、续租和回写任务：

```text
Worker → POST /api 领取任务
Worker → 短期签名地址读取文件
Worker → 处理并上传派生文件
Worker → POST /api 回写 manifest
TypeScript 服务 → 校验租约、manifest 和归属后写业务表
```

| 规则 | 要求 |
|---|---|
| 最小权限 | 内部令牌只能操作媒体任务，不能发布、查询用户数据或修改 Package |
| 轮换 | 支持当前令牌和下一令牌短期并存，完成无停机轮换 |
| 原子领取 | PostgreSQL 使用 `FOR UPDATE SKIP LOCKED` 或等价机制 |
| 心跳 | 只有当前 `lease_owner` 且租约未过期时可以续租 |
| 超时回收 | 租约过期后可由其他 Worker 领取 |
| 重试 | 配置最大次数与指数退避；超限进入终止失败 |
| 幂等回写 | job attempt、产物哈希和唯一约束共同防止重复消费生成重复结果 |
| 分表 | `skill_pack_runs` 表示业务流程；`skill_pack_media_jobs` 表示 Worker 任务租约 |

## 6. 文件完整链路与安全

| 阶段 | 必须执行的规则 | 结果 |
|---|---|---|
| 上传申请 | 校验登录态、Pack 状态、文件名、扩展名、声明 MIME、大小和数量 | 返回 `uploadId`、临时对象键、短期上传地址 |
| 受控上传 | 只能写入服务端指定的隔离对象键 | 文件尚不是可信 Asset |
| 上传确认 | 校验对象存在、大小、声明类型、用户和 Pack 归属 | 创建待验证媒体任务 |
| 服务端复核 | 读取文件签名和实际字节，识别真实 MIME，流式计算 SHA-256 | 生成可信哈希和不可变正式对象 |
| Worker 读取 | 使用短期签名，只能读取任务指定对象 | 不暴露长期存储凭证 |
| 媒体处理 | 转码、抽音频、转录和抽帧 | 产生派生文件和 manifest |
| 产物回写 | 校验 Worker、job、attempt、lease、大小、MIME 和哈希 | 保存可信派生 Asset |
| 证据入库 | frame ID、时间范围、Asset、manifest 和 Pack 归属一致 | 创建 Evidence |
| 版本发布 | 在事务中固定 Asset Manifest 和 Evidence Link | 历史版本不随素材变化 |

### 6.1 文件校验规则

| 项目 | 要求 |
|---|---|
| 文件名 | 保存用户展示名与安全名；拒绝路径分隔符、控制字符和超长名称 |
| 扩展名 | 仅作辅助判断，不作为真实类型依据 |
| MIME | 同时检查声明值和实际文件签名，不匹配时拒绝或进入隔离 |
| 大小 | 上传申请、上传确认和 Worker 读取三处校验 |
| 数量 | M1 每个 Pack 只允许一个活动原视频；替换需明确操作 |
| SHA-256 | 客户端 hash 仅作提示；受信服务必须读取实际内容重新计算 |
| S3 ETag | 不能当作 SHA-256，特别是分片上传 |
| 对象键 | 由服务端生成；先使用隔离 key，验证后按可信 SHA-256 固定 |
| 签名 URL | 短期有效，不写数据库、Snapshot、完整日志或错误信息 |

### 6.2 远程 URL 与 SSRF

M1 只接受直接返回视频文件的 HTTP(S) URL：

- 限制为 `http`/`https`，拒绝 URL 用户名、密码和危险协议。
- DNS 结果不得指向回环、私网、链路本地、云元数据地址或受保护网段。
- 建立连接时固定已校验地址，降低 DNS 重绑定风险。
- 每次 3xx 重定向都重新解析和校验，限制重定向次数。
- 限制连接、读取、总时长和最大下载字节数。
- 拒绝 HTML 页面和不允许的真实 MIME。
- 不携带用户 Cookie，不绕过登录、付费墙、DRM 或第三方平台限制。

### 6.3 保留、删除、GC、备份

| 文件类别 | 删除规则 | 备份/恢复要求 |
|---|---|---|
| 未发布原文件 | 逻辑删除后进入宽限期；无引用才物理清理 | 由部署方确定是否进入常规备份 |
| 派生文件 | 随原文件引用和运行检查点保留；孤儿文件由 GC 清理 | 可按可重建程度设置不同备份等级 |
| 发布版本引用文件 | 素材替换或 Pack 删除后仍保留 | 必须与数据库版本记录一致恢复 |
| 孤儿对象 | 上传失败、事务回滚或超时产生；按 `uploadId`/对象键扫描 | GC 删除前再次检查数据库引用并记录审计 |

生产恢复演练必须同时恢复 PostgreSQL 和对象存储；只恢复其中一个不能算完整恢复。

## 7. 与现有 EduSkill 的兼容

当前代码已经使用 `POST /api` action map、`agent_packages`、`agent_package_versions`、`agent_package_skills`、`agent_skill_versions`、`agent_package_version_skills` 和固定版本 Arena。本方案只扩展这些能力。

| 当前实现 | 结论与兼容方案 |
|---|---|
| `POST /api` + 点分 action | 继续使用；新增 action，不破坏性重命名旧 action |
| 成功响应 `{ success: true, data }` | 新 action 沿用 |
| 错误响应 `{ code, message, ... }` | 新 action 使用稳定错误码 |
| 当前通用解析要求 `pkgId` | Pack 创建前没有 Package；新增 Pack 专用解析，不修改旧 action 校验 |
| `api_idempotency_keys.package_id` 必填 | 不能原样用于 Pack 创建；新增 Pack 级幂等记录 |
| `PackageSkill` 只有 `skillMd` | 向后兼容增加可选资产清单；旧 Snapshot 按空数组读取 |
| source 不包含 `distilled` | TypeScript union 和数据库 check 同步新增该稳定值 |
| Package 删除目前为物理删除 | Pack 与已发布资产的删除影响需在实现前定义并加入保护，不能静默删历史文件 |
| Arena 固定 Package/Skill Version | 继续沿用，并增加版本固定 Evidence/Asset |
| 登录态目前由网关注入用户头 | 保持现有登录体系；网关必须清除外部伪造同名头 |
| 没有可信管理员角色 | M1 不提供强制发布或绕过硬门禁 |

### 7.1 Pack、Package 与版本规则

- 一个已发布 Skill Pack 一对一绑定一个现有 Agent Package。
- `skill_packs.agent_package_id` 使用非空条件唯一索引。
- M1 一个 Pack 包含一个主要 Skill；M2 允许多个成员 Skill。
- 每次发布创建新 Package Version；内容或资产变化时创建新 Skill Version。
- Skill Version 固定素材清单、证据、Prompt、模型参数和生成器版本。
- 已发布版本不能因替换或删除素材而改变。
- 回退通过前向创建新版本并记录 `based_on_version_id`，不覆盖旧版本。
- Package Version、Skill Version、Pack 成员、资产和证据绑定在同一事务中提交。

### 7.2 改动归属

| 层级 | 必须改动 |
|---|---|
| 前端 | 新入口、上传/进度、三个确认页、失败/重试、证据预览、发布状态 |
| TypeScript 后端 | action、权限、状态机、对象存储、幂等、AI 编排、发布事务、审计 |
| 共享类型 | Pack、Asset、Evidence、可选 Skill Asset Manifest、`distilled` |
| PostgreSQL | 新表、约束、索引和迁移补丁 |
| Python Worker | 视频探测、转码、音频、Whisper、抽帧和 manifest |
| Docker/运维 | MinIO、Worker、健康检查、环境变量、容量和备份 |

## 8. 服务端状态机

| 状态 | 含义 | 允许转换 |
|---|---|---|
| `draft_sources` | 编辑素材 | `processing_sources`、`cancelled`、`deleted` |
| `processing_sources` | 媒体处理中 | `overview_review`、`failed`、`cancelled` |
| `overview_review` | 等待 Overview 确认 | `generating_candidates`、`processing_sources`、`cancelled` |
| `generating_candidates` | 生成主要候选 | `candidate_review`、`failed` |
| `candidate_review` | 等待候选确认 | `generating_skill`、`cancelled` |
| `generating_skill` | 生成 Skill 草稿 | `testing`、`failed` |
| `testing` | 运行发布前测试 | `publish_review`、`failed` |
| `publish_review` | 等待发布确认 | `publishing`、`generating_skill`、`cancelled` |
| `publishing` | 原子发布中 | `published`、`publish_review` |
| `published` | 已发布 | 新编辑产生新的流程运行 |
| `failed` | 当前阶段失败 | 重试原阶段、返回可编辑阶段、`cancelled` |
| `cancelled` | 已取消 | 按策略恢复或删除 |
| `deleted` | 逻辑删除 | 管理范围内恢复或等待 GC |

所有转换由后端状态机校验。前端只能请求 action，不能传入任意目标状态。

### 8.1 并发冲突

| 冲突 | 处理 |
|---|---|
| 多标签页同时编辑 | Mutation 带 `expectedRevisionNo`；旧 revision 返回 409 并刷新 |
| 重复点击开始/发布 | 按钮防重 + 幂等键 + 数据库唯一约束 |
| Worker 重复回调 | job/attempt/lease/产物哈希校验；已完成回调安全重放 |
| 处理期间删除 | 取消 job；后续回写不再推进 Pack 状态 |
| Package 当前版本变化 | 发布检查 `expectedPackageVersionId`，冲突时不自动覆盖 |
| 发布中任一步失败 | 整体回滚，不留下半成品版本；Pack 返回发布审核状态 |

## 9. 数据库设计

字段统一使用 `snake_case`。时间字段使用 `timestamptz`，JSON 使用 `jsonb`。

### 9.1 `skill_packs`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | Pack ID | PK |
| `user_id` | `text` | 必填 | 所属用户 | 索引 `(user_id, updated_at desc)` |
| `title` | `text` | 必填 | 用户可见名称 | 非空长度校验在服务层 |
| `status` | `text` | 必填 | 当前状态 | check 状态枚举；索引 |
| `revision_no` | `integer` | 默认 0 | 乐观并发版本 | `>= 0` |
| `current_run_id` | `bigint` | 可空 | 当前业务运行 | 组合 FK，见 9.11 |
| `agent_package_id` | `bigint` | 可空 | 发布后绑定 Package | FK `on delete restrict`；非空条件唯一索引 |
| `created_at`/`updated_at` | `timestamptz` | 默认 `now()` | 创建/更新时间 | `updated_at` 索引 |
| `deleted_at`/`deleted_by` | 时间/text | 可空 | 逻辑删除 | 未删除条件索引 |

### 9.2 `skill_pack_assets`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | Asset ID | PK；`unique(id, pack_id)` |
| `pack_id` | `bigint` | 必填 | 所属 Pack | FK `on delete restrict`；索引 |
| `kind` | `text` | 必填 | `source_video`、`audio`、`frame` 等 | check |
| `original_name`/`safe_name` | `text` | 必填 | 展示名/安全名 | 长度限制 |
| `mime_type` | `text` | 必填 | 服务端确认类型 | 索引按需要 |
| `size_bytes` | `bigint` | 必填 | 实际大小 | `>= 0` |
| `storage_key` | `text` | 必填 | 对象存储键 | unique |
| `sha256` | `text` | 正式资产必填 | 可信内容哈希 | 64 位 hex check；索引 |
| `status` | `text` | 必填 | 上传/验证/就绪/失败/删除 | check；索引 `(pack_id,status)` |
| `metadata_jsonb` | `jsonb` | 默认 `{}` | 媒体扩展信息 | object check |
| `created_at`/`deleted_at` | 时间 | 创建必填/删除可空 | 生命周期 | 未删除条件索引 |

### 9.3 `skill_pack_runs`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | 业务运行 ID | PK；`unique(id, pack_id)` |
| `pack_id` | `bigint` | 必填 | 所属 Pack | FK `on delete restrict` |
| `stage`/`status` | `text` | 必填 | 当前阶段和运行状态 | check；索引 `(pack_id,status)` |
| `input_fingerprint` | `text` | 必填 | 输入、配置和版本指纹 | 索引 |
| `pipeline_version` | `text` | 必填 | 流程版本 | 不能为空 |
| `model_config_jsonb` | `jsonb` | 默认 `{}` | 模型、参数和降级配置 | object check |
| `prompt_version`/`generator_version` | `text` | 必填 | 审计和复现 | 不能为空 |
| `error_code`/`error_message` | `text` | 可空 | 失败信息 | 不存敏感正文 |
| `created_at`/`updated_at` | 时间 | 默认 `now()` | 生命周期 | 索引 |

### 9.4 `skill_pack_media_jobs`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | Worker 任务 | PK |
| `run_id`/`pack_id`/`asset_id` | `bigint` | 必填 | 运行、Pack、素材 | 组合 FK 保证归属 |
| `job_type` | `text` | 必填 | probe/transcribe/extract_frames | check |
| `status` | `text` | 默认 `queued` | queued/leased/completed/failed/cancelled | claim 索引 |
| `lease_owner` | `text` | 可空 | Worker 标识 | leased 时必填 |
| `lease_expires_at` | `timestamptz` | 可空 | 租约到期 | 索引 |
| `attempt_count`/`max_attempts` | `integer` | 0/配置值 | 重试计数 | 合法范围 check |
| `available_at` | `timestamptz` | 默认 `now()` | 退避后可领取时间 | 索引 `(status,available_at)` |
| `input_fingerprint` | `text` | 必填 | 防重复输入身份 | unique 作用域 |
| `result_manifest_jsonb` | `jsonb` | 可空 | 完成 manifest | object check |
| `created_at`/`updated_at` | 时间 | 默认 | 生命周期 | 索引 |

### 9.5 `skill_evidence_units`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | Evidence ID | PK；`unique(id, pack_id)` |
| `pack_id`/`asset_id` | `bigint` | 必填 | 所属 Pack/Asset | 组合 FK |
| `modality` | `text` | 必填 | transcript/frame 等 | check |
| `start_seconds`/`end_seconds` | `numeric` | 可空 | 视频时间范围 | 非负且 end >= start |
| `frame_id` | `text` | 可空 | Worker frame 标识 | 在 Pack/manifest 范围唯一 |
| `content` | `text` | 默认空 | 原文或转录 | 长度限制 |
| `observation` | `text` | 可空 | 可见内容描述 | 不代替原文 |
| `source_kind` | `text` | 必填 | `source_explicit`、`model_observed`、`model_inferred`、`user_confirmed` | check |
| `extraction_method` | `text` | 必填 | Whisper/抽帧/用户补充等 | 审计字段 |
| `confidence` | `numeric` | 可空 | 置信度 | 0–1 check |
| `metadata_jsonb` | `jsonb` | 默认 `{}` | 后续页码/区域等 | object check |
| `created_at` | 时间 | 默认 | 创建时间 | 索引 `(pack_id,modality)` |

### 9.6 `skill_candidates`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | 候选 ID | PK；`unique(id, pack_id)` |
| `pack_id`/`run_id` | `bigint` | 必填 | 所属 Pack/运行 | 组合 FK |
| `candidate_type` | `text` | 必填 | M1 为主要 Skill 候选 | check |
| `title`/`content_jsonb` | text/jsonb | 必填 | 候选内容 | object check |
| `status` | `text` | 默认 `pending` | pending/accepted/rejected/edited | check；索引 |
| `revision_no` | `integer` | 默认 0 | 候选并发版本 | `>=0` |
| `decision_by`/`decision_at` | text/时间 | 可空 | 人工确认 | 状态一致性 check |
| `created_at`/`updated_at` | 时间 | 默认 | 生命周期 | 索引 |

### 9.7 发布成员与版本资产引用

| 表 | 关键字段 | 必填/默认 | 含义与约束 |
|---|---|---|---|
| `skill_pack_members` | `pack_id`,`candidate_id`,`skill_id`,`skill_version_id`,`sort_order`,`published_package_version_id` | 均必填 | 组合 FK 保证同一 Package；唯一 Pack+Package Version+Skill |
| `skill_assets` | `id`,`path`,`role`,`mime_type`,`sha256`,`size_bytes`,`storage_key` | 均必填 | 不可变清单；`path+sha256+role` 稳定；不使用临时 ID 计算版本身份 |
| `agent_skill_version_assets` | `skill_version_id`,`skill_asset_id`,`sort_order` | 均必填 | PK/unique 防重复；历史绑定禁止更新 |
| `skill_evidence_links` | `skill_version_id`,`evidence_unit_id`,`role` | 均必填 | 组合 FK 防跨 Pack；历史绑定禁止更新 |

### 9.8 `skill_pack_artifacts`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | 产物 ID | PK |
| `pack_id`/`run_id` | `bigint` | 必填 | 所属 Pack/运行 | 组合 FK |
| `artifact_type` | `text` | 必填 | overview/skill_draft/test_report | check；索引 |
| `content_jsonb` | `jsonb` | 必填 | 结构化产物 | object/array check |
| `content_markdown` | `text` | 默认空 | 用户可读渲染 | 不执行原始 HTML |
| `input_fingerprint` | `text` | 必填 | 输入身份 | 索引 |
| `prompt_version`/`model`/`generator_version` | `text` | 必填 | 复现信息 | 不能为空 |
| `created_at` | 时间 | 默认 | 不可变创建时间 | `(run_id,artifact_type)` 索引 |

### 9.9 `skill_pack_idempotency_keys`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `user_id` | `text` | 必填 | 请求用户 | 唯一键组成 |
| `action` | `text` | 必填 | action | 唯一键组成 |
| `scope_key` | `text` | 必填 | 创建前为 `create`，创建后为 `pack:<id>` | 唯一键组成 |
| `idempotency_key` | `text` | 必填 | 客户端请求键 | 唯一键组成 |
| `request_hash` | `text` | 必填 | 规范化请求哈希 | 不同参数冲突 |
| `status` | `text` | 默认 `pending` | pending/completed | check |
| `response_status`/`response_jsonb` | integer/jsonb | 可空 | 重放结果 | completed 时填写 |
| `created_at`/`expires_at` | 时间 | 必填 | 生命周期 | 到期清理索引 |

唯一约束：`(user_id, action, scope_key, idempotency_key)`。现有 `api_idempotency_keys` 保持不变。

### 9.10 `skill_pack_audit_events`

| 字段 | 类型 | 必填/默认 | 含义 | 约束与索引 |
|---|---|---|---|---|
| `id` | `bigserial` | 主键 | 审计事件 | PK |
| `pack_id`/`user_id` | bigint/text | 必填 | 对象和操作者 | 索引 |
| `event_type` | `text` | 必填 | upload/delete/approve/generate/edit/test/publish 等 | check/索引 |
| `object_type`/`object_id` | text/bigint | 可空 | 关联对象 | 不信任客户端身份 |
| `metadata_jsonb` | `jsonb` | 默认 `{}` | 不含敏感正文的摘要 | object check |
| `created_at` | 时间 | 默认 | 发生时间 | `(pack_id,created_at)` 索引 |

### 9.11 外键、删除和迁移

- `current_run_id` 循环外键：先创建 `skill_packs`（字段可空）和 `skill_pack_runs`，再添加组合 FK `(current_run_id,id) → skill_pack_runs(id,pack_id)`，确保当前 run 属于当前 Pack。
- Pack 与 Package：`agent_package_id` 非空条件唯一；已发布绑定使用 `on delete restrict`，避免静默丢历史。
- 用户删除采用 `deleted_at` 逻辑状态；核心版本、成员、资产和证据使用 `restrict` 或保留型策略，不级联物理删除发布历史。
- 媒体 job、临时上传和可重建检查点可在确认无发布引用后清理。
- 新增表不回填旧 Package；旧 `PackageSkill` 无 `assets` 时按空数组读取。
- 迁移使用 `create table if not exists`、命名约束补丁和索引补丁；同一迁移重复执行必须安全。
- `distilled` 同时加入共享 TypeScript union 和 `agent_skill_versions.source` check；不修改已有 source 值。

## 10. API 设计

所有业务和 Worker 控制接口都是 `POST /api`。二进制上传使用 action 返回的短期对象存储地址，不新增业务 REST 路径。

现有 action 保持原名。新 action 使用点分命名；`idempotencyKey` 放在 `payload` 中，与当前 mutation 的实际结构一致。

### 10.1 接口表

| Action | 用途 | 权限 | 主要请求字段 | 主要响应字段 | 主要错误码 |
|---|---|---|---|---|---|
| `skill.pack.create` | 创建 Pack | 登录用户 | `title,idempotencyKey` | `packId,status,revisionNo` | `INVALID_ARGUMENT,IDEMPOTENCY_*` |
| `skill.pack.list` | 列表 | 只看本人 | `cursor,limit,includeDeleted` | `items,nextCursor` | `INVALID_ARGUMENT` |
| `skill.pack.detail` | 详情/进度恢复 | 用户→Pack | `packId` | Pack、Asset、run、进度、审核状态 | `PACK_NOT_FOUND` |
| `skill.pack.asset.uploadIntent` | 上传申请 | 用户→Pack | `packId,fileName,mimeType,sizeBytes,expectedRevisionNo,idempotencyKey` | `uploadId,uploadUrl,expiresAt,requiredHeaders` | `PACK_REVISION_CONFLICT,FILE_*` |
| `skill.pack.asset.uploadComplete` | 上传确认 | 用户→Pack→upload | `packId,uploadId,expectedRevisionNo,idempotencyKey` | `assetId,status,revisionNo` | `FILE_VALIDATION_FAILED` |
| `skill.pack.asset.addUrl` | URL 导入 | 用户→Pack | `packId,url,expectedRevisionNo,idempotencyKey` | `assetId,status` | `REMOTE_SOURCE_BLOCKED,UNSUPPORTED_VIDEO_SOURCE` |
| `skill.pack.run.start` | 启动处理 | 用户→Pack→Asset | `packId,expectedRevisionNo,idempotencyKey` | `runId,status,stage` | `PACK_STATE_CONFLICT,IDEMPOTENCY_*` |
| `skill.pack.progress` | 查询进度 | 用户→Pack→run | `packId,runId` | `stage,progress,status,error,retryable` | `PACK_NOT_FOUND` |
| `skill.pack.overview.approve` | Overview 确认 | 用户→Pack→run | `packId,artifactId,expectedRevisionNo,idempotencyKey` | `status,revisionNo` | `PACK_STATE_CONFLICT` |
| `skill.pack.candidate.update` | 编辑候选 | 用户→Pack→candidate | `packId,candidateId,content,expectedCandidateRevisionNo,idempotencyKey` | `candidate,revisionNo` | `CANDIDATE_REVISION_CONFLICT` |
| `skill.pack.candidate.decide` | 接受/拒绝候选 | 用户→Pack→candidate | `packId,candidateId,decision,expectedRevisionNo,idempotencyKey` | `status,revisionNo` | `PACK_STATE_CONFLICT` |
| `skill.pack.test.start` | 启动测试 | 用户→Pack | `packId,expectedRevisionNo,idempotencyKey` | `runId,status` | `PACK_QUALITY_INPUT_INVALID` |
| `skill.pack.publish` | 原子发布 | 完整归属链 | `packId,pkgId?,expectedRevisionNo,expectedPackageVersionId?,idempotencyKey` | `packageId,packageVersionId,skillVersionId` | `PACKAGE_VERSION_CONFLICT,PACK_QUALITY_GATE_FAILED` |
| `skill.pack.cancel` | 取消当前处理 | 用户→Pack→run | `packId,runId,expectedRevisionNo,idempotencyKey` | `status,revisionNo` | `PACK_STATE_CONFLICT` |
| `skill.pack.retry` | 重试失败阶段 | 用户→Pack→run | `packId,runId,expectedRevisionNo,idempotencyKey` | 新 attempt、状态 | `RETRY_NOT_ALLOWED` |
| `skill.pack.delete` | 逻辑删除 | 用户→Pack | `packId,expectedRevisionNo,idempotencyKey` | `deletedAt` | `PUBLISHED_HISTORY_PROTECTED` |
| `internal.mediaJob.claim` | Worker 领取 | 内部令牌 | `workerId,capabilities` | job、短期读取地址 | `INTERNAL_AUTH_FAILED` |
| `internal.mediaJob.heartbeat` | Worker 续租 | token+owner+lease | `jobId,workerId,attempt` | `leaseExpiresAt` | `JOB_LEASE_CONFLICT` |
| `internal.mediaJob.complete` | Worker 回写 | token+owner+lease | `jobId,workerId,attempt,manifest` | `accepted,status` | `JOB_RESULT_CONFLICT` |
| `internal.mediaJob.fail` | Worker 报错 | token+owner+lease | `jobId,workerId,attempt,errorCode,retryable` | `status,nextAttemptAt` | `JOB_LEASE_CONFLICT` |

### 10.2 请求和响应示例

创建 Pack：

```json
{
  "action": "skill.pack.create",
  "payload": {
    "title": "课堂提问策略视频蒸馏",
    "idempotencyKey": "56fc8f46-0493-40c8-8230-55adb33f7601"
  }
}
```

```json
{
  "success": true,
  "data": {
    "packId": "101",
    "status": "draft_sources",
    "revisionNo": 0
  }
}
```

申请上传：

```json
{
  "action": "skill.pack.asset.uploadIntent",
  "payload": {
    "packId": "101",
    "fileName": "lesson.mp4",
    "mimeType": "video/mp4",
    "sizeBytes": 48200123,
    "expectedRevisionNo": 0,
    "idempotencyKey": "28f70145-d893-43bc-a72f-4f87116a6f03"
  }
}
```

```json
{
  "success": true,
  "data": {
    "uploadId": "upload_01",
    "uploadUrl": "https://object-storage.example/signed-upload",
    "expiresAt": "2026-08-15T12:10:00.000Z",
    "requiredHeaders": { "Content-Type": "video/mp4" }
  }
}
```

发布：

```json
{
  "action": "skill.pack.publish",
  "pkgId": "88",
  "payload": {
    "packId": "101",
    "expectedRevisionNo": 7,
    "expectedPackageVersionId": "12",
    "idempotencyKey": "c293192e-d224-4b6d-ab0d-097b491828ce"
  }
}
```

冲突响应：

```json
{
  "code": "PACK_REVISION_CONFLICT",
  "message": "Pack state has changed. Refresh and review before publishing.",
  "currentRevisionNo": 8
}
```

### 10.3 稳定错误码

| 错误码 | 含义 |
|---|---|
| `INVALID_ARGUMENT` | 参数不合法 |
| `PACK_NOT_FOUND` | Pack 不存在或不属于用户 |
| `PACK_REVISION_CONFLICT` | Pack 已变化 |
| `CANDIDATE_REVISION_CONFLICT` | 候选已变化 |
| `PACKAGE_VERSION_CONFLICT` | 当前 Package Version 已变化 |
| `IDEMPOTENCY_CONFLICT` | 同 key 不同参数 |
| `IDEMPOTENCY_IN_PROGRESS` | 同一请求处理中 |
| `PACK_STATE_CONFLICT` | 当前阶段不允许该操作 |
| `FILE_VALIDATION_FAILED` | 文件大小、MIME、签名或哈希校验失败 |
| `UNSUPPORTED_VIDEO_SOURCE` | 不是直接视频文件 |
| `REMOTE_SOURCE_BLOCKED` | SSRF/网络规则阻止 |
| `MEDIA_PROCESSING_FAILED` | 媒体处理失败 |
| `AI_RESPONSE_INVALID` | AI 空响应或结构无效 |
| `AI_RATE_LIMITED` | 外部 AI 限流 |
| `JOB_LEASE_CONFLICT` | Worker 租约已失效 |
| `PACK_QUALITY_GATE_FAILED` | 发布测试未通过 |

前端不得依赖错误文案判断逻辑。

## 11. AI 生成、证据与隐私

### 11.1 证据最小信息

每条证据至少保存：素材 ID、时间段或后续页码、文本、关键帧/截图引用、提取方式、来源类型和置信度。

| 来源类型 | 含义 | 展示规则 |
|---|---|---|
| `source_explicit` | 视频原话或确定性提取内容 | 可标为“原材料内容” |
| `model_observed` | 模型对画面直接可见内容的描述 | 标为“画面观察” |
| `model_inferred` | 模型推理出的结论 | 必须标为“AI 推断”，不能冒充原话 |
| `user_confirmed` | 用户补充或确认 | 显示确认人和时间 |

- 生成的教学经验和 Skill 规则尽量关联 Evidence ID。
- 模型返回的 frame ID 必须在 Worker manifest 白名单中。
- Prompt、模型、参数、输入指纹、pipeline 和 generator 版本随 run/artifact 保存。
- Kimi 或最终选定的视觉模型上线前必须做图片输入能力探针；不可用时回退到转录 + 关键帧文本描述，不静默伪装为完整视觉分析。
- 外部 AI 超时、限流、空响应、无效 JSON、token 超限按错误类型处理；不得原参数无限重试。

### 11.2 敏感内容和未成年人

| 项目 | 要求 |
|---|---|
| 内容授权 | 上传前提示用户确认有权处理和使用材料 |
| 学生隐私 | 默认按敏感教学材料处理，不公开分享，不进入日志 |
| 未成年人影像 | 明确提示授权责任；生产部署确认数据区域、保留期和第三方模型传输边界 |
| 个人信息 | 可配置检测和遮蔽策略；不得用于无关训练或分析 |
| 外部模型 | 上线前确认供应商数据使用、留存和跨境政策 |
| 用户删除 | 删除草稿立即停止普通访问；已发布历史按版本和合规策略处理并清晰告知 |

## 12. 权限、安全与审计

| 项目 | 要求 |
|---|---|
| 用户身份 | 只从登录态/可信网关取得，禁止客户端 `user_id` 作为身份依据 |
| 归属链 | 每次校验 `user → Package → Pack → Asset/Evidence → Skill/Version` |
| 对象签名 | 生成签名 URL 前再次校验用户、Pack 和版本归属 |
| 内部令牌 | 最小权限、可轮换、从环境变量读取、不写日志 |
| 管理员 | 只有可信角色可从网关传递并验证后才考虑特殊权限；M1 无绕过 |
| 日志 | 不输出密钥、完整签名 URL、完整敏感材料、图片 base64 或完整转录 |
| 审计 | 上传、删除、确认、生成、编辑、测试、发布、失败重试均写事件 |
| 版权 | 明确禁止绕过平台限制；保留用户授权确认记录 |

## 13. 媒体与 AI 处理规范

| 阶段 | 输入 | 输出 | 失败/降级 |
|---|---|---|---|
| 媒体探测 | 原视频 | 容器、编码、时长、分辨率、音轨 | 损坏或不支持则停止 |
| 转码 | 可读视频 | 标准化代理视频/音频 | 本地可使用低分辨率和 CPU 模式 |
| 音频提取 | 视频音轨 | 标准采样率音频 | 无音轨则跳过 Whisper |
| Whisper | 音频 | 带开始/结束时间的 segments | 模型可配置；超时按任务重试策略处理 |
| 抽帧 | 视频+转录提示 | frame manifest 与图片 | 场景/周期策略可配置；限制帧数 |
| OCR（后续） | 页面/关键帧 | 文字和区域 | M1 不作为硬依赖 |
| 视觉分析 | 关键帧+附近转录 | observation + evidence ID | 先做能力探针；不可用走文本降级 |
| Skill 生成 | 已确认证据 | 结构化 Skill 草稿 | 严格 JSON，有限修复后仍失败则提示重试 |

本地无 GPU 时允许使用小模型、CPU Whisper、短视频测试样本和较低并发。生产使用的 Whisper/OCR/视觉模型、GPU/CPU 规格、并发和超时由真实基准测试决定，不在本文写死。

## 14. 前端体验

沿用 EduSkill 现有 Skill Workspace 视觉和导航，不另造复杂独立工作台。

| 场景 | 体验要求 |
|---|---|
| 上传 | 显示大小、进度、暂停/取消；M1 失败后重新上传，不承诺跨浏览器分片续传 |
| 处理 | 展示用户能理解的阶段和预计状态，不暴露 Worker、对象键或内部数据库 ID |
| 恢复 | 页面加载时从 Pack detail 恢复，不依赖内存状态 |
| 失败 | 展示具体阶段、可重试性和下一步；保留已经成功的产物 |
| 证据预览 | 从 Skill/规则跳回视频时间点和关键帧 |
| 冲突 | 409 提示刷新，不自动覆盖；Mutation 双层防重复 |
| 异步列表 | 防 stale response；发布后失效化 Pack、Package、Version、Skill 和 Arena 状态 |
| 布局 | 桌面和较窄窗口自适应；右侧证据栏可折叠，不与现有侧栏冲突 |
| 无障碍 | 键盘可操作、焦点清晰、进度有文本、图片有替代说明、状态不只靠颜色 |
| 完整状态 | 提供空状态、加载态、处理中、部分成功、失败、取消和已发布状态 |

## 15. 质量、测试和运维

### 15.1 测试范围

| 测试层级 | 最低覆盖 |
|---|---|
| 单元测试 | 状态机、规范化哈希、文件校验、SSRF、证据校验、版本身份、错误映射 |
| 数据库测试 | 外键、唯一约束、current_run 循环关系、逻辑删除、重复迁移、事务回滚 |
| API 测试 | 正常、未认证、越权、错父对象、幂等、409、取消、重试、删除 |
| Worker 集成 | claim、心跳、超时接管、重复消费、转录、抽帧、部分失败和回写 |
| 安全测试 | SSRF、重定向、DNS 重绑定、超大文件、伪造 MIME、路径、令牌和签名泄露 |
| E2E | 上传/URL→解析→三个确认点→测试→发布→Arena→历史复查 |
| 回归测试 | 旧 Package、Skill Version、Arena、登录、旧 action 和旧数据保持不变 |

### 15.2 M1 真实验收示例

固定一段 5–10 分钟、有中文语音和板书画面的教学视频，同时准备一个相同内容的直接下载 URL。

| 验收项 | 成功标准 |
|---|---|
| 上传 | 本地视频与直接 URL 均能创建同一内容身份，不重复处理 |
| 转录 | 主要语句有合理时间戳；抽样人工核对可定位回视频 |
| 关键帧 | 能覆盖板书或教学关键画面；frame ID 均来自 manifest |
| 恢复 | 处理中刷新、退出再登录后继续显示真实进度 |
| Skill | 核心规则至少关联一条有效证据；无证据主张被标记或拒绝 |
| 测试 | 正向、负向、执行质量和证据引用测试通过 |
| 发布 | 重复点击只产生一个版本；事务失败不留半成品 |
| 历史 | 替换或删除草稿素材后，已发布版本仍能打开原证据 |
| Arena | 使用固定 Skill Version 和 Evidence，不自动切换最新内容 |
| 兼容 | 关闭功能开关后，旧创建、Skill、版本和 Arena 流程正常 |

### 15.3 指标、日志和告警

| 类别 | 指标 |
|---|---|
| 性能 | 上传耗时、队列等待、处理总时长、各阶段 P50/P95 |
| 可靠性 | 成功率、重试率、终止失败率、租约超时、重复回写拒绝数 |
| 质量 | 转录抽样质量、有效 Evidence 比例、无来源主张数、测试通过率 |
| 成本 | 存储增长、派生文件比例、AI token/调用费用、Worker CPU/GPU 时间 |
| 安全 | SSRF 拒绝数、越权拒绝数、文件校验失败、内部认证失败 |

健康检查至少覆盖 PostgreSQL、对象存储、Worker 心跳和模型能力状态。关键失败率、队列积压、存储容量和备份失败必须告警。

### 15.4 配置与 Docker Compose

密钥全部来自环境变量，不提交真实值。配置至少分为：对象存储连接、文件大小/数量、Worker 内部令牌、租约/重试、Whisper/视觉模型、AI 超时、功能开关和保留期。

本地启动依赖顺序：

```text
PostgreSQL 健康
→ MinIO 健康且 bucket 初始化完成
→ TypeScript Server
→ Python Worker
→ React Web
```

生产云厂商、硬件规格、模型规格和保存期限由部署方确认。

## 16. 代码影响范围与实施顺序

### 16.1 预计代码范围

| 区域 | 预计改动 |
|---|---|
| `educlaw-shared/index.ts` | Pack/Evidence/Asset 类型、可选资产清单、`distilled` |
| `educlaw-server/src/services/db-schema.ts` | 新表、约束、索引和幂等迁移 |
| `educlaw-server/src/routes/actions.ts` | 保留旧 action，注册新用户 action；Pack 专用请求解析 |
| Server services | Pack、对象存储、媒体任务、Evidence、AI 编排、发布、审计 |
| `educlaw-server/src/config.ts` | 对象存储、Worker、模型、限制和功能开关配置 |
| `educlaw-media-worker/` | Python Worker 和测试 |
| `educlaw-web/src/api/lite-api.ts` | 新 action 客户端，不改旧方法 |
| Skill Workspace 组件 | 新入口、流程页、证据预览和状态恢复 |
| `docker-compose.yml` | MinIO、初始化、Worker、健康检查和数据卷 |

### 16.2 必须先做的技术验证

1. MinIO 预签名上传、服务端实际 SHA-256 和隔离对象转正式对象。
2. 中文教学视频的 FFmpeg、Whisper、关键帧质量和无 GPU 降级。
3. 视觉模型能力探针、失败降级和数据合规；不预设必须使用 Kimi。
4. Pack 创建幂等、Worker 租约和重复回写。
5. Package/Skill/成员/资产/Evidence 同事务原子发布及失败回滚。

### 16.3 审核通过后实施顺序

| 顺序 | 实施内容 | 阶段验收 |
|---:|---|---|
| 1 | 固化共享类型、状态、API、错误码和数据库迁移 | 契约、重复迁移和旧数据兼容通过 |
| 2 | 对象存储、上传和 URL 安全链路 | MIME、大小、SHA-256、SSRF、权限测试通过 |
| 3 | 媒体任务、内部 action 和 Python Worker | lease、重试、重复消费、令牌轮换通过 |
| 4 | 视频转录、抽帧和 Evidence | 时间戳、frame 白名单、失败恢复和真实视频基准通过 |
| 5 | Overview、候选确认和单 Skill 生成 | 主张可追溯，三个确认点状态正确 |
| 6 | 测试门禁和原子发布 | 幂等、并发、事务回滚、历史固定通过 |
| 7 | 前端与 Arena | 浏览器 E2E、窄窗口、恢复、无障碍和旧流程回归通过 |
| 8 | 灰度与运维 | 健康检查、指标、告警、容量、备份恢复和回退确认 |

## 17. 已确认决定与待确认事项

### 17.1 已确认的设计边界

| 决定 | 结论 |
|---|---|
| 发布体系 | 复用现有 Package、Skill Version、Package Version 和 Arena |
| 业务控制面 | TypeScript + PostgreSQL |
| Worker | Python 只做媒体计算，通过内部 action 通信 |
| 接口 | 新业务统一 `POST /api`，不重命名旧 action |
| M1 | 单个视频纵向闭环；支持本地上传和直接 HTTP(S) 视频 |
| 平台限制 | 不解析 YouTube/B站/抖音页面，不绕过登录、付费墙或 DRM |
| 发布权限 | M1 所有用户都不能绕过硬门禁 |

### 17.2 仍需用户/部署方确认

| 编号 | 问题 | 本文不擅自决定 |
|---:|---|---|
| 1 | M1 最大视频大小、时长和每用户并发 | 需结合网络和算力基准 |
| 2 | 生产对象存储厂商 | MinIO、OSS、COS 或 S3 由部署方选择 |
| 3 | 原文件、派生文件和删除宽限期 | 需结合合规、成本和恢复要求 |
| 4 | Whisper/视觉模型及生产 CPU/GPU | 需真实中文视频基准和供应商合规评估 |
| 5 | M1 固定验收视频和期望 Skill | 需产品提供或确认 |
| 6 | 未成年人影像和第三方模型传输政策 | 需业务与合规确认 |

## 18. 审核结论与准入条件

**当前结论：待审核，暂不进入开发。**

产品和工程人员至少确认以下内容后，才能编写最终实施计划并开始代码修改：

- M1 产品范围和异常呈现；
- MinIO/S3、Worker 内部 action 和文件安全链路；
- Pack 创建幂等、状态机、表结构和迁移兼容；
- Skill Version 固定资产与证据、`distilled`、一对一绑定和原子发布；
- SSRF、隐私、版权、日志和审计边界；
- M1 真实验收样本、模型/硬件验证方式和部署责任人。

> **本文档未审核通过前，不编码、不建表、不提交、不推送。**
