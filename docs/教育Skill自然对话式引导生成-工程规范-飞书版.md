# 教育 Skill 自然对话式引导生成工程规范

> **适用范围说明：**本文件仅描述既有“自然对话式文本引导生成”流程，不是多模态 Skill Pack 的实施规范。涉及视频/音频、证据时间线、对象永久保留、媒体任务、Python Worker、Arena 门禁和多模态发布时，必须使用 `2026-08-20-multimodal-skill-pack-implementation-spec-feishu-v2.md`；两者冲突时，以该 V2 对多模态新增行为的规定为准。

> 版本：V1.1
>
> 项目：EduSkill
>
> 需求来源：《教育Skill自然对话式引导生成》V1.2

## 1. 功能目标

用户通过自然对话描述想要创建的教育 Skill。AI 通过六个自然阶段挖取用户的想法和经验，再将用户确认的内容提炼为 Skill。

AI 可以复述、举例和提出建议，但不能代替用户完成阶段。六个阶段都必须至少获得一次用户回答；模型推断只能作为候选内容，不能直接触发最终确认。

信息完整后展示确认卡。用户确认后，新建一个可直接使用的教育 Skill：

- Skill Version v1。

用户界面只展示 Skill。底层仍自动创建 Package v1 和 Package Version v1 作为运行容器，但不向用户暴露 Agent、Package 和 `agent.md` 概念。

需求文档中的“Skill v0”表示首次可用版本，对应数据库中的 `version_number = 1`。

第一版不做 Rubric、测试题、自动评分、自动优化、复杂工作流和完整来源追踪。

## 2. 主流程

```text
用户输入需求
  ↓
创建会话，保存用户消息
  ↓
AI 提取结构化草案
  ↓
按六个阶段逐步挖取用户经验
  ├─ 当前阶段未确认：每次只追问一个问题
  ├─ 回答不足或存在冲突：留在当前阶段继续澄清
  └─ 六阶段均确认且信息完整：展示确认卡
  ↓
用户确认
  ↓
生成并校验 Package Snapshot 和一个 Skill
  ↓
事务创建 Skill Version v1 和内部运行容器
  ↓
打开新建 Skill
```

用户确认前不创建 Package。只有生成、校验和保存全部成功，才将会话标记为完成。

## 3. 结构化草案

草案保存在 `draft_json` 中，不拆成多张业务表。

| 字段 | 含义 |
|---|---|
| `roles` | 助手面向谁，承担什么角色 |
| `goal` | 需要帮助用户完成什么目标 |
| `usage_scenario` | 在什么场景下使用 |
| `input_contract` | 用户会提供哪些输入 |
| `output_contract` | 最终需要输出什么 |
| `core_capabilities` | Skill 需要具备的核心能力 |
| `workflow` | 处理步骤和执行顺序 |
| `knowledge_evidence` | 使用哪些材料、知识或证据 |
| `boundaries_permissions` | 禁止行为、权限和边界 |
| `exception_recovery` | 信息不足或处理失败时怎么办 |
| `completion_evidence` | 如何判断任务已经完成 |

字段状态保存在 `field_states_json` 中：

| 状态 | 含义 |
|---|---|
| `explicit` | 用户已经明确提供 |
| `inferred` | 可以从上下文可靠推断 |
| `defaulted` | 使用系统默认值 |
| `missing` | 仍然缺失 |
| `conflicted` | 信息存在冲突 |

LLM 负责理解、提取和组织语言；后端负责字段类型、缺失项、冲突项和是否允许确认的判断。

字段状态规则：

- `explicit` 必须来自用户原话、选项选择或明确确认；
- LLM 返回 `explicit` 时必须附带本轮用户原话中的证据片段，后端校验失败时降为 `inferred`；
- `inferred` 和 `defaulted` 可以完善草案，但不能代替用户完成阶段；
- `inferred` 不得覆盖已有 `explicit` 内容；
- 用户新的明确表达可以替换旧内容，发生冲突时继续追问。

六个引导阶段：

| 阶段 | 需要用户表达的内容 | 对应字段 |
|---|---|---|
| 对象与目标 | 给谁使用、解决什么问题 | `roles`、`goal` |
| 场景与输入 | 何时使用、具备什么条件、提供什么材料 | `usage_scenario`、`input_contract` |
| 期望结果 | 最终得到什么、给谁使用 | `output_contract` |
| 处理方式 | 用户通常怎样做、哪些经验和步骤不能省 | `core_capabilities`、`workflow` |
| 依据与范围 | 教材、标准、材料和知识补充范围 | `knowledge_evidence` |
| 边界与完成 | 禁止行为、安全要求、异常处理和完成标准 | `boundaries_permissions`、`exception_recovery`、`completion_evidence` |

## 4. 数据库设计

新增两张表。现有 Package、Package Version、Skill 和 Skill Version 表保持不变。

### 4.1 `skill_guided_creation_sessions`

作用：保存会话、草案、确认内容、校验结果和最终 Package。

| 字段名 | 类型 | 必填 | 默认值 | 含义 |
|---|---|---:|---|---|
| `id` | bigserial | 是 | 自增 | 会话 ID |
| `user_id` | text | 是 | 无 | 所属用户，来自认证网关 |
| `status` | varchar(32) | 是 | `collecting` | 会话状态 |
| `model` | text | 否 | `null` | 使用的模型 |
| `start_client_message_id` | text | 否 | `null` | 首次请求唯一标识，失败重试时复用原会话 |
| `documents_json` | jsonb | 是 | `[]` | 用户上传的参考材料 |
| `draft_json` | jsonb | 是 | `{}` | 当前结构化草案 |
| `field_states_json` | jsonb | 是 | `{}` | 草案字段状态 |
| `confirmation_json` | jsonb | 否 | `null` | 当前确认卡 |
| `generated_snapshot_json` | jsonb | 否 | `null` | 已生成的 Package Snapshot |
| `validation_result_json` | jsonb | 否 | `null` | 最近一次校验结果 |
| `package_id` | bigint | 否 | `null` | 成功创建的 Package ID |
| `skill_id` | bigint | 否 | `null` | 成功创建的 Skill ID |
| `skill_version_id` | bigint | 否 | `null` | 初始 Skill Version ID |
| `error_json` | jsonb | 否 | `null` | 最近一次错误信息 |
| `revision_no` | integer | 是 | `0` | 草案修订号 |
| `finalize_request_id` | text | 否 | `null` | 最近一次确认请求标识 |
| `flow_version` | integer | 是 | `1` | 引导流程版本；新建会话写入 `2` |
| `confirmed_stages_json` | jsonb | 是 | `[]` | 已获得用户回答并确认的阶段 |
| `created_at` | timestamptz | 是 | `now()` | 创建时间 |
| `updated_at` | timestamptz | 是 | `now()` | 更新时间 |
| `completed_at` | timestamptz | 否 | `null` | 完成时间 |

约束和索引：

| 名称 | 定义 |
|---|---|
| 状态检查 | `collecting`、`ready_for_confirmation`、`finalizing`、`completed`、`failed`、`cancelled` |
| 用户会话索引 | `(user_id, status, updated_at desc)` |
| 首次请求唯一索引 | `(user_id, start_client_message_id)` 非空时唯一 |
| Package 唯一索引 | `package_id` 非空时唯一，一个会话只能创建一个 Package |
| Skill 唯一索引 | `skill_id` 非空时唯一，一个会话只能创建一个 Skill |

### 4.2 `skill_guided_creation_messages`

作用：保存完整对话，页面刷新后按顺序恢复。

| 字段名 | 类型 | 必填 | 默认值 | 含义 |
|---|---|---:|---|---|
| `id` | bigserial | 是 | 自增 | 消息 ID |
| `session_id` | bigint | 是 | 无 | 所属会话 |
| `message_no` | integer | 是 | 无 | 会话内消息序号 |
| `client_message_id` | text | 否 | `null` | 前端消息唯一标识，防止重复提交 |
| `role` | varchar(16) | 是 | 无 | `user` 或 `assistant` |
| `content` | text | 是 | 无 | 消息正文 |
| `metadata_json` | jsonb | 是 | `{}` | 选项、确认卡等附加信息 |
| `created_at` | timestamptz | 是 | `now()` | 创建时间 |

约束和索引：

| 名称 | 定义 |
|---|---|
| 消息顺序唯一 | `(session_id, message_no)` 唯一 |
| 客户端消息唯一 | `(session_id, client_message_id)` 非空时唯一 |
| 会话消息索引 | `(session_id, message_no)` |

## 5. API 设计

### 5.1 通用规范

所有接口统一：

```text
POST /api
```

请求格式：

```json
{
  "action": "SkillGuidedCreationStart",
  "payload": {}
}
```

规则：

- `action` 使用大驼峰命名；
- 请求和返回字段使用蛇形命名；
- `user_id` 从认证网关的 `x-user-id` 获取，客户端禁止传入；
- 所有会话操作都要校验会话属于当前用户；
- ID 使用字符串返回。

普通成功返回：

```json
{
  "success": true,
  "data": {}
}
```

普通失败返回：

```json
{
  "success": false,
  "error": {
    "code": "INVALID_ARGUMENT",
    "message": "请求参数不正确"
  }
}
```

### 5.2 Action 定义

| Action | 接口含义 | `payload` 字段 | 返回内容 |
|---|---|---|---|
| `SkillGuidedCreationStart` | 创建会话并处理第一条需求 | `client_message_id`：消息唯一标识；`content`：用户需求；`model`：可选模型；`documents`：可选参考材料 | SSE 返回 `session_id`、AI 回复、状态和确认卡 |
| `SkillGuidedCreationList` | 获取当前用户最近的创建会话 | `status`：可选状态；`limit`：默认 20，最大 50 | 会话摘要列表 |
| `SkillGuidedCreationDetail` | 恢复指定创建会话 | `session_id`：会话 ID | 会话、消息、草案、字段状态和确认卡 |
| `SkillGuidedCreationMessage` | 继续对话并更新草案 | `session_id`：会话 ID；`client_message_id`：消息唯一标识；`revision_no`：当前草案修订号；`content`：用户回复 | SSE 返回 AI 追问或确认卡 |
| `SkillGuidedCreationConfirm` | 确认草案并创建 Skill | `session_id`：会话 ID；`revision_no`：确认的草案修订号；`request_id`：幂等标识 | SSE 返回生成进度和最终 `skill_id`、`skill_version_id` |
| `SkillGuidedCreationCancel` | 取消未完成会话 | `session_id`：会话 ID | 最新会话状态 |

核心返回字段：

| 字段名 | 类型 | 含义 |
|---|---|---|
| `session_id` | string | 创建会话 ID |
| `status` | string | 当前会话状态 |
| `revision_no` | integer | 当前草案修订号 |
| `messages` | array | 已保存的完整对话 |
| `draft` | object | 当前结构化草案 |
| `field_states` | object | 草案字段状态 |
| `flow_version` | integer | 引导流程版本 |
| `confirmed_stages` | array | 已确认阶段 |
| `next_stage` | string/null | 下一阶段；全部完成时为 `null` |
| `confirmation_card` | object/null | 待确认内容 |
| `skill_id` | string/null | 成功创建的 Skill ID |
| `skill_version_id` | string/null | 初始 Skill Version ID |
| `package_id` | string/null | 内部 Package ID，仅供前端适配，不展示给用户 |
| `error` | object/null | 最近一次失败信息 |

SSE 事件：

| 事件名 | 含义 |
|---|---|
| `phase` | 当前处理阶段 |
| `message` | AI 的追问或回复 |
| `confirmation` | 待用户确认的确认卡 |
| `done` | 本次操作完成，确认成功时包含 `skill_id`、`skill_version_id` 和内部 `package_id` |
| `error` | 错误码、错误信息和是否可重试 |
| `stream_end` | SSE 流结束 |

## 6. 后端规则

### 6.1 每轮对话

1. 校验会话属于当前用户；
2. 通过 `client_message_id` 防止消息重复写入；
3. 先保存用户消息；
4. LLM 返回草案更新操作，只允许 `set`、`replace`、`remove`；
5. 后端检查字段类型、关键缺失项和冲突项；
6. 根据助手上一条消息的 `focus_stage` 判断本轮回答属于哪个阶段；
7. 当前阶段获得有效用户回答后才标记为已确认，否则继续追问该阶段；
8. 六个阶段均确认、必填内容完整且无冲突时生成确认卡，状态改为 `ready_for_confirmation`；
9. 使用 `revision_no` 更新草案；如果版本已经变化，返回冲突并重新加载会话；
10. 保存 AI 消息、草案、字段状态、阶段进度和当前 `focus_stage`。

### 6.2 用户确认

1. 校验会话状态和 `revision_no`；
2. 状态改为 `finalizing`，禁止并发生成；
3. 根据确认后的草案生成一个 Package Snapshot，其中只包含一个教育 Skill；
4. 复用现有 Skill Markdown 和 Package Snapshot 校验；
5. 在同一个事务中创建 Package v1、Package Version v1、Skill Version v1，并把 `package_id`、`skill_id`、`skill_version_id` 写回会话；
6. 任一步数据库写入失败时整体回滚，不留下半成品 Package。

LLM 调用不放在数据库长事务中。生成结果和校验结果先保存在会话中，最终创建 Package 时再使用短事务。

### 6.3 失败处理

- 对话失败：用户消息保留，草案不被错误覆盖；
- 校验失败：保存生成结果和校验结果，系统先自动修复；
- 保存失败：Package 创建事务回滚，保留生成结果，允许再次确认；
- 重复确认：会话已完成时直接返回已有 `skill_id` 和 `skill_version_id`，不能重复创建。

## 7. 前端改动

第一阶段新增隐藏的 `/skills` Skill-first 工作区，当前 `/` 工作台保留不动：

- 首次提交调用 `SkillGuidedCreationStart`；
- 后续对话调用 `SkillGuidedCreationMessage`；
- 每轮只展示一个主要追问，可提供 2～4 个参考选项；
- 对话区轻量展示当前阶段和 `已完成数量 / 6`，不增加多页表单；
- 信息完整后展示确认卡；
- 用户修改内容时继续发送消息；
- 用户确认后调用 `SkillGuidedCreationConfirm`；
- 创建成功后根据 `skill_id` 打开新 Skill；
- 页面刷新后通过 `SkillGuidedCreationList` 和 `SkillGuidedCreationDetail` 从数据库恢复。

Skill-first 工作区规则：

- 左侧只展示新建 Skill、草稿和 Skills；
- 不展示“我的智能体”和全局 Arena；
- 正式 Skill 内部展示概览、测试和版本；
- 版本对比从版本页面进入；
- Package 相关 ID 和文案不对用户展示；
- 用户审核通过前，不切换默认入口、不删除旧工作台。

## 8. 工程改动和验收

| 模块 | 实现内容 |
|---|---|
| 数据库 | 在 `db-schema.ts` 增加两张表、约束和索引 |
| 后端路由 | 在 `POST /api` 增加六个大驼峰 Action |
| 后端服务 | 新增引导创建 Service，负责消息保存、草案更新、状态判断和确认事务 |
| Package 生成 | 将现有生成逻辑拆成“生成 Snapshot”和“保存 Package”，保留原接口兼容 |
| Skill 校验 | 复用现有 `validateSkillMdStandard` 和 Package 校验 |
| 前端 | 新增 `/skills` Skill-first 工作区，包含 Codex 风格左右侧栏、对话、确认、生成、失败重试和会话恢复 |
| 部署 | 发布前执行现有 `db:init` 初始化新表 |
| 测试 | 覆盖会话恢复、单问题追问、重复消息、重复确认、事务回滚和用户越权 |

验收要求：

- 刷新页面后，对话、草案和确认卡可以从数据库恢复；
- 已明确的信息不重复追问，每轮只问一个关键问题；
- 六个阶段都必须获得用户回答，模型推断不能代替用户完成阶段；
- 用户只确认角色后仍然保持 `collecting`，继续询问场景、经验、依据和边界；
- 模型伪造 `explicit` 但无法提供本轮用户原话证据时，后端降级为 `inferred`；
- 用户确认前不创建 Package；
- 确认后只创建一个 Skill Version v1，底层只创建一个内部 Package v1；
- 失败时不产生半成品 Package，重试不会重复创建；
- 用户不能读取或修改其他用户的创建会话；
- 创建成功后可以通过 `skill_id` 打开 Skill 工作区；
- 当前 `/` 工作台在用户最终审核前保持可用。
