# 工程一资产中心交付与验收记录

2026-11-09 · 基线 `68e4815` · 工作分支 `codex/p1-asset-center`

依据工作簿的“总览”“任务明细”“接口与协作边界”“验收清单”“风险与待确认”五个子表实施。工作簿中“未开始”是分工表初始状态，本记录以当前代码和本次执行证据描述完成情况。[分工工作簿](/Users/josephqy/CODE/SkillStudio/docs/EduSkill-Agent-Skill-四项工程分工.xlsx)

## 任务对应

| 编号 | 本次交付 | 验证与状态 |
| --- | --- | --- |
| E1-01 | 一页设计规范、路由表、组件清单、协作接口 | 文档已交付，四人联合评审待安排 |
| E1-02 | `/agents` 双页签，`/skills` 与根路由旧仓库入口兼容 | 路由单测与浏览器深链检查通过 |
| E1-03 | 共用搜索、筛选、排序、空态、分页与卡片 | 独立页签状态、快速连续更新、全仓库分页读取测试通过 |
| E1-04 | 默认只读概览、版本、关联 Skill、运行入口 | 浏览器确认默认详情无输入/拼装控件 |
| E1-05 | 显式编辑入口、基本信息/指令/模型、Skill 选择器、测试对话 | 停用后重载、20 项上限、固定版本、409 与会话创建回归通过 |
| E1-06 | 生成结果使用共享卡片与动作 | 生成结果组件测试、导航测试与浏览器组件检查通过 |
| E1-07 | 响应式、移动端历史折叠、键盘交互、状态文字与对比度 | 375/768/1440px 检查与明暗主题测量通过 |

设计交付稿见 [资产中心设计与组件规范](/Users/josephqy/CODE/SkillStudio/docs/software/asset-center.md)。

## 验收清单对应

| 编号 | 复现步骤 | 本次结果 |
| --- | --- | --- |
| A1-01 | 打开 Agent 列表、生成结果、Skill 详情，检查卡片与动作区 | 三处复用 `AssetCard`，截图已检查 |
| A1-02 | 从列表点 Agent 名称，再点“编辑配置” | 默认只读，点击后才挂载编辑器与 Skill 选择器 |
| A1-03 | 连续输入搜索词、改状态/排序，切到 Skill 后再返回并刷新 | 每个页签的条件独立保留，快速输入覆盖问题已有回归用例 |
| A1-04 | 访问 `/skills`、旧仓库带 Skill 参数、旧 `agentId/conversation` 链接 | 到达对应列表、Skill 详情或历史会话 |

## 自动检查结果

| 检查 | 结果 |
| --- | --- |
| 前端标准单元测试集 | 62 个文件，429 项通过 |
| P2/P3 后端协作回归 | 4 个文件，61 项通过，覆盖 Agent 服务、运行快照、网关路由和生成持久化 |
| 浏览器交互 | 8 组通过，页面异常 0，未覆盖的模拟业务请求 0 |
| 前端生产构建 | 通过，存在构建器的大 chunk 提示 |
| 前端类型基线门禁 | 基线 257 条，当前 249 条，新增 0 条 |
| 新增资产中心与主要修改组件 ESLint | 通过 |
| `git diff --check` | 通过 |
| 前端契约测试 | 116 项，115 项通过，1 项已有失败 |

契约测试失败来自 `app-routes.test.ts` 对 `/workflow` 重定向的断言。主分支 `68e4815` 的实现已挂载 `WorkflowDemo`。另从 Git 取出该基线的原始 App、测试与设置组件到临时目录，复现相同失败。此项需要与工程四负责人统一路由约定。

完整 TypeScript 检查仍有仓库已有诊断。本次使用项目既有基线门禁核查新增错误。

## 浏览器与可访问性证据

浏览器使用 Chromium 与生产 React 页面，通过 Playwright 拦截业务 API 并提供固定数据。保存回读、409、旧会话与发送响应均为模拟服务数据，真实数据库、认证网关及模型调用仍需部署环境联合验收。生成结果截图通过专用页面装载生产 `GeneratedAgentResult` 组件，主链路导航同时由前端回归用例覆盖。

| 项目 | 浅色 | 深色 | 检查阈值 |
| --- | --- | --- | --- |
| 辅助文字对比度 | 5.49 | 8.44 | ≥4.5 |
| 主要按钮文字 | 4.89 | 4.89 | ≥4.5 |
| 当前页签文字 | 4.62 | 9.03 | ≥4.5 |
| 输入框边界 | 3.30 | 4.20 | ≥3 |

- 375px 完成详情、编辑、停用保存与对话发送，历史侧栏可展开/折叠。
- 375/768/1440px 检查页面横向溢出。
- Agent/Skill 页签方向键切换保留焦点。冲突确认框限制 Tab 焦点，Escape 取消后保留草稿。
- 输入法选词、Shift+Enter 均未触发发送，Enter 发送一次。
- 启用、停用、待配置、版本不可用均有文字表达。

机器记录见 [browser-checks.json](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/browser-checks.json)。

| 截图 | 内容 |
| --- | --- |
| [桌面资产列表](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/desktop-assets.png) | 共享列表与卡片 |
| [深色资产列表](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/dark-assets.png) | 深色主题与文字状态 |
| [Skill 详情](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/skill-detail.png) | 跨包 Skill 固定版本预览 |
| [Agent 详情](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/agent-overview.png) | 默认只读概览与编辑入口 |
| [生成结果](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/generated-result.png) | P3 结果内容使用共享卡片 |
| [移动端列表](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/mobile-assets.png) | 单列布局与筛选 |
| [移动端编辑](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/mobile-editor.png) | 停用状态与固定版本 |
| [移动端对话](/Users/josephqy/CODE/SkillStudio/docs/acceptance/evidence/p1-asset-center/mobile-conversation.png) | 折叠历史与键盘发送 |

## 其余子表的协作要求

- P1/P3 共享 `AgentSummary`。列表和详情消费服务端返回对象，生成结果消费既有生成契约。跨包副本详情使用 `previewPackage` 与固定版本参数，版本归属校验失败显示错误。
- P2 的 `agentExecution` 与历史线程读取继续通过现有组件。详情、编辑和会话中的 Skill 跳转传递 `skillVersionId`。`autochat` 等待历史加载成功，消费后移除参数，相关原有回归用例通过。
- P3 的旧 skill-only 生成结果保留转换入口。仓库记录沿用服务端 origin 去重语义，前端以记录 ID 合并分页。
- P4 的工作流页签与 feature flag 由工程四实现和验收。本次 Agent 编辑容器提供明确的编辑区。主分支已有全局工作流页面，其入口与分工表的灰度约定需在 P4 联合验收时对齐。
- CAS 继续使用 `expectedUpdatedAt`。409 保留本地输入，重载需用户确认。422 的资源不可用错误通过既有保存/会话流程反馈。

## 复测方式

在项目已安装依赖并可使用 Node、pnpm 的环境中运行。

```sh
cd /Users/josephqy/CODE/SkillStudio
pnpm --filter @educlaw/shared build
pnpm --filter educlaw-web test:unit
pnpm --filter educlaw-web check:types
pnpm --filter educlaw-web build
pnpm --filter educlaw-web test:contracts
```

浏览器脚本需要可用的 Playwright 模块和 Chromium。本次使用 Node 24.22.1。模块和浏览器路径可以通过 `--playwright`、`--browsers` 指定，服务地址可用 `ASSET_CENTER_URL` 覆盖。先在一个终端启动 Vite 到 5174。

```sh
cd /Users/josephqy/CODE/SkillStudio
pnpm --filter educlaw-web dev --host 127.0.0.1 --port 5174 --strictPort
```

在另一个终端运行检查。下面的路径对应本次验收环境。

```sh
node /Users/josephqy/CODE/SkillStudio/educlaw-web/test-utils/asset-center-browser.mjs \
  --playwright /Users/josephqy/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs \
  --browsers /private/tmp/skillstudio-playwright
```

当前仍待四位负责人联合评审 E1-01，并在部署环境用真实账号、数据库和模型复核生成到对话的完整链路。
