# 多模态 Skill 直接生成与完成页改造计划

## 目标

多模态蒸馏在用户完成内容确认和 Skill 选择后，不再强制运行 Arena。最后一步改为“确认生成”：一次请求完成确定性校验、Skill 持久化、工作区可用化和仓库收录。Arena 保留为仓库中的可选评估能力，不出现在创建向导主流程。

## 已确认的产品流程

1. 处理素材。
2. 确认内容。
3. 选择 Skill。
4. 确认生成。
5. 生成成功后可直接进入工作区试用，或返回 Skill 仓库。

“Pack”仅作为服务端聚合和版本存储概念，不在用户界面中出现。完成页不展示 Package ID、版本 ID 等工程字段。

## 服务端设计

- 新增动作 `skill.media.generate.confirm`，沿用现有鉴权、幂等键和 `expectedRevisionNo` 乐观锁。
- 允许从 `arena_testing` 直接进入 `publishing`；同时兼容已经位于 `ready_to_publish` 的历史会话。
- `arena_testing` 只是历史内部阶段名，不再表示用户必须运行 Arena。
- 确认生成时重新从当前候选构造不可变快照；历史 `ready_to_publish` 会话使用已保存快照并验证会话绑定。
- 同一事务内创建 Package/Skill 版本并将会话推进为 `published`，失败则整体回滚。
- 生成回执写入现有 `confirmation_json`，动作值允许旧的 `skill.media.publish` 和新的 `skill.media.generate.confirm`。
- 保留原 `skill.media.test.start` 与 `skill.media.publish` 接口，避免破坏历史调用和后续可选 Arena。
- 不新增表、列、FK 或 CHECK；不删除任何对象存储数据。

## 前端设计

- 第四步文案改为“确认生成”。
- 删除创建向导中的 Arena 结果、测试按钮和发布门禁提示。
- 待生成状态采用单层确认清单：标题、数量、Skill 名称和轻量“预览”操作；不使用嵌套卡片或默认展开的 accordion。
- 页面只有一个主操作：“确认生成 N 个 Skill”。请求期间按钮禁用并显示明确进度。
- 完成状态只展示“已加入工作区并保存到 Skill 仓库”，提供“进入工作区试用”和“返回 Skill 仓库”。
- 所有图标使用 Lucide；装饰图标隐藏于辅助技术；保留可见焦点、键盘操作、移动端单列和 `prefers-reduced-motion`。

## 性能预期

- 用户完成流程从“运行 Arena + 刷新 + 发布 + 刷新”缩短为“确认生成 + 刷新”。
- 默认流程减少一次模型评估和一轮发布交互。
- 完成页不再渲染 Arena 用例详情和多层 `details` DOM。
- 不引入新 UI 依赖或网络字体，保持多模态功能独立懒加载。

## 测试与验收

1. 先写失败测试：状态机允许直接生成；服务无 Arena 回执也能生成；历史阶段兼容；路由与客户端动作正确；UI 不含强制 Arena。
2. 实现后运行服务端定向测试、前端向导测试、lint、全量 server test、shared/server/web build。
3. 比较改造前后的多模态 chunk（基线 74.42 kB / gzip 23.72 kB）和默认流程网络动作数。
4. 在 Docker 环境验证：新会话直接生成、旧会话继续生成、刷新幂等、生成后工作区试用和仓库可见。
