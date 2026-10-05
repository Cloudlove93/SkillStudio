# code/backend（后端）

对应现有实现：仓库根目录的 **`educlaw-server`** 模块（FastAPI 服务，提供认证、Skill 包管理、对话工作台、Arena、版本管理等 API）。

为避免破坏现有物理结构与运行环境，此处不复制或移动代码，仅建立目录映射关系：

| 作业目录 | 现有实现 |
| --- | --- |
| `code/backend` | [`educlaw-server/`](../../educlaw-server) |
| `code/frontend` | [`educlaw-web/`](../../educlaw-web) |
| `code/core_engine` | [`openagent/`](../../openagent)（@openagent/core 智能体运行时，未来 skill+agent 引擎） |
