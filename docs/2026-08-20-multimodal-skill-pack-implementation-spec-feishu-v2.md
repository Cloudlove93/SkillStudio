# EduSkill 多模态 Skill Pack 功能实现规范书（飞书审核版 V2）

> - 文档状态：实施中（含 2026-08-26 产品决策增补）
> - 文档日期：2026-08-20；最近增补：2026-08-26
> - 本轮性质：按审核后增补实施并验证
> - 实施权威：本文件是“多模态 Skill Pack”功能的唯一实施规范；Codex 不得以 2026-08-15 旧稿或自然对话式引导生成 V1.1 替代本文件
>
> 强制边界：**不新增业务表、不执行迁移、不提交、不推送；对象存储数据不删除。**

## 0. 2026-08-26 产品决策增补（优先级高于下文历史表述）

本增补解决创建流程中“强制 Arena 测试与用户正常试用混为一体”的问题。下文凡出现“创建前必须运行 Arena”“Arena 是发布硬门禁”“测试发布”的表述，统一按本节解释；Arena 的版本固定、证据绑定和历史可复查设计仍然有效。

| 项目 | 最终结论 |
|---|---|
| 用户主流程 | `处理素材 → 确认内容 → 选择 Skill → 确认生成 → 工作区试用/Skill 仓库` |
| Arena 定位 | 保留为 Skill 仓库中的可选评估能力，不出现在多模态创建向导主流程，不阻塞首次生成 |
| 质量保证 | 候选验证、人工确认、快照结构校验、会话/修订绑定和原子持久化仍是强制门禁；取消的只是额外模型 Arena 门禁，不是绕过质量校验 |
| 最终动作 | 新增 `skill.media.generate.confirm`；一次事务生成不可变版本、加入工作区并保存到 Skill 仓库 |
| 历史兼容 | 新会话允许 `arena_testing → publishing → published`；已在 `ready_to_publish` 的旧会话也可直接确认生成 |
| 旧接口 | `skill.media.test.start` 和 `skill.media.publish` 保持兼容，供历史客户端和可选 Arena 使用 |
| 前端术语 | 第四步统一为“确认生成”；不展示 Pack、Package ID、Package Version ID 或 Arena 发布门禁 |
| 数据边界 | 复用现有 `confirmation_json` 和版本体系；不新增表、列、FK 或 CHECK，不删除对象存储数据 |

生成成功页只保留两个后续动作：“进入工作区试用”和“进入 Skill 仓库”。创建流程不自动产生“新版本”概念；首次确认生成创建首个不可变版本，后续版本升级继续走现有版本能力。

文档优先级：当前代码与已部署数据库用于确认事实基线；本 V2 规定本功能新增行为。发生冲突时，以本 V2 的已审核结论为准；`2026-08-15-multimodal-skill-pack-implementation-spec-feishu.md` 仅作历史参考；`教育Skill自然对话式引导生成-工程规范-飞书版.md` 只约束既有文本对话创建流程。

| 文档信息 | 结论 |
|---|---|
| 第一阶段目标 | 完成“单个视频或纯音频 → 可追溯证据 → 人工确认 → Skill → 测试 → 发布 → Arena”的纵向闭环 |
| 产品形态 | Skill Pack 是现有创建流程中的多模态工作容器，不建设平行 Skill Wiki 平台 |
| 发布体系 | 继续使用现有 Package、Skill Version、Package Version 和 Arena |
| 接口体系 | 继续使用 `POST /api` 的 action 分发；旧 action 不改名、不改语义 |
| 数据方案 | 复用 `skill_guided_creation_sessions`，M1 原则上只新增 `skill_media_jobs` 一张表 |
| 文件方案 | PostgreSQL 管业务状态；MinIO/S3 兼容存储保存视频、音频、图片和代码等大文件 |
| Worker 边界 | Python 只做媒体计算；TypeScript 负责权限、模型编排、确认、发布和 Arena |
| 发布原则 | 已发布版本不可变；发布失败不能留下半成品版本 |

## 1. 审核摘要

### 1.1 本版建议结论

| 项目 | V2 结论 |
|---|---|
| 是否另建 Skill Pack 发布平台 | 否。产品上称为 Skill Pack，工程上复用创建会话与现有 Package 版本链 |
| 是否沿用旧稿十表设计 | 否。工作态收进现有创建会话，只新增通用媒体任务表 |
| 关键帧主策略 | 先理解教学内容并定位语义时间窗，再在窗内召回、过滤和选择证据帧 |
| Python 是否成为第二套后端 | 否。Python 是无业务状态的媒体执行器，不管理用户、权限和发布 |
| 是否绑定 Kimi K2.5 | 否。使用统一模型适配层；识图能力不能等同于原生长视频能力 |
| M1 是否支持平台网页解析 | 否。YouTube、B站、抖音页面以及登录、付费墙、DRM 内容均不支持 |
| M1 是否自动发布 | 否。Overview、证据与候选 Skill、发布均需用户确认 |
| 是否允许强制绕过质量门禁 | M1 不允许；可信角色链路完善后再单独评审 |
| M1 主资源类型 | 已确定支持 video 或 audio。一次会话只允许一个主资源，不允许两个主资源并存 |

### 1.2 当前代码核对结果

| 已核对代码 | 真实现状 | 对 V2 的约束 |
|---|---|---|
| `educlaw-server/src/services/db-schema.ts` | 已有 `skill_guided_creation_sessions`，包含用户归属、状态、草稿、确认、校验、版本结果、修订号和逻辑删除 | 复用为多模态创建工作容器，不再新增 Pack、Run、Candidate 等平行表 |
| `educlaw-server/src/routes/actions.ts` | 已有 `POST /api`、显式 action map、`pkgId`、`payload`、稳定错误响应 | 新接口继续走显式映射，不动态执行 |
| `educlaw-server/src/routes/guided-creation-actions.ts` | 已有创建、列表、详情、消息、确认、取消、重命名、删除；部分 action 为 SSE | 旧 action 和旧字段保持兼容；新增媒体 action 使用 lowerCamelCase |
| `educlaw-server/src/services/guided-creation-service.ts` | 创建冲突后只按 `user_id + start_client_message_id` 取旧会话；发布只记录 `finalize_request_id`，两处都未比较请求 hash | 新媒体创建/发布必须增加正式请求摘要列后，才能承诺“同键异参返回 409” |
| `educlaw-shared/index.ts` | `PackageSkill` 当前只有 `id/dirName/name/description/skillMd`；版本来源没有 `distilled` | 只做可选字段兼容扩展，并增加 `distilled` 来源 |
| 现有版本表 | Package Version、Skill Version、Package-Version-Skill 关系已存在，Skill 回退会创建新版本 | 发布继续复用原子版本链，历史不覆盖 |
| 现有 Arena | Thread 固定 `base_package_version_id`，左右 Variant 固定 `skill_id/skill_version_id` | 多模态资产随 Skill Version 固定，旧 Thread 不随新版本变化 |
| `api_idempotency_keys` | 必须有 `package_id` | Pack 创建前不能原样复用；创建幂等复用会话已有唯一键，媒体任务使用新任务表幂等键 |

### 1.3 已确认决定与仍需确认

| 类别 | 内容 |
|---|---|
| 已确认 | 复用现有 Package/Skill Version/Package Version/Arena；M1 支持单一 video 或 audio 主资源；不建平行平台；关键帧语义定位优先；Python 无业务状态；M1 不引入 Celery/Redis/RabbitMQ；不自动无人审核发布 |
| 待确认 | 视频/音频大小与时长、分片参数、ASR/视觉模型与算力、素材可见性/访问策略、是否允许第三方原生视频模型、版权策略 |

## 2. 产品概念与用户看到的内容

| 概念 | 工程含义 | 用户看到什么 |
|---|---|---|
| Skill Pack | 一次多模态创建工作的容器；M1 复用 `skill_guided_creation_sessions`，发布后绑定一个现有 Agent Package | 名称、素材、处理进度、证据、候选 Skill、测试和发布状态 |
| Skill | 可独立检索、选择和执行的一组方法、步骤与边界 | 名称、适用范围、步骤、限制、示例和证据 |
| 素材 | M1 为一个视频或纯音频主资源；后续可扩展多源合并、PDF、文档和图片 | 文件名、类型、时长、大小、处理状态；不展示对象键 |
| 证据 | 能定位回素材的文本、时间段、关键帧、音频片段或文档区域 | 点击后跳到视频时间点、截图或文档位置 |
| 候选 Skill | 系统从证据中整理出的可编辑草稿 | 可拆分、合并、修改、废弃和补证据 |
| Skill Version | 发布时固定的 Skill 文本、资产清单、证据和生成配置 | 可复查、可回退的历史版本 |
| Package Version | 一次发布后固定的一组 Skill Version | Package 历史和对应 Skill 组合 |

**一对一关系：**M1 中一个 Skill Pack 工作容器最多绑定一个 Agent Package；发布前 `package_id` 为空，首次发布后固定。现有 `uq_guided_session_package` 唯一索引继续保证一个 Package 不会被两个创建容器重复占用。

## 3. 用户完整流程与确认点

### 3.1 主流程

`上传单一视频/音频或导入视频直链 → 媒体探测与 ASR → 统一证据时间线 → Adler Overview 确认 → 五路候选与 V1/V2/V3 → 候选 Skill 确认 → RIA++ Skill → Arena 压力测试 → 发布确认 → 不可变版本`

| 阶段 | 用户操作 | 系统行为 | 是否可离开页面 |
|---|---|---|---|
| 创建 | 新建“素材蒸馏”任务 | 持久化创建会话，返回 `sessionId` | 是 |
| 上传/导入 | 上传一个视频或 MP3/WAV/M4A 等纯音频；视频可填写直接下载地址 | 校验权限、格式、大小和 URL 安全，保存一个主要源对象 | 是，回来后恢复上传或重新上传 |
| 解析 | 查看进度，可取消 | Worker 探测并规范化媒体；视频默认抽取音轨，video/audio 都生成分段级时间戳 ASR；无音轨视频显式走视觉降级 | 是，状态来自服务端 |
| Overview 确认 | 确认 Adler 四层概览、章节/主题边界、内容缺口和降级情况 | 固定第一次用户确认及本轮修订号，才允许五路候选提取 | 是 |
| 证据确认 | 预览关键帧与附近讲解，可替换、撤销引用或补选；对象本身永久保留 | 保存证据卡和来源类型，避免模型推断伪装成原文 | 是 |
| 候选确认 | 查看 V1/V2/V3 结果，修改、拆分、合并、降级或废弃候选 Skill | 失败候选只保留为案例、术语或引用；通过候选进入 RIA++ | 是 |
| 测试 | 运行确定性门禁和 Arena 压力测试 | 覆盖触发、反触发、边界和跨 Skill 混淆，保存结果、成本、延迟与失败原因 | 是 |
| 发布确认 | 检查 Skill、证据、版本资产和测试结果 | 先固化资产，再用数据库事务创建现有版本链 | 是，不可重复发布 |
| 继续/重试 | 从失败阶段继续 | 只重做失败任务或失败分片，不重跑已验证步骤 | 是 |
| 取消/删除 | 取消处理或删除未发布工作区 | 停止新任务、拒绝迟到回写、逻辑删除工作区引用；对象存储中的原始文件和派生产物一律保留，仅标记为失效/不可用 | 是 |

### 3.2 三个人工确认点

| 确认点 | 必须展示 | 未确认时 |
|---|---|---|
| Overview | Adler 的结构、解释、批判、应用四层概览；章节/话题、内容范围、无音轨/无视觉等缺口和降级模式 | 不执行五路候选提取 |
| 证据与候选 Skill | 每条规则的来源、时间、音频片段/截图/文本、推断标记；五路候选、V1/V2/V3、适用范围和边界 | 不进入 RIA++ 和发布准备 |
| 发布 | 最终 Skill、版本资产清单、质量门禁、Arena 结果、版权与隐私提醒 | 不创建 Package/Skill Version |

### 3.3 恢复、取消与异常呈现

| 场景 | 服务端处理 | 用户看到的内容 |
|---|---|---|
| 刷新、重登、关闭浏览器 | 会话、任务、租约、任务级进度和已提交阶段结果均在服务端 | 回到详情后显示真实阶段和进度 |
| 空材料 | 禁止启动处理 | “请先添加可用素材” |
| 重复材料 | Worker 对实际内容计算 SHA-256；同一会话重复则阻止，允许用户选择复用 | “该素材已添加”及复用选项 |
| 损坏文件 | 文件签名或 `ffprobe` 失败 | “文件损坏或格式不受支持”，可替换 |
| 超大/超时 | 上传前和读取时双重拒绝；释放租约 | 明确上限、失败阶段和可重试操作 |
| 无音频视频 | 跳过或标记转录不可用，继续画面路线 | “未检测到音频，将按画面分析” |
| 无可用视觉内容 | 不制造无意义截图，保留文字/音频证据 | “没有可用视觉证据”，仍可人工判断是否继续 |
| 低置信度 ASR | 逐段标低置信度并允许编辑；未经人工确认不得生成来源确定的文本断言 | 显示需校正片段，可回放原音频 |
| 转录失败 | 可重试；视频可在能力允许时转视觉降级，纯音频必须人工补充/校正后才继续 | 展示稳定错误码、失败范围和降级条件，不生成无来源文本 |
| 说话人分离失败 | diarization 为可选增强，失败后保留普通分段 ASR | 显示“未区分说话人”，不阻塞 M1 |
| 模型空响应/无效 JSON | 允许一次格式修复；仍失败则停止该阶段 | 不展示伪造结果，可重试或换模型 |
| Worker 超时/崩溃 | 租约到期回收，按退避和最大次数重试 | 显示“处理超时，正在重试”或最终失败 |
| 部分成功 | 保存已验证产物，记录缺失项 | “部分完成”，可补处理或在门禁允许时继续 |
| 处理期间删除 | 标记取消，后续回写必须校验状态与租约 | 删除后任务不会“复活” |
| 多标签页并发编辑 | `revisionNo` 不一致返回 409 | 提示状态已变化并刷新，不自动覆盖 |

## 4. 分阶段范围

| 阶段 | 包含 | 不包含 | 验收标准 | 回退方式 |
|---|---|---|---|---|
| M1 | 一次会话只有一个主要源，类型为 video 或 audio；本地视频、可直接下载的 HTTP(S) 视频、MP3/WAV/M4A 等纯音频；媒体探测、音频规范化、分段级时间戳 ASR、可编辑转录、证据回放、显式降级、一个主要 Skill、Arena 和发布 | 同一会话多源材料、平台网页解析、批量播客、多 Skill 路由、文档/OCR、无限长度媒体 | 纯音频和有音轨视频均完成端到端闭环；无音轨视频可视觉降级；转录可编辑、定位和回放；发布版本可复查且旧功能无回归 | 功能开关关闭入口；停止新任务；未发布工作区可逻辑删除，所有对象保留，旧版本链不变 |
| M1.1 | 超长视频/音频自动章节化、批量播客、稳定说话人分离、可选逐字时间戳；失败分片单独重试 | 多 Skill 自动编排 | 单片失败不重跑完整媒体；增强能力失败不破坏 M1 分段 ASR | 按增强能力关闭，不影响 M1 普通 video/audio |
| M2 | 同一 Pack 多源材料合并；一个 Pack 多 Skill；去重、层级和关系；Pack 路由、兄弟 Skill 混淆、禁触发测试 | 文档和图片正式接入 | 多源、多 Skill 能正确合并、检索、选择、组合并固定版本发布 | 回退到一个主要源、一个主要 Skill 路线 |
| M3 | PDF、DOCX、Markdown、图片、OCR、页码/区域证据 | 平台版权绕过 | 每种素材均能回到原位置，DOCX 页码语义经单独评审 | 逐类关闭入口 |
| M4 | 运行时渐进加载、跨 Skill 组合、更多自动化 Arena 指标 | 新发布体系 | 轻量检索后按需加载资产，成本和任务完成度可观测 | 回退到现有文本 Skill 运行方式 |

### 4.1 M1 醒目边界

| M1 不做 | 原因 |
|---|---|
| 不构建平行 Skill Wiki 平台 | 避免重复用户、权限、版本和发布体系 |
| 不新增大量数据库表 | 工作态可由现有创建会话承载 |
| 不引入 Celery、Redis、RabbitMQ | PostgreSQL 租约队列足够支撑第一阶段 |
| 不训练自有关键帧模型 | 先验证语义定位与候选筛选链路 |
| 不全自动无人审核发布 | 教学内容、版权、隐私和证据需要人工确认 |
| 不保证无限长度视频一次处理 | 先设上限；超长自动章节化放 M1.1/M2 |
| 不在一次会话中并发处理多个主要源素材 | M1 只有一个 video 或 audio 主要源，多源合并放 M2 |
| 不强迫每个 Skill 同时有文字、图片、音频和代码 | 按来源保留可用模态 |
| 不强制逐字时间戳 | M1 只要求可定位、可回放的分段级时间戳 |
| 不强制高精度说话人分离 | diarization 可选，失败不阻塞；稳定能力放 M1.1 |
| 不做情绪、声学事件和音乐结构分析 | 不属于 M1 教学 Skill 蒸馏闭环 |
| 不把 scene frame 或编码 I 帧当教学重点 | 它们只反映画面/编码变化，不代表教学语义 |
| 不把周期抽帧作为主策略 | 仅作为最后兜底 |
| 不照搬微软原型的均匀抽帧缺口 | 正式链路必须有语义时刻和证据理由 |
| 不支持 YouTube/B站/抖音页面解析 | Resource2Skill 的 YouTube 实现只作技术参考 |
| 不支持登录、付费墙、DRM 或平台限制绕过 | 遵守安全、版权和平台规则 |

M1 的 `primarySource.kind` 必须是 `video` 或 `audio`，且每次会话只能存在一个主要源。视频中的音轨默认抽取、规范化并执行 ASR；纯音频直接进入规范化与 ASR；无音轨视频跳过 ASR 并进入显式视觉降级。转录、规范媒体、抽取音频、候选帧、选中帧和 manifest 都是派生产物，不计为新源素材。上传第二个主要源必须返回 `PRIMARY_SOURCE_ALREADY_EXISTS`；显式替换时需校验 `expectedRevisionNo`，先使旧派生产物标记为 `orphaned/unreferenced` 并撤销当前引用，再接受新素材，不能并发覆盖同一个 JSONB 工作态。

### 4.2 后续文档类素材的边界

| 问题 | M3 前必须明确的规则 |
|---|---|
| DOCX 页码 | DOCX 原生排版会随字体和环境变化，不能直接承诺稳定页码；建议转换为固定版式后记录“转换页码 + 原文段落锚点” |
| Markdown 相对图片 | 只在同一受控素材包内解析，禁止路径穿越；外部图片默认不自动抓取，需经过 URL 安全和版权检查 |
| OCR 区域 | 保存页码、归一化坐标、OCR 文本、模型/处理器版本和置信度 |

## 5. 技术参考的正确定位

### 5.1 微软 Resource2Skill

主参考是微软研究院的 [RESOURCE2SKILL 论文](https://arxiv.org/html/2606.29538v4) 与 [官方仓库](https://github.com/microsoft/Resource2Skill)，不是 Azure Video Indexer。

| 官方能力 | 本项目吸收方式 |
|---|---|
| 将教程视频、文章、代码和参考素材蒸馏为可检索、可组合、可执行的多模态 Skill | 借鉴完整架构，不把它误写成单纯关键帧算法 |
| Skill 包含结构化文字、视觉示例、可执行/可适配代码、分类/适用范围、来源与证据 | 扩展现有 `PackageSkill` 快照，旧 `skillMd` 继续有效 |
| [analyzer.py](https://github.com/microsoft/Resource2Skill/blob/main/core/analyzer.py) 将完整 YouTube URL 作为 Gemini 视频输入，可综合声音、画面和时间顺序 | 在模型适配层提供“原生视频理解”能力，但必须以供应商正式 API 能力检测为准 |
| `analyzer.py` 能解析 `Key Frame Timestamps`，再通过 yt-dlp 下载、FFmpeg 定点截图 | 借鉴“先理解再取证”路线，FFmpeg 只负责按时间物化图片 |
| Skill 的主要结构是 text、visual、code、metadata 和 provenance，并配有完整性、可追溯、去重、模态一致性、结构可执行性等确定性门禁 | 映射到 EduSkill 的文本、视觉、代码、元数据、来源和硬质量门禁 |
| Reaper 场景会使用音频模型评估生成音频 | 只说明论文在特定执行场景中使用音频评估，不推导为通用音频资源获取管线 |
| 论文和官方实现未给出完整通用的“播客/音频文件 → Skill”获取管线，也没有独立 `x_audio` 视图 | EduSkill 的 ASR、audio evidence 和音频片段回放属于本项目工程扩展，不宣称为论文原生能力 |
| 当前默认领域提示词 [distiller_prompt.md](https://github.com/microsoft/Resource2Skill/blob/main/domains/web/distiller_prompt.md) 没有稳定强制时间点；[youtube.py](https://github.com/microsoft/Resource2Skill/blob/main/core/sources/youtube.py) 解析不到时退回 20%、40%、60%、80% 均匀帧 | 不将研究原型的可选时间点误写成 100% 稳定能力；EduSkill 正式输出必须通过 JSON Schema，并记录降级 |
| 运行时先检索名称、标签、适用范围和分类路径，再读取详细模态 | EduSkill 采用渐进加载，避免把整个 Skill 库和全部视频塞入上下文 |

### 5.2 本地旧分支关键帧方案

核对对象：Cloudlove93 本地参考分支 `origin/feature/kongzhongketang-distill` 的 `educlaw-distill/app/frame_extractor.py` 与调用它的 `pipeline.py`。

| 项目 | 旧分支真实行为 |
|---|---|
| 字幕视觉提示 | 匹配“看这里、看图、观察、图表、曲线、坐标、板书、实验”等，取字幕开始后 0.5 秒，最多 8 个 |
| 场景检测 | FFmpeg `select=gt(scene\,0.32),showinfo` |
| 周期兜底 | 最多 6 个 |
| 优先级 | 字幕视觉提示 > 场景变化 > 周期 |
| 去重与上限 | 3 秒内去重，最多 20 张，截图最大宽度 960 |
| 调用顺序 | `pipeline.py` 先 `extract_keyframes`，之后才做纯文本和多模态 lesson analysis |

旧分支实际链路是：`音频 → Whisper 字幕 → 视觉提示词时间点/scene/periodic → FFmpeg 截图 → 与邻近字幕对齐 → 后续 lesson analysis`。它已经具备可复用优点：本地 Whisper、JSON/TXT/SRT 产物、时间戳、恢复、显式降级和图文对齐。

**结论：**旧方案比纯均匀抽帧更好，但仍属于“先按规则找画面，再理解内容”，还不是由教学语义重要性驱动关键帧。PPT 切换容易命中；黑板缓慢书写、同屏软件操作以及教师没有说视觉提示词时容易漏掉。Scene frame 不是教学语义关键帧，编码 I 帧更不是教学关键帧。V2 保留它的工程优点，并把字幕/ASR 语义时间点提升为联合候选的第一路信号。

### 5.3 cangjie-skill 的位置

[cangjie-skill](https://github.com/kangarooking/cangjie-skill) 的 `SKILL.md` 接收 PDF/TXT/字幕/转录等文本资源，并建议视频先使用外部工具下载和转录；它本身不负责视频下载、Whisper、FFmpeg 物理抽帧。对长视频和播客，它主要消费 EduSkill 已经生成的字幕/转录和证据时间线。

| 模块 | 职责 |
|---|---|
| Resource2Skill 思路 | 理解多模态资源，形成视觉、文字、代码和来源证据 |
| cangjie-skill 的 RIA-TV++ 思路 | 从证据中整理概念、步骤、条件、输入输出、异常、反例、验证方法和 Skill 关系 |
| EduSkill Arena | 验证这些 Skill 是否真正提升任务执行，而不只看文字是否像样 |

#### Stage 0：Adler 全局概览

| 层级 | 输出 | 用户确认 |
|---|---|---|
| 结构 | 资源主题、章节/话题、论证和步骤结构 | 是否覆盖主要内容 |
| 解释 | 关键概念、因果关系、方法和示例 | 是否正确理解原材料 |
| 批判 | 局限、冲突、不确定性和证据缺口 | 哪些内容不能直接蒸馏 |
| 应用 | 可迁移场景、潜在任务和使用条件 | 哪些方向进入候选提取 |

Stage 0 完成后设置第一次用户确认；未确认不得执行候选提取。

#### 五路候选提取

| 路径 | 提取内容 | M1 实现方式 |
|---|---|---|
| 框架 | 可复用结构、流程和决策框架 | 独立 prompt pass 或结构化任务 |
| 原理 | 因果、机制、约束和判断规律 | 独立 prompt pass 或结构化任务 |
| 案例 | 能说明方法如何执行的实例 | 独立 prompt pass 或结构化任务 |
| 反例 | 不适用、失败、误用和边界案例 | 独立 prompt pass 或结构化任务 |
| 术语 | 领域概念、定义、同义词和触发语言 | 独立 prompt pass 或结构化任务 |

五路是五次独立、可审计的结构化提取，不要求 M1 部署五个长期运行 Agent。每路输出都必须关联 evidence item。

#### V1/V2/V3 三重验证

| 验证 | 通过标准 | 失败处理 |
|---|---|---|
| V1 可复用性 | 至少能跨两个独立场景复用 | 降级为案例、术语或引用 |
| V2 新场景能力 | 能指导、解释或预测未在原材料中直接出现的新场景 | 降级为案例或待分析材料 |
| V3 非常识性 | 不是普通常识、空泛建议或改写后的标题 | 降级为术语/引用或废弃 |

任一验证失败的候选不得强行生成 Skill，也不得进入发布版本。

#### RIA++ Skill 结构

| 维度 | 工程含义 |
|---|---|
| R | 来源证据：原资源、时间范围、音频/转录/帧引用和 provenance |
| I | 解释：为什么有效、关键机制和推理链 |
| A1 | 原始案例：资源中实际出现的正例或操作过程 |
| A2 | 未来触发：适用条件、语言信号、与邻近 Skill 的区别 |
| E | 执行：输入、步骤、输出、完成标准和停止标准 |
| B | 边界：反例、失败模式、限制和相邻混淆 |

Skill 关系至少支持 `depends-on`、`contrasts-with`、`composes-with`。M1 优先写入现有 Skill/Package Version 快照 JSON，不新增关系表。

工程组合链路：

`资源接入 → 多模态解析和 evidence timeline → Adler 四层概览/第一次确认 → 五路候选 → V1/V2/V3 → 用户筛选 → RIA++ Skill → Skill 关系 → Arena 压力测试 → 发布确认 → 不可变版本`

**许可证边界：**方法论可以吸收并独立实现；在 AGPL-3.0 边界下，不得未经许可证评审直接复制其代码和大段提示词。

## 6. 关键帧重构：语义定位优先

### 6.1 主流程

`完整视频/视频分片`

`→ 原生多模态理解，或“转录 + 粗采样帧 + 时间轴”兼容理解`

`→ 输出结构化 semanticMoments`

`→ 每个重要时间窗生成多张候选帧`

`→ 清晰度、黑屏、重复、转场、遮挡过滤`

`→ 识图模型按 visualTarget 选择最相关的 1～2 张`

`→ 形成“关键帧 + 附近讲解 + 时间 + 选择原因”的证据卡`

`→ Skill 蒸馏`

### 6.2 `semanticMoment` 契约

| 字段 | 类型 | 必填 | 含义 |
|---|---|---:|---|
| `startMs` | integer | 是 | 重要时间窗开始毫秒 |
| `endMs` | integer | 是 | 重要时间窗结束毫秒，必须大于 `startMs` |
| `importance` | number | 是 | 0～1 的教学重要度，不等同于模型置信度 |
| `type` | string | 是 | 概念、步骤、示例、反例、演示、限制、总结等 |
| `summary` | string | 是 | 该时间窗讲了什么 |
| `visualTarget` | string | 否 | 希望画面中找到的板书、图表、操作状态或实验现象 |
| `audioEvidence` | object | 否 | 音频区间、说话内容和置信度 |
| `transcriptEvidence` | object | 否 | 转录片段、句子时间戳和提取方式 |
| `selectionReason` | string | 是 | 为什么该时刻值得形成证据 |

```json
{
  "startMs": 182000,
  "endMs": 196000,
  "importance": 0.92,
  "type": "worked_example",
  "summary": "教师用函数图像解释斜率变化",
  "visualTarget": "坐标系中两条切线及斜率标注",
  "transcriptEvidence": {
    "text": "观察这两条切线，斜率正在增大",
    "startMs": 184200,
    "endMs": 188900
  },
  "selectionReason": "核心概念依赖图像才能完整说明"
}
```

### 6.3 候选帧召回优先级

| 优先级 | 来源 | 用途 |
|---:|---|---|
| 1 | ASR/转录语义时间点：定义、步骤、强调、公式指代、结论、案例、边界 | 先确定教学语义窗口，并在窗口内寻找与 `visualTarget` 相关的画面 |
| 2 | 板书/PPT/软件界面的缓慢内容变化 | 覆盖逐步书写、标注增加和同屏操作状态变化 |
| 3 | 字幕视觉提示帧 | 补充“看图、观察、板书”等明确提示 |
| 4 | 场景变化帧 | 补充镜头或幻灯片切换，但不直接等同教学重点 |
| 5 | 周期采样 | 所有方法都没有候选时兜底，并在 UI 标记降级 |

五路信号先联合召回候选，再执行模糊、黑白屏、重复和转场过滤，最后由视觉模型按 `visualTarget` 排序。每个语义窗口必须在前、中、后及内容变化位置生成多张候选，不能只在单一时间点截一张。FFmpeg 负责“在指定时间取图”，不负责判断教学重点。最终选中的帧叫“教学语义关键帧”，不是编码 I 帧。M1 不训练自有关键帧模型。

### 6.4 确定性质量信号与 Spike 验收

处理顺序固定为：**确定性硬过滤与去重 → 质量/完整度信号 → 视觉模型按 `visualTarget` 软排序 → 人工确认**。清晰度、亮度、相似度等阈值全部是配置项，必须由真实教学样例 Spike 标定，不能根据经验在方案中写死。模型相关性分数用于排序和解释，不单独作为撤销证据引用的硬阈值；任何被撤销引用的对象仍永久保留。

| 质量信号 | 建议方法 | 在链路中的作用 | Spike 样例与验收 |
|---|---|---|---|
| 模糊 | Laplacian variance 或等价清晰度指标 | 明显失焦帧硬过滤；临界帧降权 | 同一 PPT 清晰帧与转场模糊帧能稳定区分，保留清晰内容 |
| 黑/白屏 | 亮度分布、低信息像素占比 | 明显黑屏、白屏和空白帧硬过滤 | 插入黑屏/白屏片段后不进入最终证据，附近有效画面仍可召回 |
| 重复 | pHash、SSIM 或等价感知相似度 | 确定性去重，保留信息更完整的一张 | 连续相同幻灯片不重复入选，渐进出现新标注时不能被误删 |
| 转场不稳定 | 时间窗前后帧差、短时稳定度 | 过滤正在切换、动画中间态；必要时向前后寻找稳定帧 | PPT 切换时选择切换完成后的页面，不选择半透明叠帧 |
| 板书/幻灯片完整度 | OCR 文本量、内容边界完整性或识图判断 | 作为质量信号与软排序条件，不以 OCR 数量单独判定教学价值 | 缓慢板书应选择公式/步骤较完整的时刻，同时保留与附近讲解的对应关系 |
| 遮挡 | 人物或大面积字幕遮挡比例；M1 能力不足时记录降级 | 明显遮挡降权，存在无遮挡替代帧时优先替换 | 教师走过黑板的片段应优先选择遮挡前后；没有替代帧时保留并标记 |
| 语义相关性 | 候选帧与 `visualTarget` 的视觉模型评分 | 通过确定性过滤后进行软排序并生成选择理由 | 无音频视频仍能依据画面与 `visualTarget` 选择相关帧；模型不可用时显示降级并交人工选择 |

## 7. 长视频与纯音频

### 7.1 长视频：全局理解 + 分片精读

| 步骤 | 处理 |
|---:|---|
| 1 | 利用标题、章节、字幕和粗采样生成全局目录 |
| 2 | 按章节/话题优先分片，无章节时按可配置时长分片 |
| 3 | 片段间保留少量重叠，避免切断一句话或操作过程 |
| 4 | 每片生成语义时刻、证据候选和候选 Skill |
| 5 | 跨片段去重、合并，建立层级与关系 |
| 6 | 单片失败只重试该片，不重新处理完整视频 |

| 参数 | 待审核建议值 | 性质 |
|---|---:|---|
| 单片时长 | 10～20 分钟 | 配置项，不硬编码 |
| 片段重叠 | 20～30 秒 | 配置项 |
| 每片语义时刻 | 最多 8 个 | 成本保护上限 |
| 每时刻候选帧 | 3～6 张 | 候选召回范围 |
| 最终证据帧 | 1～2 张 | 运行时按需加载 |

M1 保证审核确定上限内的单个 video 或 audio 闭环；长媒体数据契约和任务类型在 M1 设计好，超长媒体自动章节化与批量处理放 M1.1/M2，避免扩大 M1 必交付。

### 7.2 播客/纯音频

| 能力 | 规则 |
|---|---|
| 媒体输入 | M1 支持 MP3、WAV、M4A 等经白名单和真实文件签名验证的常见音频格式 |
| 规范化 | 媒体探测后转换到 ASR 支持的采样率、声道和编码，原文件仍按保留策略保存 |
| 转录 | M1 强制分段级时间戳 ASR；文本可编辑，每段可回放原音频范围 |
| 蒸馏 | 提取话题、重点观点、案例、步骤、反例、限制和结论 |
| 证据 | 形成“音频证据卡”，可回到对应时间段 |
| 视觉 | 有封面、章节图或演示资料时可附加；没有时不制造截图 |
| 低置信度/失败 | 逐段显示置信度并允许人工校正；失败可重试，未校正内容不得生成有来源的文本断言 |
| 说话人 | diarization 可选，失败不阻塞；稳定说话人分离放 M1.1 |
| 范围 | 单个纯音频属于 M1；批量播客、逐字时间戳、情绪/声学事件/音乐结构分析不属于 M1 |

“多模态”表示按来源保留可用模态，不要求每个 Skill 强行同时包含文字、图片、音频和代码。

## 8. 总体架构与职责边界

### 8.1 组件分工

| 组件 | 负责 | 不负责 |
|---|---|---|
| EduSkill 前端 | 上传、进度、证据预览、候选编辑、确认、测试和发布入口 | 不保存正式任务状态，不直接操作 MinIO |
| Node/TypeScript 主平台 | 登录态、对象归属、业务状态、数据库真相、模型适配、语义窗口、候选验证、Skill 蒸馏、发布、Arena | 不执行耗时媒体转码和物理抽帧 |
| PostgreSQL | 会话、状态、任务租约、版本、对象键、摘要、约束和必要索引 | 不保存视频/音频等大文件二进制 |
| Python media worker/adapter | `ffprobe`、视频/音频规范化、视频音轨提取、Whisper/可替换 ASR、候选帧物化、图像质量检测、必要的视觉批处理和产物上传 | 不维护自己的业务 JSON 数据库，不管理用户/权限，不发布 Skill，不负责版本和 Arena |
| MinIO/S3 | 原视频、音频、转录文件、候选帧、选中帧、代码和 manifest | 不是业务数据库，也不是 AI |
| 多模态模型适配层 | 原生视频理解、识图、文本蒸馏的统一调用、JSON Schema 校验和降级 | 不绑定单一厂商 |

### 8.2 M1 统一技术流程

```text
单一 video/audio 主资源
→ media probe
→ 音频规范化 / 分段级时间戳 ASR / 转录编辑 / 章节与主题边界
→ 教学语义时间窗口
→（video 分支）视觉联合候选 / 确定性质量过滤 / 视觉模型排序
→ 统一 evidence timeline
→ Adler 四层全局概览 + 第一次用户确认
→ 框架 / 原理 / 案例 / 反例 / 术语五路候选提取
→ V1 / V2 / V3 三重验证
→ 用户筛选与第二次确认
→ RIA++ Skill
→ depends-on / contrasts-with / composes-with 关系
→ Arena 压力测试
→ 发布确认
→ 不可变 Skill Version / Package Version
```

无音轨视频在 media probe 后显式跳过音频规范化和 ASR，使用原生视频理解或“粗采样帧 + 时间轴”形成视觉语义窗口；纯音频跳过所有 frame 相关步骤。任何降级都必须写入会话、manifest 和 UI。

### 8.3 Node 与 Python media worker 协作

`Node 创建 media_prepare/transcribe 任务`

`→ Worker 回写规范视频、音频和转录 manifest`

`→ Node 校验转录并编排模型生成 semanticMoments`

`→ video 分支由 Node 创建 frame_materialize/media_quality_check 任务`

`→ Worker 生成并过滤候选帧`

`→ Node 识图确认、统一 evidence timeline、候选验证和 Skill 蒸馏`

Python 每实例默认并发 1，通过增加 Worker 副本横向扩容。所有副本使用同一 Job Contract、共享 PostgreSQL 任务队列和对象存储，不共享本地磁盘，也不绑定固定 Session。它是可替换的 media worker/adapter，不是 sidecar 形式的第二套后端。M1 不照搬旧分支“FastAPI + 每任务 daemon thread + `data/jobs/<id>.json`”作为正式任务状态，也不引入复杂消息队列。

M1 的恢复目标是“任一 Worker 可重新执行任一任务”，不是精确断点续算。数据库只持久化任务级状态、租约、心跳、粗粒度进度、输入/输出 manifest、错误和取消请求；FFmpeg 进程、Whisper 模型对象、GPU 显存、当前内存游标和本地临时文件允许随 Worker 销毁而丢失。Worker 崩溃后租约过期，其他副本从任务起点重新执行。若未来真实成本证明必须分片恢复，应把分片拆成独立幂等 Job，而不是持久化 Python 内存或新增 checkpoint 表。

用户启动媒体处理时，Node 在短事务内创建 Job 并立即返回已受理状态，不阻塞等待 Worker 完成，也不轮询某个固定 Worker。Worker 通过内部 `claim` 主动领取任务，通过 `heartbeat` 主动续租和回报进度，通过 `complete/fail` 主动提交结果。前端只连接 Node：优先接收 SSE 进度事件，断线或重载后通过 Session/Job 详情查询恢复，不直接连接 Python Worker。

| 状态/数据 | 唯一持久化位置 | Worker 重启后的处理 |
|---|---|---|
| Session 业务阶段、修订号和发布结果 | PostgreSQL 创建会话/版本链 | Node 继续按状态机编排 |
| Job 状态、租约、心跳、任务级进度、输入/输出引用、错误和取消请求 | PostgreSQL `skill_media_jobs` | 新副本重新领取并校验租约 |
| 原始媒体、规范媒体、转录、帧和 manifest | 对象存储 | 新副本按对象引用重新读取；对象永久保留 |
| FFmpeg PID、已加载模型、GPU 张量、内存游标和本地临时文件 | Worker 内存/临时磁盘，仅限当前执行 | 允许丢失，不作为恢复依据，任务从头重试 |
| Worker 健康度、CPU/GPU、处理耗时 | 结构化日志与监控指标 | 仅用于运维，不作为业务状态真相 |

| Job contract 项 | 要求 |
|---|---|
| 输入 | `jobId/jobType/idempotencyKey/inputManifest/processorConfig`，对象引用必须限制在所属会话前缀 |
| 进度 | 心跳携带阶段、百分比和非敏感说明，Node 持久化为业务可读状态 |
| 输出 | 规范化 manifest、对象键、SHA-256、媒体参数、分段转录或候选帧质量结果 |
| 失败 | 稳定错误码、是否可重试、失败范围和降级建议；禁止原参数无限重试 |
| 取消 | Worker 在领取、心跳和阶段边界检查取消；取消后的迟到回写由 Node 拒绝 |

## 9. 模型适配层

| 能力 | 方案 |
|---|---|
| 原生视频理解 | 模型正式 API 支持时，适配器上传或引用完整视频/分片并返回结构化语义时刻 |
| 兼容理解 | 使用转录、粗采样帧、标题、章节和时间轴组合输入 |
| 候选帧判断 | 可使用 Kimi K2.5 等具备图片理解能力的模型选择与 `visualTarget` 最相关的帧 |
| 文本蒸馏 | 可与视频理解、识图使用不同模型 |
| 能力检测 | 启动时/调用前检测模型是否支持图片、视频、最大输入和 JSON 输出 |
| 私有帧传递 | 对象存储保持私有；Node 在模型调用时重新校验 object key、大小、MIME 和 SHA-256，再生成有大小上限的临时内联图片数据。内联数据和签名 URL 均不得入库或写日志 |
| 事实信任边界 | Node 根据证据类型、人工编辑状态和转录置信度计算 `sourceFactEligibleEvidenceIds`，作为穷尽白名单传给 Adler 和五路候选模型；模型不得自行扩大白名单 |
| 候选证据上下文 | 五路候选只携带已确认 Adler Overview 实际引用的证据；若 Overview 未引用任何证据才回退完整证据时间线。Node 同时传递按时间线稳定排序的 `allowedEvidenceIds` 穷尽白名单，减少长视频提示词体积并禁止模型杜撰证据 ID |
| 候选验证上下文 | 每条 V1/V2/V3 校验只携带该候选 `evidenceIds` 实际引用且已由共享契约验证存在的证据；引用缺失时直接失败，不回退完整时间线，不允许模型访问无关证据来补写结论 |
| 输出校验 | 所有结构化输出经过 JSON Schema 校验；格式修复仍失败则明确报错 |
| 保守纠偏 | 模型把白名单外证据误标为 `sourceFact` 时，只允许确定性降级为 `modelInference`；未知/重复/超量 evidence ID、越界字段和额外键仍必须拒绝，禁止通过“修复”提升事实可信度 |
| 视觉断言纠偏 | 候选标记 `visualAssertion=true` 却未引用任何 frame 证据时，只允许确定性降级为 `false`；不得自动补猜图片证据或把视觉推断提升为来源事实 |
| 候选契约纠错 | 五路候选任一路首次响应违反共享严格契约时，允许且只允许一次“整包重生成”：输入包含原始请求和前次无效 payload，要求重新生成完整候选数组。禁止丢弃单条候选、截断超过上限的 evidence ID、把未知 ID 模糊映射到相似 ID；第二次仍不合法则该阶段失败并保留可恢复错误 |
| 校验契约纠错 | 单条 V1/V2/V3 首次响应违反候选 ID、精确字段、字符串/数组上限或 capability 契约时，同样只允许一次整包重生成，并仅反馈安全的字段路径与违规类别；不得改写验证结论来强行通过，第二次仍不合法则整个校验阶段失败并可从该阶段恢复 |
| 可复现信息 | 保存模型、参数、Prompt 版本、生成器版本、处理器版本、frame extractor 版本和来源摘要 |
| 降级可见 | 原生视频、兼容模式、无转录、无视觉、部分结果均写入 manifest 并显示给用户 |

**Kimi 边界：**具备图片理解能力不代表正式 API 支持原生长视频。是否用于完整视频理解必须依据正式 API 能力验证，不能用“能识图”推导“能看长视频”。

外部 AI 服务出现超时、限流、token 用尽、空响应或无效 JSON 时，应按错误类型缩短分片、切换兼容模式、退避或停止；不得用完全相同参数无上限重试。

## 10. 多模态 Skill 数据契约

### 10.1 向后兼容的逻辑结构

`skillMd` 继续作为现有 Skill 的规范文字内容，不再另造同义 `text` 字段。新字段全部可选，旧 Skill 只有 `skillMd` 时仍然有效。

| 字段 | 类型 | 作用 | 旧 Skill 兼容 |
|---|---|---|---|
| `id/dirName/name/description/skillMd` | 现有字段 | 现有 Skill 基本内容 | 完全保留 |
| `metadata` | object? | schema 版本、语言、作者确认信息 | 缺失时使用旧逻辑 |
| `taxonomyPath` | string[]? | 分类路径 | 缺失时不参与分类筛选 |
| `tags` | string[]? | 轻量检索标签 | 缺失时使用名称和描述 |
| `applicability` | object? | 适用对象、任务、前置条件和不适用范围 | 缺失时仅展示现有描述 |
| `visualRefs` | AssetRef[]? | 图片/关键帧及证据定位 | 缺失时为纯文本 Skill |
| `codeRefs` | AssetRef[]? | 可执行或可适配代码及运行要求 | 缺失时不加载代码 |
| `audioRefs` | AssetRef[]? | 可选音频证据 | 缺失时不加载音频 |
| `relations` | object[]? | `depends-on`、`contrasts-with`、`composes-with` 关系及目标 Skill 标识 | 缺失时按独立 Skill 运行；M1 不新增关系表 |
| `provenance` | object? | 来源素材、时间段/页码、事实/推断/用户补充分型 | 缺失时按旧版本展示 |
| `validation` | object? | 确定性门禁、Arena 测试和人工确认摘要 | 缺失时显示“旧版本未记录” |
| `generation` | object? | generator/model/prompt/processor 版本与参数摘要 | 缺失不影响运行 |

```json
{
  "id": "slope-visual-explanation",
  "dirName": "slope-visual-explanation",
  "name": "用切线图解释斜率变化",
  "description": "在学习者难以理解变化率时使用",
  "skillMd": "# 使用条件\n...",
  "metadata": { "schemaVersion": 2, "language": "zh-CN" },
  "taxonomyPath": ["数学", "函数", "变化率"],
  "tags": ["斜率", "函数图像"],
  "applicability": {
    "tasks": ["解释斜率变化"],
    "constraints": ["需要可显示坐标图"]
  },
  "visualRefs": [
    {
      "assetId": "visual-01",
      "objectKey": "skill-versions/501/visual/visual-01.jpg",
      "sha256": "...",
      "mimeType": "image/jpeg",
      "sizeBytes": 182340,
      "evidenceIds": ["evidence-07"]
    }
  ],
  "codeRefs": [],
  "audioRefs": [],
  "provenance": {
    "sourceAssetIds": ["source-01"],
    "evidenceIds": ["evidence-07"],
    "facts": ["source_fact"],
    "inferences": []
  },
  "validation": { "hardGate": "passed", "reviewedByUser": true },
  "generation": {
    "generatorVersion": "skill-pack-v1",
    "model": "configured-model",
    "promptVersion": "distill-v1",
    "processorVersion": "media-v1"
  }
}
```

### 10.2 不可变规则与渐进加载

| 规则 | 要求 |
|---|---|
| 发布快照 | Skill Version 固定文字、资产清单、SHA-256、证据、生成配置和校验结果 |
| 工作区变化 | 素材替换、逻辑删除或重新处理不得改变已发布版本 |
| 回退 | 创建新的 Skill Version，并记录 `basedOnVersionId`；不覆盖旧版本 |
| Arena | Thread 继续固定 `packageVersionId` 和左右 `skillVersionId` |
| 运行时第一步 | 只检索名称、描述、标签、适用范围、分类路径等轻量信息 |
| 运行时第二步 | 选中 Skill 后再加载 `skillMd`、相关图片、代码和音频证据 |
| Removed/Discarded | 历史版本仍可复查，不自动换成另一个对象代替 |

### 10.3 M1 媒体与证据时间线契约

| 路径 | 类型/必填 | 说明 |
|---|---|---|
| `primarySource.kind` | `video \| audio`，必填 | 一次会话只能有一个主要源 |
| `primarySource.assetRef` | object，必填 | 原始对象键、MIME、大小和可信 SHA-256 |
| `transcript.status` | string，必填 | `pending/ready/low_confidence/failed/not_applicable` |
| `transcript.editable` | boolean，必填 | M1 必须为 true，人工修改要增加会话修订号 |
| `transcript.segments[]` | array，video 有音轨或 audio 时必填 | 每段至少有 `startMs/endMs/text`，可选 `speaker/confidence` |
| `evidenceTimeline.evidenceItems[]` | array，必填 | 按时间排序的统一证据；`kind` 为 `transcript/audio_segment/frame` |
| `evidenceItems[].source` | object，必填 | 指向主要源和派生产物，不接受客户端用户归属字段 |
| `evidenceItems[].timeRange` | object，必填 | `startMs/endMs`，用于定位和回放 |
| `evidenceItems[].assetRef` | object，按 kind 必填 | `audio_segment` 指向可回放音频，`frame` 指向不可变图片；transcript 可指向转录对象 |
| `evidenceItems[].provenance` | object，必填 | 提取方式、模型/处理器版本、置信度、人工修改和事实/推断类型 |

```json
{
  "primarySource": {
    "kind": "audio",
    "assetRef": {
      "objectKey": "skill-sessions/123/source/lesson.m4a",
      "mimeType": "audio/mp4",
      "sizeBytes": 12345678,
      "sha256": "..."
    }
  },
  "transcript": {
    "status": "ready",
    "editable": true,
    "segments": [
      {
        "startMs": 1200,
        "endMs": 8600,
        "text": "先判断这个方法的适用条件。",
        "speaker": null,
        "confidence": 0.91
      }
    ]
  },
  "evidenceTimeline": {
    "evidenceItems": [
      {
        "evidenceId": "evidence-01",
        "kind": "audio_segment",
        "source": { "primarySourceId": "source-01" },
        "timeRange": { "startMs": 1200, "endMs": 8600 },
        "assetRef": { "objectKey": "skill-sessions/123/audio/normalized.flac" },
        "provenance": {
          "method": "asr",
          "processorVersion": "media-v1",
          "claimType": "sourceFact"
        }
      }
    ]
  }
}
```

纯音频没有 frame 不构成质量缺失，不能因此阻止发布；视频若生成“画面显示、板书写出、图表呈现”等视觉断言，则对应规则必须至少关联一个 `frame` evidence item。低置信度或失败 ASR 在人工校正前不能作为确定来源支撑文本断言。

## 11. 最小数据库方案

### 11.1 总体决定

| 对象 | V2 处理 |
|---|---|
| Pack/业务运行 | 复用 `skill_guided_creation_sessions`；产品上称 Skill Pack，工程上仍是创建会话 |
| 创建对话 | 继续复用 `skill_guided_creation_messages`；媒体证据不塞进聊天消息 |
| 主要源、转录、证据时间线、Adler Overview、五路候选、V1/V2/V3、RIA++、关系和模型 manifest | M1 工作态放 `media_state_json`，发布态复制进不可变 Skill Version 快照 |
| Worker 任务与租约 | 新增一张 `skill_media_jobs` |
| Package/Skill/版本/成员关系 | 复用现有表 |
| 审计 | 复用会话修订、版本记录和平台结构化审计日志；不新增 `audit_events` |
| 不新增 | `audio`、`transcript`、`frame`、`evidence`、`skill_relation` 专用业务表，也不新增 `skill_packs`、`runs`、`candidates`、`artifacts`、`evidence_links`、`pack_members`、`publish_records` 等平行表 |
| 约束策略 | 新增/改造范围内禁止使用 FK 和 CHECK；允许使用必要的 UNIQUE 与索引保障幂等和唯一性；归属、状态和引用关系由服务层校验 |
| 数据库编程边界 | 新增/改造范围内不使用存储过程和触发器；业务状态转换、引用校验和副作用编排由 Node 服务、事务与 Worker 合同负责 |

业务运行和 Worker 任务仍是两个概念：创建会话负责用户流程、确认和发布；`skill_media_jobs` 只负责可租赁、可重试的媒体计算。它们不会混成一套状态。

**可审核决定：本次多模态 Skill Pack 新增/改造范围明确禁止使用 FK 和 CHECK，仅允许使用必要的 UNIQUE 与索引。**当前 EduSkill 仓库中已有 FK/CHECK 不在本次删除或重构范围内，保持旧代码兼容；新字段、新表和新迁移不得新增或依赖 FK/CHECK。归属、状态、JSON 结构、版本一致性和引用有效性统一由服务层、运行时 Schema、事务与状态机校验负责。

### 11.2 复用 `skill_guided_creation_sessions`

#### 已有关键字段继续使用

| 字段 | 类型 | 必填/默认 | 用途 | 约束/索引 |
|---|---|---|---|---|
| `id` | bigserial | 必填 | Pack 工作容器 ID | 主键 |
| `user_id` | text | 必填 | 归属用户 | 现有用户/状态索引；权限唯一来源之一 |
| `status` | text | 默认 `collecting` | 顶层状态 | 新增/改造不使用 CHECK；由服务层状态机校验 collecting/ready_for_confirmation/finalizing/completed/failed/cancelled |
| `documents_json` | jsonb | 默认 `[]` | 旧引导创建文档 | 保持原义，不塞媒体二进制 |
| `draft_json` | jsonb | 默认 `{}` | 旧引导创建草稿 | 保持原义 |
| `field_states_json` | jsonb | 默认 `{}` | 旧引导草稿字段状态 | 由运行时 Schema 校验 JSON object，保持原义 |
| `model` | text | 可空 | 旧引导创建所用模型 | 不作为多模态模型 manifest 的唯一来源 |
| `start_client_message_id` | text | 可空 | 现有创建请求键；新媒体 API 将 `idempotencyKey` 映射到此字段 | 现有部分唯一索引 `(user_id, start_client_message_id)`；当前代码没有请求 hash，单独使用不能识别同键异参 |
| `flow_version` | integer | 默认 1 | 创建流程版本 | `>= 1` |
| `confirmed_stages_json` | jsonb | 默认 `[]` | 人工确认进度 | 由运行时 Schema 校验 JSON array |
| `display_name` | varchar(200) | 可空 | 用户可见名称 | 长度上限 200 |
| `confirmation_json` | jsonb | 可空 | 旧引导最终确认卡 | 由运行时 Schema 校验 JSON object，保持旧兼容 |
| `generated_snapshot_json` | jsonb | 可空 | 发布前生成快照 | 由运行时 Schema 校验 JSON object |
| `validation_result_json` | jsonb | 可空 | 质量门禁与测试摘要 | 由运行时 Schema 校验 JSON object |
| `package_id` | bigint | 可空 | 发布后 Package | 新增/改造不建立 FK；由服务层校验归属，必要的一对一关系使用 UNIQUE |
| `skill_id` | bigint | 可空 | M1 主要 Skill | 新增/改造不建立 FK；由服务层校验归属，必要的唯一性使用 UNIQUE |
| `skill_version_id` | bigint | 可空 | 发布结果 | 新增/改造不建立 FK；由发布事务和服务层校验引用有效性 |
| `revision_no` | integer | 默认 0 | 乐观并发控制 | `>= 0` |
| `finalize_request_id` | text | 可空 | 现有发布请求键 | 当前代码没有发布请求 hash，单独使用不能识别同键异参 |
| `error_json` | jsonb | 可空 | 明确失败与恢复点 | 由运行时 Schema 校验 JSON object |
| `deleted_at` | timestamptz | 可空 | 逻辑删除 | 列表默认排除 |
| `created_at` | timestamptz | 必填，默认 now | 创建时间 | 现有字段 |
| `updated_at` | timestamptz | 必填，默认 now | 最后更新时间 | 用户/状态索引使用 |
| `completed_at` | timestamptz | 可空 | 发布完成时间 | 仅完成后设置 |

#### M1 最小新增字段

| 字段 | 类型 | 必填/默认 | 含义 | 约束/索引 |
|---|---|---|---|---|
| `creation_mode` | text | 必填，默认 `guided` | 区分旧引导创建与多模态蒸馏 | 由服务层校验 `guided`、`multimodal_distill`；旧数据回填 `guided` |
| `start_request_hash` | text | 旧会话可空；新媒体创建必填 | 服务端对规范化创建请求计算的 SHA-256 摘要 | 与 `start_client_message_id` 配对；由服务层校验 64 位小写十六进制，同键同 hash 返回旧会话，同键不同 hash 返回 409 |
| `media_stage` | text | 可空 | 多模态细阶段；旧会话为空 | 由服务层状态机校验；不替换现有 `status` |
| `media_state_json` | jsonb | 必填，默认 `{}` | 单个主要源、派生产物、Overview、语义时刻、证据卡、候选、模型 manifest、降级与有界的阶段操作回执 | 由运行时 Schema 校验 JSON object；不承载用户归属、租约、最终版本 ID，也不保存创建/发布关键请求摘要 |
| `package_version_id` | bigint | 可空 | 本次发布产生的 Package Version | 新增/改造不建立 FK；由发布事务和服务层校验属于目标 Package |
| `finalize_request_hash` | text | 旧会话/未发布会话可空；新媒体发布时必填 | 服务端对规范化发布请求计算的 SHA-256 摘要 | 与 `finalize_request_id` 配对；由服务层校验二者同时存在且 hash 为 64 位小写十六进制，同键同 hash 返回旧版本，同键不同 hash 返回 409 |

建议索引：`(user_id, creation_mode, updated_at desc) where deleted_at is null`。不新增 `current_run_id/current_job_id`；当前任务通过 `session_id + status + created_at` 查询，引用和归属由服务层校验。

`media_state_json` 建议结构：

```json
{
  "schemaVersion": 1,
  "primarySource": {
    "kind": "video"
  },
  "derivedArtifacts": {
    "normalizedMedia": [],
    "normalizedAudio": [],
    "transcripts": [],
    "candidateFrames": [],
    "selectedFrames": [],
    "manifests": []
  },
  "transcript": {
    "status": "pending",
    "editable": true,
    "segments": []
  },
  "evidenceTimeline": {
    "evidenceItems": []
  },
  "overview": {},
  "adlerOverview": {},
  "chunks": [],
  "semanticMoments": [],
  "candidatePasses": {
    "frameworks": [],
    "principles": [],
    "cases": [],
    "counterexamples": [],
    "terms": []
  },
  "candidateValidations": [],
  "candidateSkills": [],
  "skillRelations": [],
  "modelManifest": {},
  "qualityGate": {},
  "arenaResult": {},
  "degradation": [],
  "operationReceipts": []
}
```

`primarySource` 在 M1 必须为空或单个对象，不能改为数组；`derivedArtifacts` 只能引用该主要源产生的规范媒体、转录、帧和 manifest。五路候选、验证结果和 Skill 关系优先在同一会话 JSONB 中表达，不新增业务表。`operationReceipts` 仅保存有数量上限的非关键阶段操作回执，创建和发布请求摘要必须使用正式列。JSONB 只用于会话内整体读取的工作态和扩展信息；用户归属、主状态、修订号、任务租约和最终版本 ID 仍是正式列。

### 11.3 新表 `skill_media_jobs`

| 字段 | 类型 | 必填/默认 | 含义 | 约束/索引 |
|---|---|---|---|---|
| `id` | bigserial | 必填 | 媒体任务 ID | 主键 |
| `session_id` | bigint | 必填 | 所属创建会话 | 不建立 FK；创建和领取任务时由服务层校验会话归属与有效状态 |
| `job_type` | text | 必填 | `media_prepare`、`transcribe`、`frame_materialize`、`media_quality_check` | 由任务服务层校验允许值 |
| `status` | text | 默认 `queued` | `queued`、`leased`、`succeeded`、`failed`、`cancelled` | 由任务状态机校验允许转换 |
| `idempotency_key` | text | 必填 | 同一业务动作的幂等键 | UNIQUE `(session_id, job_type, idempotency_key)` |
| `request_hash` | text | 必填 | 规范化请求摘要 | 同键不同 hash 返回 409 |
| `attempt_no` | integer | 默认 0 | 已领取次数 | 由服务层校验非负且不超过 `max_attempts` |
| `max_attempts` | integer | 默认 3 | 最大领取次数 | 由服务层校验 `1～10`，部署可配置默认值 |
| `available_at` | timestamptz | 默认 now | 退避后可再次领取时间 | 领取索引 `(status, available_at, job_type, created_at)` |
| `lease_owner` | text | 可空 | Worker 实例标识 | 仅 leased 时存在 |
| `lease_token_hash` | text | 可空 | 租约令牌摘要 | 日志不得输出原令牌 |
| `lease_expires_at` | timestamptz | 可空 | 租约过期时间 | 部分索引：leased + 过期时间 |
| `heartbeat_at` | timestamptz | 可空 | 最近心跳 | 仅合法租约可更新 |
| `progress_json` | jsonb | 默认 `{}` | 阶段、百分比和非敏感提示 | 由运行时 Schema 校验 JSON object |
| `input_manifest_json` | jsonb | 默认 `{}` | 受控输入对象和参数 | 由运行时 Schema 校验 JSON object |
| `output_manifest_json` | jsonb | 可空 | 产物对象、SHA-256、媒体信息 | 由运行时 Schema 校验 JSON object |
| `result_hash` | text | 可空 | 完成结果摘要 | 重复回写一致性检查 |
| `error_json` | jsonb | 可空 | 稳定错误码、可读信息、重试建议 | 由运行时 Schema 校验 JSON object |
| `cancel_requested_at` | timestamptz | 可空 | 取消信号 | Worker 心跳时检查 |
| `started_at` | timestamptz | 可空 | 首次开始时间 | 运维指标 |
| `finished_at` | timestamptz | 可空 | 成功/失败/取消时间 | 由任务状态机校验终态写入 |
| `created_at` | timestamptz | 默认 now | 创建时间 | 会话索引 `(session_id, created_at desc)` |
| `updated_at` | timestamptz | 默认 now | 更新时间 | 心跳/状态更新 |

### 11.4 租约、重复消费和崩溃恢复

| 风险 | 处理规则 |
|---|---|
| 两个 Worker 同时领取 | `FOR UPDATE SKIP LOCKED` 原子领取，只返回一个租约 |
| Worker 崩溃 | `lease_expires_at` 到期且未达 `max_attempts` 时，以单条原子更新转回 queued，同时清空 `lease_owner`、`lease_token_hash`、`lease_expires_at`、`heartbeat_at` 并设置下一次 `available_at`；超过最大次数转 failed |
| Worker 本地状态丢失 | 不恢复 Python 内存、FFmpeg 进程、GPU 状态或本地临时文件；新副本依据数据库任务输入和对象存储从任务起点重新执行 |
| 横向扩容 | 任意同能力副本都可领取任意匹配任务；副本之间不通信、不共享本地磁盘、不持有 Session 亲和性 |
| 重复领取 | 每次产生新租约令牌；旧令牌回写返回 `JOB_LEASE_CONFLICT` |
| 重复完成回调 | 同 `result_hash` 返回已完成结果；不同结果返回冲突，不覆盖 |
| 取消后迟到回写 | 同时校验 job 状态、会话状态、`deleted_at` 和租约；拒绝写入工作态 |
| 原参数无脑重试 | 禁止。按错误类型退避、缩小分片或切换降级模式 |
| 处理中删除 | 会话逻辑删除，queued 任务取消，leased 任务设置取消请求，产物标记为 `orphaned/unreferenced` 但永久保留 |

`succeeded`、`failed`、`cancelled` 都是终态，租约扫描器不得把终态任务重新放回 queued。回收条件、清空租约字段、增加尝试次数和设置退避时间必须在同一数据库语句/事务中完成，避免新 Worker 领取到带旧租约残留的任务。

### 11.5 发布与版本事务

| 顺序 | 要求 |
|---:|---|
| 1 | 校验用户归属、三个确认点、硬门禁、`revisionNo`、`expectedPackageVersionId` 和幂等键 |
| 2 | 将选中资产复制或固化到不可变版本对象路径，并复核 SHA-256；未完成前不创建数据库版本 |
| 3 | 单一 PostgreSQL 事务创建/更新 Agent Package、Package Version、Skill、Skill Version、Package-Version-Skill 关系和会话发布结果 |
| 4 | 事务提交后才把结果返回前端；失败则整个数据库事务回滚 |
| 5 | 数据库失败前已固化但未引用的对象标记为 `orphaned/unreferenced`；对象本身永久保留，不执行 GC 删除 |

发布历史不可被覆盖。`Package Version source` 和 `Skill Version source` 增加稳定值 `distilled`；共享 TypeScript 联合类型和服务端校验同步扩展，数据库新增/改造不使用 CHECK。已有来源值保持不变。

### 11.6 迁移与旧数据兼容

| 要求 | 方案 |
|---|---|
| 可重复执行 | `ADD COLUMN IF NOT EXISTS`、`CREATE TABLE/INDEX IF NOT EXISTS`；必要唯一性使用 `CREATE UNIQUE INDEX IF NOT EXISTS`，迁移不得新增 FK/CHECK |
| 幂等摘要字段 | 重复安全地增加 `start_request_hash`、`finalize_request_hash`；旧会话允许为空，新 `multimodal_distill` 创建/发布由服务端强制写入；不得伪造旧请求 hash |
| 旧会话 | `creation_mode` 默认并回填 `guided`，`media_stage` 为空，旧流程不读取 `media_state_json`；现有 `start_client_message_id/finalize_request_id` 行保持兼容 |
| 旧 Skill | 新快照字段全部可选，只有 `skillMd` 仍可运行和回退 |
| 旧 action/前端 | 请求和响应保持原样；新 UI 受功能开关保护 |
| 回滚 | 可关闭入口和 Worker；不删除新列/表；共享 TypeScript 联合类型与服务端 source 校验继续兼容 `distilled` 和已有来源值，避免破坏已发布数据 |
| 孤儿文件 | 标记为 `orphaned/unreferenced` 并保留对象；不执行物理删除，后台只维护登记、访问状态和审计信息 |

## 12. MinIO 与对象存储

### 12.1 通俗解释

MinIO 是保存视频、图片、DOCX、音频、关键帧等大文件的“文件仓库”。它不是业务数据库，也不是 AI。

| 存储 | 保存内容 |
|---|---|
| PostgreSQL | 名称、用户归属、状态、版本、任务租约、对象键、摘要、证据关系和校验结果 |
| MinIO/S3 | 视频、音频、转录文件、关键帧、图片、代码包和 manifest 等实际二进制 |

不能简单把大文件放数据库：会拖慢备份、恢复和迁移。也不能放项目目录：多实例无法稳定共享，容器重建或发布可能丢失。普通用户不直接操作 MinIO，前端仍只显示上传、处理结果和证据预览。

| 环境 | 建议 |
|---|---|
| 本地 Docker | MinIO |
| 自动化测试 | 临时本地存储或内存 Fake，测试结束清理 |
| 生产 | 部署方选择 MinIO、阿里云 OSS、腾讯云 COS、AWS S3 等 S3 兼容存储 |

### 12.2 建议对象路径

```text
skill-sessions/{sessionId}/source/
skill-sessions/{sessionId}/audio/
skill-sessions/{sessionId}/transcript/
skill-sessions/{sessionId}/frames/candidates/
skill-sessions/{sessionId}/frames/selected/
skill-sessions/{sessionId}/manifest/
skill-versions/{versionId}/visual/
skill-versions/{versionId}/code/
skill-versions/{versionId}/audio/
```

工作区对象和发布版本对象语义分开，但两者都永久保留。`skill-sessions` 对象可以被标记为失效/不可用并从当前工作态中移除引用；`skill-versions` 受版本引用保护且同样不得物理删除。

### 12.3 文件链路与校验

| 步骤 | 安全要求 |
|---:|---|
| 上传申请 | 校验登录态、会话归属、文件名、扩展名、声明 MIME、大小、数量；只签发限定对象和短时有效的上传地址 |
| 受控上传 | 大文件使用分片上传并显示进度；取消后中止未完成分片 |
| 服务端确认 | 校验 upload token、对象大小和声明信息，进入“待内容复核” |
| 内容复核 | 服务端/Worker 读取实际内容，校验文件签名、真实 MIME、媒体探测并重新计算 SHA-256 |
| 处理读取 | Worker 只获得当前任务所需的短期读取能力，不持有无限制存储凭证 |
| 产物回写 | 写入限定前缀；manifest 记录对象键、大小、MIME、SHA-256、处理器版本 |
| 证据入库 | PostgreSQL 保存证据卡和对象引用，不保存图片二进制 |
| 版本发布 | 选中资产固化到版本空间，Skill Version 快照固定对象键和 SHA-256 |

客户端 hash 只能作上传体验提示，不能作为可信 SHA-256；S3 ETag 也不能当作 SHA-256，尤其是分片上传时。

前端预览必须先经过用户 → 会话/Package → 素材/版本的权限检查，再获得短期签名 URL。日志不得记录完整签名 URL。

### 12.4 远程 URL 导入

| 检查 | 规则 |
|---|---|
| 协议 | 只允许 HTTP(S) |
| 目标地址 | 拒绝回环、私网、链路本地、保留地址和云元数据地址 |
| DNS | 解析后固定并校验实际连接 IP，防止 DNS 重绑定 |
| 重定向 | 每一跳重新检查协议、域名、DNS 和 IP，不沿用首跳结论 |
| 响应 | 拒绝 HTML/登录页；校验 Content-Type、实际签名和媒体探测 |
| 资源保护 | 设置连接/读取超时、重定向上限、下载体积上限和带宽限制 |
| 合规 | 不绕过登录、Cookie、付费墙、DRM 和第三方平台限制 |

## 13. API 规范

### 13.1 公共约定

| 项目 | 约定 |
|---|---|
| 路径 | 所有新业务和内部 action 均为 `POST /api` |
| 分发 | 显式 action handler 映射，不允许动态函数名执行 |
| 身份 | 用户身份只来自登录态；请求体不接受 `userId/authUserId` 作为身份 |
| 新字段命名 | lowerCamelCase，如 `sessionId`、`expectedRevisionNo`、`idempotencyKey` |
| 数据库命名 | snake_case |
| 响应 | 成功 `{ "success": true, "data": ... }`；失败 `{ "code": "...", "message": "...", "retryable": false }` |
| 幂等 | 新 Mutation 的 `idempotencyKey` 放顶层；服务端先生成规范化请求摘要并持久化，再保证同键同 hash 返回原结果、同键不同 hash 返回 409 |
| 并发 | 编辑用 `expectedRevisionNo`；发布再校验 `expectedPackageVersionId` |
| 状态 | 服务端校验转换，前端不能指定任意下一状态 |

媒体会话创建时还没有 `pkgId`，因此使用 `sessionId` 作为稳定路由字段。发布后服务端从会话绑定关系取得 `package_id`；不信任客户端自行声明归属。

已有 `SkillGuidedCreation*` action 及其历史 snake_case 字段保持原样，这是兼容例外；新媒体 action 不复制旧命名。

#### 规范化请求摘要

请求 hash 由服务端计算，客户端不得上传或指定。服务端应先完成字段校验和默认值解析，再将允许的类型化字段按字段名稳定排序；省略未定义值和传输层 `idempotencyKey`，保留数组顺序，按字段自身规则处理字符串，使用 UTF-8 稳定 JSON 序列化并计算 SHA-256 小写十六进制摘要。

| 场景 | hash 输入 | 正式持久化 |
|---|---|---|
| 创建会话 | `action`、`creationMode`、规范化 `displayName` 和其他允许的创建字段 | `start_request_hash`，与 `start_client_message_id` 配对 |
| 发布 | `action`、`sessionId`、`expectedRevisionNo`、`expectedPackageVersionId`、确认字段及待发布快照/资产 manifest 摘要 | `finalize_request_hash`，与 `finalize_request_id` 配对 |
| 媒体任务 | 类型化任务参数和输入 manifest 摘要 | `skill_media_jobs.request_hash` |
| 编辑/人工确认 | 类型化操作和 `expectedRevisionNo` | 有界 `operationReceipts`；修订号仍是并发主保护 |

数据库唯一冲突后不能只按幂等键取回旧记录：必须同时读取并比较请求 hash。相同则返回原结果；不同则返回 `IDEMPOTENCY_KEY_REUSED`，HTTP 409。

创建冲突查询必须读取 `id + start_request_hash`，不能只取 `id`。发布接口发现会话已经 `completed` 时，也必须先比较 `finalize_request_id + finalize_request_hash`，不能在比较前直接返回已完成会话。

### 13.2 用户 action 清单

| Action | 用途 | 权限与关键请求 | 关键响应 | 主要错误码 |
|---|---|---|---|---|
| `skill.media.session.create` | 创建 Pack 工作容器 | 登录；`idempotencyKey`、`payload.displayName` | `sessionId/revisionNo/mediaStage` | `IDEMPOTENCY_KEY_REUSED` |
| `skill.media.session.list` | 列表 | 登录，只查本人；分页 | 会话摘要列表 | `INVALID_ARGUMENT` |
| `skill.media.session.detail` | 详情/恢复 | 登录 + `sessionId` 归属 | 完整阶段、进度、证据和候选摘要 | `SESSION_NOT_FOUND/FORBIDDEN` |
| `skill.media.upload.intent` | 申请上传一个 video/audio 主要源 | 会话归属；文件名、大小、MIME；音频支持 MP3/WAV/M4A 等白名单格式；已有主要源时必须走显式替换 | upload token、短期 URL、分片信息 | `PRIMARY_SOURCE_ALREADY_EXISTS/FILE_TOO_LARGE/UNSUPPORTED_MEDIA_TYPE` |
| `skill.media.upload.confirm` | 确认上传完成 | 会话归属；upload token | 素材状态 `verifying` | `UPLOAD_NOT_FOUND/FILE_MISMATCH` |
| `skill.media.url.import` | 导入直接视频 URL | 会话归属；URL | 导入任务与进度 | `URL_SSRF_BLOCKED/REMOTE_DOWNLOAD_FAILED` |
| `skill.media.process.start` | 启动处理 | 会话归属；修订号、配置摘要；audio 或有音轨 video 必须执行分段级 ASR | 当前任务和阶段 | `INVALID_STATE_TRANSITION/DUPLICATE_MEDIA` |
| `skill.media.progress` | 查询进度 | 会话归属 | 阶段、百分比、警告、可用操作 | `SESSION_NOT_FOUND` |
| `skill.media.transcript.update` | 人工校正转录片段 | 会话归属；`expectedRevisionNo`、segment 操作和修订原因 | 新 transcript、证据失效提示和修订号 | `TRANSCRIPT_SEGMENT_CONFLICT/SESSION_REVISION_CONFLICT` |
| `skill.media.overview.confirm` | 确认 Overview | 会话归属；修订号、用户修正 | 新修订号、下一阶段 | `SESSION_REVISION_CONFLICT` |
| `skill.media.evidence.update` | 替换/删除/补选证据帧 | 会话归属；修订号、操作 | 更新后的证据卡 | `EVIDENCE_NOT_FOUND/INVALID_STATE_TRANSITION` |
| `skill.media.candidate.update` | 编辑/拆分/合并/废弃候选 | 会话归属；修订号、操作 | 候选摘要与新修订号 | `CANDIDATE_CONFLICT` |
| `skill.media.candidate.confirm` | 确认证据和候选 | 会话归属；修订号 | 固定草稿、进入测试 | `QUALITY_GATE_FAILED` |
| `skill.media.test.start` | 启动门禁/Arena 测试 | 会话归属；修订号、测试配置 | 测试任务/结果 | `TEST_INPUT_INVALID` |
| `skill.media.publish` | 原子发布 | 会话归属；修订号、期望 Package 版本、幂等键 | package/skill/version IDs | `PACKAGE_VERSION_CONFLICT/QUALITY_GATE_FAILED` |
| `skill.media.retry` | 重试失败阶段/分片 | 会话归属；失败任务、修订号 | 新任务与恢复阶段 | `NOT_RETRYABLE` |
| `skill.media.cancel` | 取消处理 | 会话归属；修订号 | cancelled 状态 | `SESSION_REVISION_CONFLICT` |
| `skill.media.session.delete` | 逻辑删除未发布工作区 | 会话归属；修订号 | deletedAt | `PUBLISHED_ASSET_IN_USE` |

### 13.3 内部 Worker action

| Action | 用途 | 认证 | 规则 |
|---|---|---|---|
| `internal.mediaJob.claim` | 领取任务 | 仅内部短期令牌/服务身份 | 原子租约；每实例默认只领取 1 个 |
| `internal.mediaJob.heartbeat` | 续租和回报进度 | 服务身份 + lease token | 只能更新当前租约，不延长已取消任务 |
| `internal.mediaJob.complete` | 回写 manifest | 服务身份 + lease token | 复核 schema、对象前缀、SHA-256 和结果 hash |
| `internal.mediaJob.fail` | 回写稳定错误 | 服务身份 + lease token | 服务端决定重试、退避或终止 |

内部 action 虽使用同一 `POST /api` 入口，但必须与用户登录 token 分开校验；普通用户 token 不能调用，Worker token 也不能调用 Package、Skill、Arena 业务 action。令牌可轮换且只授予 claim/heartbeat/complete/fail 权限。

### 13.4 请求与响应示例

创建会话：

```json
{
  "action": "skill.media.session.create",
  "idempotencyKey": "4e1884b7-43d7-4d75-a4fc-e23ec64ddfd1",
  "payload": {
    "displayName": "函数图像教学视频蒸馏"
  }
}
```

```json
{
  "success": true,
  "data": {
    "sessionId": "123",
    "revisionNo": 0,
    "mediaStage": "draft"
  }
}
```

申请上传：

```json
{
  "action": "skill.media.upload.intent",
  "sessionId": "123",
  "idempotencyKey": "ab1b9eb1-8f4d-4b88-9653-c10c55d41446",
  "payload": {
    "fileName": "lesson.mp4",
    "sizeBytes": 524288000,
    "declaredMimeType": "video/mp4"
  }
}
```

```json
{
  "success": true,
  "data": {
    "uploadToken": "opaque-token",
    "uploadMode": "multipart",
    "expiresAt": "2026-08-20T12:10:00Z",
    "parts": []
  }
}
```

启动处理：

```json
{
  "action": "skill.media.process.start",
  "sessionId": "123",
  "idempotencyKey": "c6d14c09-8bea-4c75-9264-d252343e6f99",
  "payload": {
    "expectedRevisionNo": 2,
    "understandingMode": "auto",
    "transcriptionMode": "deploymentDefault"
  }
}
```

校正转录片段：

```json
{
  "action": "skill.media.transcript.update",
  "sessionId": "123",
  "idempotencyKey": "33ebebfc-f6bb-4ef5-866a-a2ca68c7ea30",
  "payload": {
    "expectedRevisionNo": 4,
    "segmentId": "segment-08",
    "text": "先判断这个方法的适用条件。",
    "editReason": "修正低置信度术语"
  }
}
```

确认 Overview：

```json
{
  "action": "skill.media.overview.confirm",
  "sessionId": "123",
  "idempotencyKey": "8aa3f4f0-bae0-4984-bd68-8a93849bb94c",
  "payload": {
    "expectedRevisionNo": 5,
    "overview": {
      "title": "用图像理解斜率",
      "approved": true,
      "userNotes": "重点保留切线变化示例"
    }
  }
}
```

编辑候选：

```json
{
  "action": "skill.media.candidate.update",
  "sessionId": "123",
  "idempotencyKey": "ba934099-af3d-4dc3-8249-316bd4a1aed6",
  "payload": {
    "expectedRevisionNo": 8,
    "operation": "merge",
    "candidateIds": ["candidate-02", "candidate-03"],
    "title": "用图像和反例解释斜率变化"
  }
}
```

发布：

```json
{
  "action": "skill.media.publish",
  "sessionId": "123",
  "idempotencyKey": "b8fd296a-0a9e-476e-a75c-d6a84211b77b",
  "payload": {
    "expectedRevisionNo": 12,
    "expectedPackageVersionId": null,
    "confirmCopyright": true,
    "confirmEvidence": true
  }
}
```

```json
{
  "success": true,
  "data": {
    "packageId": "41",
    "packageVersionId": "90",
    "skillId": "66",
    "skillVersionId": "501",
    "source": "distilled"
  }
}
```

Worker 完成任务：

```json
{
  "action": "internal.mediaJob.complete",
  "payload": {
    "jobId": "3001",
    "leaseToken": "opaque-lease-token",
    "resultHash": "sha256-of-normalized-result",
    "outputManifest": {
      "processorVersion": "media-v1",
      "objects": [
        {
          "objectKey": "skill-sessions/123/transcript/transcript.json",
          "sha256": "...",
          "mimeType": "application/json",
          "sizeBytes": 123456
        }
      ]
    }
  }
}
```

### 13.5 稳定错误码

| HTTP | 错误码 | 含义/前端动作 |
|---:|---|---|
| 401 | `AUTH_REQUIRED` | 重新登录 |
| 403 | `FORBIDDEN` | 无对象权限，不展示对象是否存在 |
| 404 | `SESSION_NOT_FOUND` | 返回列表，不猜测其他用户数据 |
| 409 | `SESSION_REVISION_CONFLICT` | 刷新详情，不自动覆盖 |
| 409 | `INVALID_STATE_TRANSITION` | 刷新阶段，隐藏无效操作 |
| 409 | `IDEMPOTENCY_KEY_REUSED` | 同幂等键参数不同，生成新键后由用户重试 |
| 409 | `PRIMARY_SOURCE_ALREADY_EXISTS` | M1 会话已有主要源；用户需明确替换或另建会话 |
| 409 | `PACKAGE_VERSION_CONFLICT` | 当前版本已变化，刷新 Package/Skill/历史状态 |
| 409 | `JOB_LEASE_CONFLICT` | Worker 丢弃迟到结果 |
| 413 | `FILE_TOO_LARGE` | 显示配置上限 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | 要求更换格式 |
| 422 | `FILE_SIGNATURE_MISMATCH` | 文件扩展名/MIME 与真实内容不符 |
| 422 | `URL_SSRF_BLOCKED` | 不泄露内部网络细节 |
| 422 | `MEDIA_PROBE_FAILED` | 文件损坏或媒体不受支持 |
| 409 | `TRANSCRIPT_SEGMENT_CONFLICT` | 转录已被修改；刷新时间线后重新编辑 |
| 422 | `ASR_LOW_CONFIDENCE` | 标记低置信度片段，允许回放和人工校正，不自动生成来源断言 |
| 502 | `ASR_FAILED` | 显示失败范围、重试和允许的降级路径 |
| 422 | `NO_USABLE_CONTENT` | 允许补材料或取消，不生成空 Skill |
| 422 | `QUALITY_GATE_FAILED` | 只能保存草稿，显示未通过项 |
| 429 | `MODEL_RATE_LIMITED` | 按服务端建议等待，不连续点击 |
| 502 | `MODEL_OUTPUT_INVALID` | 显示可重试/换模型/缩小分片选项 |
| 504 | `JOB_TIMEOUT` | 重试失败任务或失败分片 |

## 14. 状态、并发与幂等

### 14.1 状态机

顶层继续使用现有 `status`；`media_stage` 只提供多模态细阶段。

| `status` | 可对应的 `media_stage` | 含义 |
|---|---|---|
| `collecting` | `draft/uploading/ready_to_process/preparing_media/transcribing/reviewing_transcript/building_semantic_windows/building_evidence/building_adler/extracting_candidates/validating_candidates/building_skills/arena_testing/ready_to_publish` | 用户仍可继续工作 |
| `ready_for_confirmation` | `awaiting_adler_overview/awaiting_candidates/ready_to_publish` | 等待三类人工确认之一 |
| `finalizing` | `publishing` | 正在固化资产和提交版本事务 |
| `completed` | `published` | 已发布 |
| `failed` | `failed` | 保存 `resumeFromStage` 和稳定错误 |
| `cancelled` | `cancelled` | 不接受新的 Worker 回写 |

主转换：

`draft → uploading → ready_to_process → preparing_media → transcribing/reviewing_transcript → building_semantic_windows → building_evidence → building_adler → awaiting_adler_overview → extracting_candidates → validating_candidates → awaiting_candidates → building_skills → arena_testing → ready_to_publish → publishing → published`

无音轨视频可从 `preparing_media` 显式跳过 `transcribing/reviewing_transcript`，但必须记录 visual-only 降级；纯音频跳过 frame 任务但不能跳过 evidence timeline、Adler、候选验证和 Arena。

异步阶段可进入 `failed`；只有服务端确认错误可重试后，才回到 `resumeFromStage`。任何未发布阶段可取消。删除是 `deleted_at` 逻辑状态，不物理删除历史版本。

### 14.2 冲突处理

| 冲突 | 处理 |
|---|---|
| 重复点击 | 按钮 loading/disabled + handler/ref 短路 + 服务端幂等 |
| 多标签编辑 | `expectedRevisionNo` 乐观锁；409 后刷新 |
| 重复开始 | 比较 `start_request_hash`；同 key 同 hash 返回原会话，不同 hash 返回幂等冲突 |
| 重复发布 | 比较 `finalize_request_hash`；同 key 同 hash 返回原版本，不同 hash 返回幂等冲突 |
| Worker 重复回调 | 校验 lease token、任务状态和结果 hash |
| Package 当前版本变化 | `expectedPackageVersionId` 不一致返回 409，不自动覆盖 |
| 处理时取消/删除 | 取消租约续期，迟到回写拒绝，相关对象标记为 `orphaned/unreferenced` 但永久保留 |
| 发布中任一步失败 | 资产未就绪则不进事务；数据库事务失败则无半成品版本 |

创建前没有 `package_id` 的幂等方案：

| 场景 | 持久化位置 |
|---|---|
| 创建会话 | 保留 `(user_id, start_client_message_id)` 唯一键，并新增正式列 `start_request_hash`；新 API 将 `idempotencyKey` 映射到请求键，冲突后必须比较 hash |
| 媒体异步任务 | `skill_media_jobs` 的 `(session_id, job_type, idempotency_key)` + `request_hash` |
| 编辑/人工确认 | `revision_no` + `media_state_json.operationReceipts` 中有数量上限的操作键与请求 hash |
| 发布 | `finalize_request_id` + 新正式列 `finalize_request_hash`；Package 已存在时可继续使用现有 Package 幂等机制，但不能跳过 hash 比较 |

## 15. AI 生成、证据与质量门禁

### 15.1 证据卡

| 字段 | 含义 |
|---|---|
| `evidenceId` | 会话和版本内稳定 ID |
| `kind` | M1 为 `transcript` / `audio_segment` / `frame`；纯音频不需要 `frame` |
| `source` | 指向所属 `primarySource` 和相关派生产物，不接受客户端传入用户归属 |
| `timeRange` | `startMs/endMs`，用于回到原视频或音频的对应时间段 |
| `text` | 原文、附近讲解或人工补充 |
| `assetRef` | 按 `kind` 引用转录对象、可回放音频或不可变图片，并保存 SHA-256 |
| `provenance` | 来源摘要、提取方式、模型/处理器版本、人工修改和置信度；置信度不代替人工确认 |
| `claimType` | `sourceFact`、`modelInference`、`userInput` |
| `selectionReason` | 为什么该证据支持对应 Skill |

每项教学经验和 Skill 规则应尽量关联 Evidence。模型推断必须显示为“推断”，用户补充显示为“用户补充”，不得伪装成原材料原话。

### 15.2 硬质量门禁

| 门禁 | 通过条件 |
|---|---|
| 完整性 | 名称、适用范围、步骤、限制、异常和完成验证齐全 |
| 可追溯来源 | 核心规则有来源或明确标记为推断/用户补充 |
| 去重 | 候选没有明显重复，合并结果保留来源 |
| 模态一致性 | 图片、音频、文字和代码没有互相矛盾 |
| 结构可执行 | 输入、动作、输出和失败恢复可实际执行 |
| 教学重点证据 | 关键教学点至少有音频/字幕/视觉中的可用证据 |
| 音频证据完整性 | 纯音频有可定位、可回放的 transcript/audio_segment 即可，不要求 frame |
| 图片忠实度 | 图片确实对应所述知识点，不是转场、黑屏或无关画面 |
| 视觉断言证据 | 视频 Skill 若声称画面、板书、图表或操作状态，必须关联对应 frame |
| ASR 可信度 | 低置信度/失败转录已人工校正或明确降级，未校正内容不作为来源事实 |
| V1 | 候选至少跨两个独立场景可复用 |
| V2 | 候选能指导、解释或预测新场景 |
| V3 | 候选不是普通常识或泛泛建议 |
| 边界与验证 | 适用条件、限制、反例和完成验证明确 |
| 无证据扩写 | 不能把模型扩写当作素材事实 |
| 发布字段 | 每个 Skill 都有来源、触发、反触发、边界、执行步骤、完成/停止标准和压力测试结果 |

任一 V1/V2/V3 失败的候选必须降级为案例、术语或引用，不能以 Skill 发布。其他硬门禁未通过也只能保存草稿。M1 所有用户都不能绕过；未来只有后端能获得并验证可信角色后，才可单独设计 admin 强制发布。

### 15.3 Arena 升级

| 指标 | 评估方式 |
|---|---|
| 纯文本 vs 多模态 Skill | 固定任务、模型和版本做对照 |
| Skill 检索/选择正确率 | 是否选择了正确 Skill，是否误选兄弟 Skill |
| 证据加载与使用 | 记录加载了哪些证据、实际输出是否使用 |
| 图片贡献 | 去掉图片后的任务结果是否下降 |
| 可执行代码 | 优先运行代码并检查真实输出 |
| 最终任务完成度 | 使用可自动验证的结果，模型评分只作补充 |
| 成本、延迟、失败率 | 同一测试集对比 token、耗时和错误 |
| 禁触发 | 不适用任务中 Skill 是否保持不触发 |

| 压力测试类型 | M1 用例 | 通过口径 |
|---|---|---|
| `should_trigger` | 明确满足 A2 触发条件和语言信号的任务 | 正确选择 Skill，并按 E 的步骤完成任务 |
| `should_not_trigger` | 主题相近但条件不满足、属于普通常识或超出边界的任务 | 不选择该 Skill，不伪造证据 |
| `edge_case` | 输入不完整、条件临界、证据不足或失败模式 | 按 B 的边界安全停止、追问或降级 |
| `cross_skill_confusion_bait` | 与邻近 Skill 名称/语言相似但真实适用条件不同的诱饵 | 选择正确邻近 Skill 或明确不触发；不得误选本 Skill |

| 结果 | 规则 |
|---|---|
| 通过 | 四类必测用例均执行，硬门禁无失败；真实可验证结果优先于模型主观分数 |
| 分析 | 仅当测试基准不清、基础设施失败或证据存在歧义时进入人工分析；结论确认前不得发布 |
| 重建 | V1/V2/V3、核心触发、反触发、边界或跨 Skill 混淆失败时，返回候选提取/RIA++ 重建并重新测试 |

M1 必须完成一个主要 Skill 的文本/多模态对照和四类压力测试。`cross_skill_confusion_bait` 可使用现有邻近 Skill 或审核构造的相邻候选；多 Skill Pack 路由与组合测试仍放 M2。

## 16. 权限、安全、隐私与审计

### 16.1 对象级权限链

`登录用户 → 创建会话/Pack → Package → Skill → Skill Version → 素材/证据 → Arena Thread/Report`

| 要求 | 规则 |
|---|---|
| 身份 | 只取后端认证上下文，禁止信任客户端 `userId/authUserId` |
| List/Detail/Mutation/Preview | 每个 action 都校验会话或 Package 归属 |
| 签名 URL | 权限通过后短期生成，不缓存成公开永久地址 |
| Worker | 仅服务身份和最小 action 权限；不持有无限制业务数据库账号 |
| 日志 | 不输出密钥、租约令牌、完整签名 URL、完整转录或敏感教学材料 |
| 密钥 | 环境变量/密钥管理服务保存，支持轮换 |

### 16.2 内容授权与敏感数据

| 场景 | 要求 |
|---|---|
| 上传版权 | 发布前确认用户有权处理和使用素材；禁止绕过第三方限制 |
| 学生隐私/未成年人影像 | 上传前提示；默认最小访问；发送外部 AI 前必须符合部署方授权策略 |
| 个人信息 | 日志和模型输入最小化；必要时先做脱敏 |
| 工作区删除 | 逻辑删除会话和引用；未发布对象仍永久保留，只标记为失效/不可用 |
| 已发布资产 | 默认随不可变版本保留；普通工作区删除不能静默改变历史 |
| 合规删除请求 | 进入单独的受控不可用流程，撤销访问并在历史版本显示不可用说明；对象本身仍保留，不能悄悄替换为其他内容 |

关键事件——上传、删除、Overview 确认、证据修改、候选编辑、测试和发布——写入平台结构化审计日志；发布与版本信息同时由现有不可变版本记录证明。M1 不另建 `audit_events` 表。

## 17. 前端体验

| 项目 | 要求 |
|---|---|
| 视觉体系 | 沿用现有 EduSkill 创建与 Arena 交互，不另造复杂工作台 |
| 进度 | 展示“上传、媒体准备、理解、证据、候选、测试、发布”等用户语言，不暴露 Worker、对象键和数据库 ID |
| 恢复 | 页面加载先请求详情；前端临时状态不得覆盖服务端状态 |
| stale response | 列表、详情、预览使用请求序号或 AbortController，忽略旧响应 |
| 大文件 | 展示上传进度、取消和分片续传；小文件中断可明确要求重新上传 |
| 转录编辑 | 分段展示时间、文本和可选置信度；支持回放、人工修正和修订冲突提示 |
| 证据预览 | transcript/audio_segment 可按时间回放；视频 frame 同时展示附近转录、音频范围、时间和选择原因 |
| 证据编辑 | 可替换、撤销引用、补选候选帧；操作后立即显示新修订号；被撤销引用的对象永久保留并标记可用性状态 |
| 候选编辑 | 可拆分、合并、废弃，不允许前端直接跳过阶段 |
| 409 冲突 | 提示“状态已变化”，刷新相关会话、Package、版本和测试状态；不自动覆盖 |
| 布局 | 长文件名和长文本使用 `min-width/overflow/truncate`；桌面和较窄窗口不撑破侧栏 |
| Markdown | 默认不信任，不执行原始 HTML；如需 HTML 必须可靠清洗 |
| 无障碍 | 键盘可操作、焦点可见、进度和错误有文本说明，不能只靠颜色 |
| 状态页面 | 空状态、加载态、部分成功、失败、取消和不可重试均有明确下一步 |

## 18. 测试、验收与运维

### 18.1 测试范围

| 类型 | 必测内容 |
|---|---|
| 单元测试 | 状态转换、semanticMoments schema、确定性质量信号、关键帧候选排序、证据类型、模型降级、规范化请求摘要 |
| API 测试 | 登录、对象归属、未知字段、创建/发布同键同 hash、同键异 hash、第二主要源拒绝、修订冲突、稳定错误码 |
| 数据库测试 | UNIQUE、创建/发布请求 hash、服务层引用和状态校验、重复领取、租约过期原子清空字段、终态不复活、迟到回写、发布事务回滚、迁移重复执行 |
| Worker 集成 | video/audio 探测、音频规范化、有音轨视频抽音频、分段级时间戳 ASR、转录重试、时间窗截图、黑屏/模糊/重复过滤、manifest；至少两个副本并行领取不同任务，任一副本中止后其任务可被其他副本重新领取并从头执行 |
| 对象存储 | 单/分片上传、单主要源替换、旧派生产物失效但保留、短签名 URL、SHA-256 复核、版本资产保护、`orphaned/unreferenced` 登记、备份恢复 |
| 安全测试 | 横向越权、SSRF、每跳重定向、DNS 重绑定、恶意 MIME、压缩炸弹、日志泄密 |
| E2E | 纯音频和有音轨视频分别完成上传→ASR/证据→Adler→五路候选→V1/V2/V3→RIA++→Arena→发布；另测无音轨、低置信度、取消、重试和冲突 |
| 回归 | 旧 Package/Skill Version/Package Version/Arena、旧 action、旧 Skill `skillMd` |

### 18.2 M1 真实验收示例

至少使用两份处于审核上限内的真实教学样例：一份 MP3/WAV/M4A 纯音频，一份包含教师讲解、PPT 切换和黑板/软件逐步操作的有音轨视频；另准备无音轨视频和低置信度 ASR 片段作为降级样例。

| 验收点 | 成功标准 |
|---|---|
| 单主要源 | 一个 M1 会话只能确认一个 `video` 或 `audio` 主要源；第二素材被拒绝，显式替换会使旧派生产物失效并永久保留对象，仅更新引用和可用性状态 |
| 上传与安全 | 文件实际 MIME、大小、签名和 SHA-256 经服务端/Worker 复核；客户端 hash/ETag 未被当作可信结果 |
| 可恢复 | 处理中关闭浏览器并重新登录，能够从服务端恢复真实进度 |
| 纯音频闭环 | 音频完成探测、规范化、分段级 ASR、可编辑转录、音频证据回放、Adler、候选验证、RIA++、Arena 和发布；没有 frame 不判定不完整 |
| 有音轨视频闭环 | 视频音轨默认抽取并转录；统一时间线能从同一规则回到 transcript、audio time range 和 frame |
| 转录校正 | 每个 segment 可定位、回放和编辑；编辑增加修订号并使相关候选/证据校验结果失效后重算 |
| 语义定位 | 生成结构化语义时刻；关键教学点不是只靠周期帧或 scene frame 命中 |
| 证据帧 | 每个关键时间窗先有多张候选，再选择 1～2 张；可替换、撤销引用和补选，对象本身不删除 |
| 质量 Spike | PPT 切换选择稳定完整页；缓慢板书保留新增步骤；老师遮挡时优先无遮挡帧或明确降级；黑/白屏被过滤；无音频样例仍可按 `visualTarget` 排序并允许人工修正 |
| 显式降级 | 无音轨、低置信度/失败 ASR、视觉模型失败均显示原因、影响范围和人工修正/重试路径；不得生成无来源断言 |
| 证据忠实 | Skill 核心规则能回到原视频时间点和画面；推断与原话明确区分 |
| 异常恢复与横向扩容 | 至少启动两个 Worker；不同任务可并行分配；人为中止一个 Worker 后租约被回收，该任务由其他副本从头重试，旧 Worker 回写被拒绝 |
| 人工确认 | Overview、证据与候选、发布三个确认点均不可绕过 |
| 原子发布 | 成功时 Package Version、Skill Version、成员关系和资产引用完整；模拟失败时全部数据库变更回滚 |
| 幂等冲突 | 创建和发布使用同 key、同规范化请求返回原结果；同 key 改任一有效参数返回 409，数据库中可审计对应请求 hash |
| 历史固定 | 替换/删除工作区素材后，已发布版本和旧 Arena Thread 仍指向原固定资产 |
| 候选验证 | V1/V2/V3 任一失败的候选只能降级为案例、术语或引用，不得发布为 Skill |
| Skill 完整度 | 每个发布 Skill 有来源、触发、反触发、边界、执行步骤、完成/停止标准和压力测试结果 |
| Arena | `should_trigger`、`should_not_trigger`、`edge_case`、`cross_skill_confusion_bait` 均执行，并按通过/分析/重建规则处理 |
| 数据库范围 | 除 `skill_media_jobs` 及已批准的 session 字段外，不新增 audio/transcript/frame/evidence/skill_relation 等业务表 |
| 旧功能 | 旧 action、旧数据和仅含 `skillMd` 的 Skill 正常工作 |

浏览器 E2E 未实际执行时必须明确写“未执行”，不能用编译通过代替业务验收。

### 18.3 运维与配置

| 类别 | 要求 |
|---|---|
| 指标 | 队列等待、处理耗时/实时系数、成功率、重试率、租约回收、活跃 Worker 副本数、单副本吞吐、任务分布、转录/证据质量、存储增长、AI 成本和延迟 |
| 健康检查 | Node/TypeScript、PostgreSQL、对象存储、media worker、FFmpeg/ffprobe、已配置 ASR、模型网关分别检查 |
| 日志 | 结构化日志带 `sessionId/jobId/requestId`，敏感字段脱敏 |
| 告警 | 租约积压、失败率、对象存储容量、模型限流、发布事务失败、对象保留登记或可用性状态异常 |
| 配置 | 大小/时长、分片、重试、租约、模型、存储和可见性/访问策略均使用环境变量或部署配置 |
| 本地 Docker | Node/TypeScript 服务依赖 PostgreSQL/MinIO；Worker 依赖 API/MinIO/FFmpeg 和已配置 ASR；不要求 Redis |
| 备份恢复 | PostgreSQL 与版本资产按一致恢复点管理；定期抽样验证版本 manifest 的对象可读和 SHA-256 |
| 安全回滚 | 关闭功能开关、停止新任务和 Worker，不删除已有版本或资产引用 |

## 19. 代码影响范围与实施顺序

### 19.1 影响范围

| 层 | 预计变化 | 不做的变化 |
|---|---|---|
| Shared | `PackageSkill` 增加可选多模态字段；版本 source 增加 `distilled`；新媒体 DTO | 不破坏旧字段 |
| Database | 扩展创建会话；新增 `skill_media_jobs`；扩展共享 TypeScript 联合类型和服务端 source 校验 | 不新增十几张 Pack 平行表；不新增 FK/CHECK、存储过程或触发器 |
| Server | 新 action、对象存储适配、租约服务、模型适配、状态机、发布事务 | 不替换登录、权限、Package/版本/Arena 服务 |
| Python media worker/adapter | 媒体探测、规范化、音频提取、Whisper/可替换 ASR、候选帧物化、图像质量检测和产物上传；同能力副本可任意增减并竞争租约 | 不维护业务数据库或业务状态真相，不发布 Skill；不共享本地磁盘、不要求精确断点恢复，只通过 job contract 读取任务输入、写入对象存储产物并回报任务级进度/结果/错误 |
| Web | 在现有创建体验中增加上传、进度、证据、候选和确认步骤 | 不改无关页面和文案 |
| Arena | M1 增加文本/多模态对照和证据使用记录；M2 再加 Pack 路由 | 不改变旧 Thread 的固定版本语义 |

### 19.2 通过后实施顺序

| 顺序 | 工作 | 先验验证/验收 |
|---:|---|---|
| 1 | 技术 Spike：MinIO/S3 上传、版本资产固化、URL SSRF | 大文件、短签名、SHA-256、逐跳重定向 |
| 2 | 技术 Spike：FFmpeg/ffprobe、分段级 ASR、转录编辑/回放、候选帧质量过滤 | MP3/WAV/M4A、有音轨视频、无音轨视觉降级、低置信度 ASR、无 GPU 和慢写板书样例 |
| 3 | 技术 Spike：原生视频模型与兼容模式 | 正式 API 能力、JSON Schema、超时/限流/空结果 |
| 4 | 技术 Spike：发布事务 | 模拟对象失败和数据库失败，无半成品版本 |
| 5 | 最小数据库迁移与共享契约 | 重复迁移、旧数据、旧 Skill、`distilled` 兼容 |
| 6 | 媒体 action、对象存储与 PostgreSQL 租约 | 权限、幂等、租约回收、取消迟到回写 |
| 7 | Python media worker/adapter 媒体链路 | job contract、音频规范化、ASR、manifest、处理器版本、确定性质量过滤 |
| 8 | Node 证据时间线、Adler、五路候选、V1/V2/V3 和 RIA++ | 推断分型、关系 JSON、降级可见、证据可追溯 |
| 9 | 前端确认流与恢复体验 | stale response、409、进度、无障碍、窄窗口 |
| 10 | 硬门禁、原子发布和 Arena 对照 | 全链路 E2E、安全、回归和运维验收 |

## 20. 少量待审核参数

以下参数集中确认，不影响总体架构：

| 待确认项 | 建议起点 | 决策方 |
|---|---|---|
| video/audio 最大时长、文件大小和格式白名单 | 先用真实部署环境压测；M1 已确定支持 video/audio，具体上限不在文档硬编码 | 部署 + 产品 |
| 默认分片/重叠 | 10～20 分钟；20～30 秒 | 模型 + 后端 |
| 每片语义时刻/候选帧/证据帧 | ≤8；3～6；1～2 | 产品 + 模型 |
| 模糊、黑白屏、重复、稳定度、完整度和遮挡阈值 | 不预设固定数值，由 PPT 切换、缓慢板书、遮挡、黑屏和无音频真实样例 Spike 标定并配置化 | 模型 + 测试 |
| 是否允许第三方原生视频模型 | 默认允许配置但需隐私、成本和能力评审 | 安全 + 部署 + 产品 |
| ASR 部署方式与模型 | 分段级 ASR 为 M1 必做；本地 Whisper、其他本地模型或合规外部服务由算力、隐私和成本决定 | 部署 + 安全 |
| 原始媒体、候选帧、失败任务保留期 | 对象永久保留；分别配置可见性、可用性和访问权限，不配置物理删除保留期 | 产品 + 合规 + 运维 |
| 外部来源版权/授权策略 | M1 必须用户确认授权；更细策略由法务/产品确定 | 产品 + 法务 |
| OCR/ASR/视觉模型与生产算力 | 先 Spike，不在方案中锁定型号；模型选择不能取消 M1 的分段 ASR 验收 | 部署 + 模型 |

## 21. 最终准入条件

| 准入项 | 必须满足 |
|---|---|
| 产品 | 纯音频进入 M1 已确认；只需确认 video/audio 大小、时长、格式白名单、可见性/访问策略和三个确认点 |
| 架构 | 接受“复用创建会话 + 一张媒体任务表 + 现有版本链”，以及“新增/改造不使用 FK/CHECK，仅保留必要 UNIQUE 与索引” |
| 安全 | 接受对象存储、SSRF、Worker 最小权限、隐私与外部模型边界 |
| 数据 | 确认不可变版本资产、`distilled` 来源、创建/发布正式请求 hash、逻辑删除、对象永久保留和可用性标记 |
| 模型 | 完成分段 ASR、原生视频/兼容模式、Kimi 识图能力和 JSON Schema Spike |
| 测试 | 同意 M1 真实样例、异常路径、安全、回归和发布回滚清单 |
| 部署 | 确认 MinIO/S3、FFmpeg、M1 必需的 ASR 实现（Whisper 或其他合规方案）、算力、监控和备份方案 |

**当前审核结论：待审核，尚未准入实施。**只有上述准入项明确通过后，才能进入编码和迁移计划。

## 22. 文档自检

| 自检项 | 结果 |
|---|---|
| 旧稿十表设计已被最小模型完整替换 | 通过：仅复用会话并新增 `skill_media_jobs` |
| M1 单主要源与派生产物边界清晰 | 通过：`primarySource.kind` 只能是 `video` 或 `audio`，且每次会话只有一个 `primarySource`；多源合并放 M2 |
| 创建/发布幂等有正式请求摘要 | 通过：`start_request_hash`、`finalize_request_hash` 不藏入 JSONB |
| 关键帧确定性质量信号和 Spike 样例完整 | 通过：硬过滤先于模型软排序，阈值待真实样例标定 |
| 租约过期回收与终态规则明确 | 通过：原子清空租约字段并设置退避，终态不复活 |
| 业务运行与 Worker 租约仍清楚区分 | 通过 |
| Python media worker 可横向扩展 | 通过：副本无 Session 亲和性且不共享本地磁盘；共享任务队列和对象存储；崩溃后其他副本从任务起点重试，不新增 checkpoint 表 |
| 未把 cangjie-skill 写成视频处理工具 | 通过 |
| cangjie-skill 已落到可执行方法流程 | 通过：Adler 四层概览、五路候选、V1/V2/V3、RIA++、Skill 关系与 Arena 压力测试相互对应 |
| 未把 Kimi 识图写成原生长视频能力 | 通过 |
| 未把微软可选时间点写成 100% 稳定默认能力 | 通过 |
| 未把 EduSkill 的通用音频获取链写成 Resource2Skill 原生能力 | 通过：ASR、audio evidence 和按时间回放明确定义为 EduSkill 工程扩展 |
| Python media worker 没有变成第二套后端 | 通过：不维护业务数据库/业务状态真相，不发布 Skill，仅按 job contract 处理输入、对象存储产物与状态回报 |
| 未把长期愿景全部放进 M1 | 通过：长视频自动章节、纯音频批量、多 Skill、文档分阶段 |
| 数据库 snake_case、新 API JSON lowerCamelCase | 通过；旧 guided action 字段为兼容例外 |
| 所有新 action 使用 `POST /api`，旧 action 保持兼容 | 通过 |
| 状态、表字段、API 和版本快照能相互对应 | 通过 |
| 页面恢复、异常、权限、并发、发布回滚和历史固定已覆盖 | 通过 |
| 文档内无未完成占位标记 | 通过；待决策参数集中列明，不作为占位 |
| 审核前不实施 | **通过：不编码、不建表、不执行迁移、不提交、不推送** |
