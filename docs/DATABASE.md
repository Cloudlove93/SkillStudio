# EduClaw Arena 数据库设计文档

数据库：PostgreSQL 17+
Schema 定义入口：`educlaw-server/src/services/db-schema.ts`

---

## 表总览

| 表名                              | 说明                           | 主键               |
| --------------------------------- | ------------------------------ | ------------------ |
| agent_packages                    | 智能体包                       | `id` (bigserial) |
| agent_package_versions            | 智能体包版本                   | `id` (bigserial) |
| arena_threads                     | Arena 对话线程                 | `id` (bigserial) |
| arena_messages                    | Arena 对话消息                 | `id` (bigserial) |
| arena_runs                        | Arena 评估运行记录             | `id` (bigserial) |
| optimization_runs                 | 优化运行记录                   | `id` (bigserial) |
| interactive_optimization_sessions | 交互式优化会话                 | `id` (bigserial) |
| auto_eval_specs                   | 自动评估规格（每用户每包一条） | `id` (bigserial) |
| auto_eval_runs                    | 自动评估运行记录               | `id` (bigserial) |

> `users` 表由外部认证服务管理，不在本 schema 中定义。应用通过 `x-user-id` / `x-user-username` / `x-user-email` 请求头获取用户身份。

---

## 表结构详情

### agent_packages — 智能体包

存储用户创建的智能体包元信息，指向当前生效的版本。

```sql
CREATE TABLE agent_packages (
  id                 BIGSERIAL PRIMARY KEY,       -- 自增主键
  user_id            TEXT NOT NULL,               -- 创建者 ID
  name               TEXT NOT NULL,               -- 包名称
  description        TEXT NOT NULL DEFAULT '',    -- 包描述
  current_version_id BIGINT NOT NULL,             -- 当前版本 ID → agent_package_versions.id
  created_at         TIMESTAMPTZ NOT NULL,        -- 创建时间
  updated_at         TIMESTAMPTZ NOT NULL         -- 最后更新时间
);

CREATE INDEX idx_agent_packages_user_id ON agent_packages (user_id);
```

**关系：**

- `current_version_id` → `agent_package_versions.id`
- `user_id` 由外部认证服务管理

---

### agent_package_versions — 智能体包版本

每次生成、导入、优化或手动编辑都会创建一个新版本，保留完整快照用于回溯和对比。

```sql
CREATE TABLE agent_package_versions (
  id             BIGSERIAL PRIMARY KEY,           -- 自增主键
  package_id     BIGINT NOT NULL,                 -- 所属包 ID → agent_packages.id
  version_number INTEGER NOT NULL,                -- 版本号（递增）
  source         TEXT NOT NULL,                   -- 来源：generated | imported | optimized | manual | interactive
  snapshot_json  JSONB NOT NULL,                  -- 完整快照 JSON（包含 agentMd, rubricMd, skills 等）
  note           TEXT NOT NULL DEFAULT '',        -- 版本备注
  created_at     TIMESTAMPTZ NOT NULL             -- 创建时间
);

CREATE INDEX idx_agent_package_versions_package_id ON agent_package_versions (package_id);
```

**关系：**

- `package_id` → `agent_packages.id`

**snapshot_json 结构（JSON）：**

```jsonc
{
  "name": "智能体名称",
  "description": "描述",
  "versionLabel": "v1",
  "agentMd": "智能体 Markdown 定义",
  "rubricMd": "评分标准 Markdown",
  "skills": [
    {
      "id": "skill-id",         // 应用层生成的 UUID 字符串（非 DB 主键）
      "dirName": "core-task",
      "name": "技能名称",
      "description": "技能描述",
      "skillMd": "技能 Markdown 定义"
    }
  ]
}
```

---

### arena_threads — Arena 对话线程

每个线程代表一次 Arena 评测对话，关联到一个智能体包。

```sql
CREATE TABLE arena_threads (
  id         BIGSERIAL PRIMARY KEY,           -- 自增主键
  user_id    TEXT NOT NULL,                   -- 创建者 ID
  package_id BIGINT NOT NULL,                 -- 关联的智能体包 ID → agent_packages.id
  title      TEXT NOT NULL,                   -- 线程标题
  model      TEXT,                            -- 使用的模型（可选，为空则用默认模型）
  created_at TIMESTAMPTZ NOT NULL,            -- 创建时间
  updated_at TIMESTAMPTZ NOT NULL             -- 最后更新时间
);

CREATE INDEX idx_arena_threads_user_id ON arena_threads (user_id);
CREATE INDEX idx_arena_threads_package_id ON arena_threads (package_id);
```

**关系：**

- `package_id` → `agent_packages.id`
- `user_id` 由外部认证服务管理

---

### arena_messages — Arena 对话消息

存储 Arena 对话中的每一条消息，支持三方对话：用户共享消息、baseline 回复、enhanced 回复。

```sql
CREATE TABLE arena_messages (
  id         BIGSERIAL PRIMARY KEY,           -- 自增主键
  thread_id  BIGINT NOT NULL,                 -- 所属线程 ID → arena_threads.id
  user_id    TEXT NOT NULL,                   -- 发送者 ID
  side       TEXT NOT NULL,                   -- 对话方：shared | baseline | enhanced
  role       TEXT NOT NULL,                   -- 角色：user | assistant
  content    TEXT NOT NULL,                   -- 消息内容
  created_at TIMESTAMPTZ NOT NULL             -- 创建时间
);

CREATE INDEX idx_arena_messages_user_id ON arena_messages (user_id);
```

**关系：**

- `thread_id` → `arena_threads.id`

**side 枚举说明：**

- `shared` — 用户发送的共享消息，两侧都可见
- `baseline` — baseline 模型的回复
- `enhanced` — enhanced 模型（带智能体包）的回复

---

### arena_runs — Arena 评估运行记录

存储 Arena 对话的评估报告生成记录。

```sql
CREATE TABLE arena_runs (
  id          BIGSERIAL PRIMARY KEY,              -- 自增主键
  session_id  TEXT NOT NULL,                      -- 会话 ID
  package_id  BIGINT NOT NULL,                    -- 关联的智能体包 ID
  target_kind TEXT NOT NULL DEFAULT 'profile',    -- 评估目标类型
  target_ref  TEXT NOT NULL,                      -- 评估目标引用
  model       TEXT,                               -- 评估使用的模型
  state       SMALLINT NOT NULL DEFAULT 1,         -- 状态：0=pending, 1=completed, 2=failed
  report_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- 评估报告 JSON
  created_at  TIMESTAMPTZ NOT NULL,               -- 创建时间
  updated_at  TIMESTAMPTZ NOT NULL                -- 最后更新时间
);

CREATE INDEX idx_arena_runs_session_id ON arena_runs (session_id);
CREATE INDEX idx_arena_runs_package_id ON arena_runs (package_id);
```

**report_json 结构（JSON）：**

```jsonc
{
  "threadId": 123,
  "baseline": {
    "summary": "baseline 总结",
    "total": 85,
    "dimensions": [
      { "key": "accuracy", "name": "准确性", "score": 9, "maxScore": 10, "reason": "评分理由" }
    ]
  },
  "enhanced": {
    "summary": "enhanced 总结",
    "total": 92,
    "dimensions": [ /* 同上 */ ]
  },
  "recommendation": "推荐建议",
  "winningSide": "enhanced"   // baseline | enhanced | tie
}
```

---

### optimization_runs — 优化运行记录

存储自动优化流程的执行记录和结果。

```sql
CREATE TABLE optimization_runs (
  id          BIGSERIAL PRIMARY KEY,              -- 自增主键
  package_id  BIGINT NOT NULL,                    -- 关联的智能体包 ID
  thread_id   BIGINT NOT NULL,                    -- 关联的 Arena 线程 ID
  target_kind TEXT NOT NULL DEFAULT 'profile',    -- 优化目标类型
  target_ref  TEXT NOT NULL,                      -- 优化目标引用
  model       TEXT,                               -- 优化使用的模型
  status      TEXT NOT NULL DEFAULT 'pending',    -- 状态：pending | applied | rejected
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- 优化结果 JSON
  created_at  TIMESTAMPTZ NOT NULL,               -- 创建时间
  updated_at  TIMESTAMPTZ NOT NULL                -- 最后更新时间
);

CREATE INDEX idx_optimization_runs_package_id ON optimization_runs (package_id);
```

**result_json 结构（JSON）：**

```jsonc
{
  "packageId": 1,
  "versionId": 2,
  "versionNumber": 2,
  "issues": [
    {
      "expert": "persona",        // persona | skill | rubric | merge
      "target": "agent",          // agent | skill | rubric
      "targetId": "目标 ID",
      "title": "问题标题",
      "reason": "问题原因",
      "evidence": ["证据1", "证据2"]
    }
  ],
  "snapshot": { /* AgentPackageSnapshot */ }
}
```

---

### interactive_optimization_sessions — 交互式优化会话

存储用户与系统之间的交互式优化对话，支持多轮对话和逐步采纳修改。

```sql
CREATE TABLE interactive_optimization_sessions (
  id             BIGSERIAL PRIMARY KEY,           -- 自增主键
  user_id        TEXT NOT NULL,                   -- 用户 ID
  package_id     BIGINT NOT NULL,                 -- 关联的智能体包 ID
  thread_id      BIGINT NOT NULL,                 -- 关联的 Arena 线程 ID
  status         TEXT NOT NULL DEFAULT 'active',  -- 状态：active | completed
  messages_json  JSONB NOT NULL DEFAULT '[]'::jsonb, -- 对话消息 JSON 数组
  issues_json    JSONB NOT NULL DEFAULT '[]'::jsonb, -- 诊断问题 JSON 数组
  adopted_json   JSONB NOT NULL DEFAULT '[]'::jsonb, -- 已采纳的修改 JSON 数组
  summary        TEXT NOT NULL DEFAULT '',        -- 会话摘要
  version_id     BIGINT,                          -- 生成的新版本 ID
  version_number INTEGER,                         -- 生成的新版本号
  created_at     TIMESTAMPTZ NOT NULL,            -- 创建时间
  updated_at     TIMESTAMPTZ NOT NULL             -- 最后更新时间
);

CREATE INDEX idx_interactive_optimization_sessions_user_id ON interactive_optimization_sessions (user_id);
CREATE INDEX idx_interactive_optimization_sessions_package_id ON interactive_optimization_sessions (package_id);
```

**关系：**

- `package_id` → `agent_packages.id`
- `version_id` → `agent_package_versions.id`

---

### auto_eval_specs — 自动评估规格

每个用户每个包最多一条规格，定义评估问题和评分维度。

```sql
CREATE TABLE auto_eval_specs (
  id              BIGSERIAL PRIMARY KEY,          -- 自增主键
  user_id         TEXT NOT NULL,                  -- 用户 ID
  package_id      BIGINT NOT NULL,                -- 关联的智能体包 ID
  questions_json  JSONB NOT NULL DEFAULT '[]'::jsonb, -- 评估问题 JSON 数组
  dimensions_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- 评分维度 JSON 数组
  created_at      TIMESTAMPTZ NOT NULL,           -- 创建时间
  updated_at      TIMESTAMPTZ NOT NULL,           -- 最后更新时间
  UNIQUE (user_id, package_id)
);

CREATE INDEX idx_auto_eval_specs_user_id ON auto_eval_specs (user_id);
```

**questions_json 结构（JSON）：**

```jsonc
[
  { "id": "q1", "title": "问题标题", "prompt": "问题内容", "source": "builtin" }
]
```

**dimensions_json 结构（JSON）：**

```jsonc
[
  { "key": "accuracy", "name": "准确性", "maxScore": 10, "description": "评分维度说明" }
]
```

---

### auto_eval_runs — 自动评估运行记录

存储每次自动评估的执行记录、问题列表和完整报告。

```sql
CREATE TABLE auto_eval_runs (
  id             BIGSERIAL PRIMARY KEY,           -- 自增主键
  user_id        TEXT NOT NULL,                   -- 用户 ID
  package_id     BIGINT NOT NULL,                 -- 关联的智能体包 ID
  scene_name     TEXT NOT NULL,                   -- 评估场景名称
  status         TEXT NOT NULL DEFAULT 'pending', -- 状态：pending | running | completed | failed
  questions_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- 评估问题 JSON 数组
  report_json    JSONB NOT NULL DEFAULT '{}'::jsonb, -- 评估报告 JSON
  error_message  TEXT NOT NULL DEFAULT '',        -- 错误信息
  created_at     TIMESTAMPTZ NOT NULL,            -- 创建时间
  updated_at     TIMESTAMPTZ NOT NULL             -- 最后更新时间
);

CREATE INDEX idx_auto_eval_runs_user_id ON auto_eval_runs (user_id);
```

**report_json 结构（JSON）：**

```jsonc
{
  "runId": 1,
  "packageId": 1,
  "sceneName": "场景名称",
  "status": "completed",
  "totalScore": 85,
  "maxScore": 100,
  "summary": "评估总结",
  "dimensions": [
    { "key": "accuracy", "name": "准确性", "score": 9, "maxScore": 10, "reason": "理由" }
  ],
  "cases": [
    {
      "questionId": "q1",
      "title": "问题标题",
      "prompt": "问题内容",
      "score": 9,
      "maxScore": 10,
      "summary": "案例总结",
      "issues": ["问题1"],
      "suggestions": ["建议1"],
      "transcript": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }]
    }
  ],
  "issues": ["全局问题"],
  "suggestions": ["全局建议"]
}
```

---

## ER 关系图

```
agent_packages ──1:N──> agent_package_versions
      │
      │ current_version_id ──────────────────> agent_package_versions.id
      │
      ├──1:N──> arena_threads ──1:N──> arena_messages
      │              │
      │              ├──1:N──> arena_runs
      │              │
      │              └──1:N──> optimization_runs
      │
      ├──1:N──> interactive_optimization_sessions
      │
      └──1:1──> auto_eval_specs ──1:N──> auto_eval_runs
```

---

## 设计约定

1. **主键**：所有主键使用 `BIGSERIAL` 类型（数据库自增），INSERT 时使用 `RETURNING id` 获取生成的 ID。
2. **外键**：引用其他表主键的列使用 `BIGINT` 类型。`user_id` 保持 `TEXT`（来自外部认证服务）。
3. **时间字段**：所有 `created_at` / `updated_at` 使用 `TIMESTAMPTZ` 类型，写入时使用 `new Date().toISOString()`。
4. **JSON 字段**：复杂结构以 JSON 字符串形式存储在 TEXT 列中，应用层负责序列化/反序列化。
5. **应用层 ID**：技能 ID（`PackageSkill.id`）等非数据库主键仍使用 UUID 字符串，由应用层 `randomUUID()` 生成。
6. **外键约束**：关系由应用层维护，数据库层未定义外键约束。
7. **Schema 迁移**：通过 `initDbSchema()` 中的 `CREATE TABLE IF NOT EXISTS` 和 `ALTER TABLE ... TYPE` 语句实现幂等迁移。
8. **排序约定**：列表查询默认按 `updated_at DESC` 排序；消息查询按 `created_at ASC` 排序。
9. **索引**：高频查询的外键和过滤列已建立索引，使用 `CREATE INDEX IF NOT EXISTS` 保证幂等。

