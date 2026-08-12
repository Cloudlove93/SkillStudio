# Answer Optimization Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将回答优化右栏改造成与主平台一致的、自适应且可拖拽的对话与状态工作区。

**Architecture:** 保留 `SkillAnswerOptimizationPanel` 的 API 与业务状态，在组件内部划分对话、状态和底部输入区；新增一个纯前端尺寸状态 helper 负责自动、手动和收起模式。`SkillContextPanel` 继续负责右栏容器，CSS 统一聊天样式、无滚动条和水平输入基线。

**Tech Stack:** React 19、TypeScript、Vitest、CSS、Lucide React。

---

### Task 1: 定义状态区尺寸行为

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/answer-optimization-panel-layout.ts`
- Create: `educlaw-web/src/components/skill-workspace/answer-optimization-panel-layout.test.ts`

- [ ] **Step 1: Write the failing test**

覆盖自动模式、拖拽高度上下限、收起和双击恢复自动模式。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace educlaw-web test -- answer-optimization-panel-layout.test.ts`
Expected: FAIL because the layout helper does not exist.

- [ ] **Step 3: Write minimal implementation**

提供 `clampStatusPanelHeight`、`createManualPanelLayout`、`collapsePanelLayout` 和 `resetPanelLayout`，不依赖 DOM。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace educlaw-web test -- answer-optimization-panel-layout.test.ts`
Expected: PASS.

### Task 2: 固化回答优化面板结构

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/SkillAnswerOptimizationPanel.tsx`

- [ ] **Step 1: Write the failing test**

断言面板具有对话区、可拖拽分隔线、修改/测试页签、状态区、固定底部输入框、原回答 Skill 语义和无旧卡片结构。

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --workspace educlaw-web test -- skill-workspace-ui.test.ts`
Expected: FAIL on the new structure assertions.

- [ ] **Step 3: Implement the approved structure**

保留 create/rebase/test/confirm 调用与错误分支；将反馈输入和后续反馈统一放到底部；将 diagnosis 作为 Skill 回复，将 diff 和 testResult 分别放入状态页签；保存完成提供重新运行按钮。

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --workspace educlaw-web test -- skill-workspace-ui.test.ts`
Expected: PASS.

### Task 3: 实现拖拽、自适应与收起交互

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/SkillAnswerOptimizationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/answer-optimization-panel-layout.test.ts`

- [ ] **Step 1: Extend the failing tests**

增加 pointer drag、double-click reset、collapse/restore 对应的状态转换断言。

- [ ] **Step 2: Run tests and verify failure**

Run: `npm --workspace educlaw-web test -- answer-optimization-panel-layout.test.ts skill-workspace-ui.test.ts`
Expected: FAIL on unimplemented interactions.

- [ ] **Step 3: Add component interaction**

使用 pointer capture 计算状态区高度；拖拽后设置手动高度，双击恢复 auto，收起后保留标题行。状态页签切换在 auto 模式下重新使用内容高度。

- [ ] **Step 4: Run tests and verify pass**

Run: `npm --workspace educlaw-web test -- answer-optimization-panel-layout.test.ts skill-workspace-ui.test.ts`
Expected: PASS.

### Task 4: 统一视觉与响应式行为

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: Write failing CSS contract assertions**

断言状态区内容隐藏滚动条、回复框尺寸复用主平台变量、拖拽手柄和状态区最小高度存在。

- [ ] **Step 2: Run test and verify failure**

Run: `npm --workspace educlaw-web test -- skill-workspace-ui.test.ts`
Expected: FAIL on missing CSS contracts.

- [ ] **Step 3: Implement styles**

移除旧的卡片套卡片样式，设置统一背景、细分隔线、自动内容高度、对话最小高度、无滚动条、拖拽反馈、窄视口限制以及与中间回复框一致的间距。

- [ ] **Step 4: Run targeted tests**

Run: `npm --workspace educlaw-web test -- skill-workspace-ui.test.ts answer-optimization-panel-layout.test.ts`
Expected: PASS.

### Task 5: 完整验证

**Files:**
- Verify only.

- [ ] **Step 1: Run all web tests**

Run: `npm --workspace educlaw-web test`
Expected: all tests PASS.

- [ ] **Step 2: Run lint**

Run: `npm --workspace educlaw-web run lint`
Expected: exit code 0.

- [ ] **Step 3: Run production build**

Run: `npm --workspace educlaw-web run build`
Expected: exit code 0.

- [ ] **Step 4: Inspect the local formal page**

确认运行、测试和 Arena 均能打开回答优化右栏；拖拽、复位、收起、页签、测试、保存与重新运行有效，其他工作区视图无回归。
