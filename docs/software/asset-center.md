# 工程一资产中心设计与组件规范

2026-11-09 · E1-01 交付稿 · 待四位工程负责人联合评审

## 一页设计规范

### 信息架构与路由

教师从资产中心查找 Agent 与 Skill，打开只读详情，再按需要进入编辑配置或 Agent 对话。主页继续承载生成入口与生成草稿。

| 入口 | 页面与行为 |
| --- | --- |
| `/agents` | 默认 Agent 页签 |
| `/agents?tab=skills` | Skill 页签，与 Agent 共用列表组件 |
| `/agents?agentId=<id>` | Agent 只读概览、指令、版本记录、关联 Skill |
| `/agents?create=agent` | 新建 Agent 配置表单 |
| `/agents?agentId=<id>&conversation=<id>` | 恢复指定历史对话及固定版本 |
| `/agents?agentId=<id>&autochat=1` | 复用已有对话，或在历史加载成功后新建对话 |
| `/agents?tab=skills&previewSkill=<id>&previewPackage=<id>&skillVersion=<id>` | 按包与可选固定版本打开 Skill 只读详情 |
| `/skills`、`/?view=repository`、`/?view=my-skills` | 兼容跳转到资产中心 Skill 页签 |
| `/skills` 携带 `agentId` / `skillId` | 保留参数转到 `/agents` |
| `/skills?view=versions&skill=<package>:<skill>` 等历史功能链接 | 转到根路由对应历史功能，保留查询参数与锚点 |

### 展示与操作

- 卡片统一为类型图标、名称、描述、键值信息、动作区。Agent 展示模型、启用数/绑定数、当前版本、可用状态、最近对话。Skill 展示版本、来源与更新时间。
- Agent 详情默认只读。点击“编辑配置”切换到独立编辑面板，可修改名称、描述、指令、模型与 Skill 绑定。测试对话由现有 Agent 接口创建。
- Skill 总绑定数上限为 20，停用项计入上限。每项保存明确的 `skillVersionId` 与 `enabled`。至少一个 Skill 启用且全部启用项可用时，显示“可使用”。
- 两个页签独立保存搜索、状态、排序与页码到 URL。搜索名称/描述，状态分为全部、可使用、待配置，排序支持最近更新、最早更新、名称，每页 12 项。先取得完整仓库分页，再筛选和分页展示。
- 加载、空仓库、无匹配、读取失败分别反馈。失败可重试。保存携带 `expectedUpdatedAt`，409 保留编辑内容并提供确认重载。页面内离开与浏览器刷新提示未保存内容。
- 生成结果复用 `AssetCard`，保留“进入 Agent 对话”“查看 Skill”，历史生成记录保留“转为 Agent”。Skill 详情提供预览、版本管理、导出和资产管理操作。
- 桌面三列、中屏两列、窄屏单列。移动端对话历史默认折叠。页签支持方向键与 Home/End，控件有可见焦点，状态使用文字，输入法选词与 Shift+Enter 保留输入，Enter 发送。

### 协作接口

P1 直接消费共享 `AgentSummary` 与既有 `RepositorySkillRecord`。`currentVersion` 表示包版本 ID，卡片显示 `#ID`，版本历史显示 `v版本号`。跨包副本按服务端包/Skill/版本定位，仓库去重由 P3 服务端决定。

P2 继续负责 `agentExecution`、会话幂等与运行快照。P1 的详情、编辑和历史对话跳转携带固定版本。P3 负责生成事务、来源字段与结果数据，P1 提供卡片样式和导航容器。P4 后续在编辑容器集成工作流页签并由其 feature flag 控制挂载，Agent 概览与列表保持独立组件。

## 组件清单

| 组件 | 职责 | 复用位置 |
| --- | --- | --- |
| `AssetCenter` | 双页签、URL 状态、数据读取、详情导航、批量管理 | `/agents` 与旧入口跳转落点 |
| `AssetList` | 搜索、筛选、排序、空态、错误、分页 | Agent / Skill 列表 |
| `AssetCard` | 类型、标题、描述、元数据、动作区，支持详情形态 | 列表、Agent/Skill 详情、生成结果 |
| `AgentAssetCard` | 消费 `AgentSummary`，加载最近对话 | Agent 列表 |
| `AgentOverview` | 只读指令、版本记录、关联 Skill | Agent 详情 |
| `SkillAssetDetail` | 固定版本预览、版本切换、导出与管理入口 | Skill 详情 |
| `AgentWorkspacePanel` | 详情/编辑/对话切换，保存与冲突处理 | 资产中心内嵌工作区 |
| `AgentSkillPicker` | 20 项上限、启用状态、版本锁定 | 编辑配置 |
| `AgentConversation` / `SkillRunWorkspace` | 固定会话快照与发送交互 | Agent 运行/测试对话 |
| `GeneratedAgentResult` | 消费 P3 结果数据，复用资产卡片 | 生成完成页 |
| `useSkillVersions` / `SkillExportDialog` | 复用既有版本分页与导出逻辑 | Skill 详情与编辑器 |

实现集中于 [资产中心组件目录](/Users/josephqy/CODE/SkillStudio/educlaw-web/src/components/asset-center)。验收方法与结果见 [工程一验收记录](/Users/josephqy/CODE/SkillStudio/docs/acceptance/2026-11-09-p1-asset-center.md)。
