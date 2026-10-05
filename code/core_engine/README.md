# code/core_engine（核心引擎）

对应现有实现：

- **`openagent/`**（`@openagent/core`）：框架无关的智能体运行时原语，承载聊天传输与消息处理，是未来 skill+agent 平台的核心引擎基础；
- Skill 生成、蒸馏、融合、答案优化等算法逻辑当前分布于 `educlaw-server` 中（见 `docs/algorithm/`）；
- 未来演进方向：**skill+agent 平台**，核心引擎将承载 Skill 编排与智能体运行时。

为避免破坏现有物理结构与运行环境，此处不复制或移动代码，仅建立目录映射关系（映射表见 [`code/backend/README.md`](../backend/README.md)）。
