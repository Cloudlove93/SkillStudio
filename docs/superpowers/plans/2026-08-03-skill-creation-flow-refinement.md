# Skill Creation Flow Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新建 Skill 收敛为“对话共创、文档生成、完整填写、导入 Skill”四个入口，并保持当前配色和其他工作区功能不变。

**Architecture:** 保留现有引导式创建和导入 API。自然对话组件只负责对话；结构化填写和导入分别拆成独立组件，结构化字段在提交时转换为现有引导式创建文本，导入弹窗直接调用现有 ZIP 导入函数。

**Tech Stack:** React 19、TypeScript、Vitest、现有 CSS 变量、Lucide 图标、Docker Compose。

---

### Task 1: 固定四项创建菜单契约

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx`

- [ ] **Step 1: 写失败测试**

把创建菜单测试改为断言四项新名称，并明确旧模板入口和旧名称已消失：

```ts
it('opens four focused Skill creation actions from the compact menu', () => {
  const source = read('./SkillWorkspaceSidebar.tsx');
  expect(source).toContain('对话共创');
  expect(source).toContain('文档生成');
  expect(source).toContain('完整填写');
  expect(source).toContain('导入 Skill');
  expect(source).not.toContain("mode: 'template'");
  expect(source).not.toContain('自然对话创建');
  expect(source).not.toContain('从模板创建');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter educlaw-web test -- skill-workspace-ui.test.ts`

Expected: FAIL，旧菜单仍包含五项和旧名称。

- [ ] **Step 3: 最小实现菜单**

将页面模式限制为：

```ts
export type SkillCreateMode = 'conversation' | 'document' | 'manual';
export type SkillCreateAction = SkillCreateMode | 'import';
```

菜单改为四项：

```ts
const creationModes = [
  { mode: 'conversation', label: '对话共创', description: '边聊边完善，也可从常用场景开始', icon: MessageSquareText },
  { mode: 'document', label: '文档生成', description: '一份文档生成一个 Skill', icon: FileText },
  { mode: 'manual', label: '完整填写', description: '按字段一次填写需求', icon: PencilLine },
  { mode: 'import', label: '导入 Skill', description: '导入标准 Skill ZIP', icon: FileUp },
] as const;
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter educlaw-web test -- skill-workspace-ui.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx
git commit -m "refactor: focus Skill creation menu"
```

### Task 2: 将模板收进对话共创

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/GuidedSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('uses education scenarios as conversation starters instead of a template page', () => {
  const source = read('./GuidedSkillCreationPanel.tsx');
  expect(source).toContain('从常用场景开始');
  expect(source).toContain('课堂活动设计');
  expect(source).toContain('作业反馈');
  expect(source).toContain('练习题生成');
  expect(source).not.toContain("props.createMode === 'template'");
  expect(source).not.toContain('skill-template-start');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter educlaw-web test -- skill-workspace-ui.test.ts`

Expected: FAIL，因为仍存在独立模板页面。

- [ ] **Step 3: 简化对话组件**

移除 `createMode` 和 `onImport` 属性以及模板/导入/手动模式分支。空对话页统一显示：

```tsx
<div className="skill-starter-section">
  <span>从常用场景开始</span>
  <div className="skill-starter-chips">
    {educationTemplates.map(([label, prompt]) => (
      <button key={label} onClick={() => setInput(prompt)}>{label}</button>
    ))}
  </div>
</div>
```

点击只设置输入框内容，不调用 `onSend`。

- [ ] **Step 4: 运行测试并确认通过**

Run: `pnpm --filter educlaw-web test -- skill-workspace-ui.test.ts`

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add educlaw-web/src/components/skill-workspace/GuidedSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts
git commit -m "refactor: move templates into conversation starters"
```

### Task 3: 实现轻量信息表

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/structured-skill-creation-state.ts`
- Create: `educlaw-web/src/components/skill-workspace/structured-skill-creation-state.test.ts`
- Create: `educlaw-web/src/components/skill-workspace/StructuredSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/pages/SkillFirstWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: 写状态层失败测试**

```ts
it('formats structured fields for the existing guided creation API', () => {
  expect(formatStructuredSkillRequest({
    name: '课堂活动设计', audience: '初中教师', scenario: '备课',
    task: '生成课堂活动', input: '教学目标', output: '活动方案', boundaries: '适龄',
  })).toBe('Skill 名称：课堂活动设计\n服务对象：初中教师\n使用场景：备课\n希望完成的任务：生成课堂活动\n输入内容：教学目标\n期望输出：活动方案\n需要遵守的边界：适龄');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter educlaw-web test -- structured-skill-creation-state.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现纯状态函数**

```ts
export type StructuredSkillDraft = {
  name: string; audience: string; scenario: string; task: string;
  input: string; output: string; boundaries: string;
};

export const formatStructuredSkillRequest = (draft: StructuredSkillDraft) => [
  ['Skill 名称', draft.name], ['服务对象', draft.audience], ['使用场景', draft.scenario],
  ['希望完成的任务', draft.task], ['输入内容', draft.input], ['期望输出', draft.output],
  ['需要遵守的边界', draft.boundaries],
].map(([label, value]) => `${label}：${value.trim()}`).join('\n');
```

- [ ] **Step 4: 实现表单组件**

组件使用七个真实 `input`/`textarea` 字段，规则与边界标记为可选；提交调用 `onSubmit(formatStructuredSkillRequest(draft))`。保留现有材料附件图标、文档标签和移除行为，不添加新的颜色值。

- [ ] **Step 5: 接入页面**

页面渲染顺序改为：已有会话优先显示对话；否则 `document` 显示文档生成，`manual` 显示结构化表，其余显示对话共创。

```tsx
session ? <GuidedSkillCreationPanel ... />
  : createMode === 'document' ? <DocumentSkillCreationPanel ... />
  : createMode === 'manual' ? <StructuredSkillCreationPanel onSubmit={send} ... />
  : <GuidedSkillCreationPanel ... />
```

- [ ] **Step 6: 运行状态与 UI 测试**

Run: `pnpm --filter educlaw-web test -- structured-skill-creation-state.test.ts skill-workspace-ui.test.ts`

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add educlaw-web/src/components/skill-workspace/structured-skill-creation-state.ts educlaw-web/src/components/skill-workspace/structured-skill-creation-state.test.ts educlaw-web/src/components/skill-workspace/StructuredSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts educlaw-web/src/pages/SkillFirstWorkspace.tsx
git commit -m "feat: add structured Skill creation form"
```

### Task 4: 将 ZIP 导入改为弹窗

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/SkillImportDialog.tsx`
- Modify: `educlaw-web/src/pages/SkillFirstWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
it('opens Skill ZIP import in a focused dialog', () => {
  const page = read('../../pages/SkillFirstWorkspace.tsx');
  const dialog = read('./SkillImportDialog.tsx');
  expect(page).toContain("if (mode === 'import')");
  expect(page).toContain('<SkillImportDialog');
  expect(dialog).toContain('role="dialog"');
  expect(dialog).toContain('选择 ZIP 文件');
  expect(dialog).not.toContain('<textarea');
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter educlaw-web test -- skill-workspace-ui.test.ts`

Expected: FAIL，弹窗组件尚不存在。

- [ ] **Step 3: 实现弹窗**

`SkillImportDialog` 接收 `open`、`busy`、`onClose`、`onImport`；支持点击选择和拖入单个 ZIP。Escape、遮罩点击和取消按钮关闭，导入中禁止关闭。

- [ ] **Step 4: 接入现有导入函数**

在页面中新增 `importOpen` 和 `importBusy`。`newSkill('import')` 只打开弹窗，不重置当前页面；导入成功后关闭弹窗并沿用原有刷新仓库逻辑。

- [ ] **Step 5: 运行测试并确认通过**

Run: `pnpm --filter educlaw-web test -- skill-workspace-ui.test.ts`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add educlaw-web/src/components/skill-workspace/SkillImportDialog.tsx educlaw-web/src/pages/SkillFirstWorkspace.tsx educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts
git commit -m "feat: import Skill from a focused dialog"
```

### Task 5: 样式与响应式收尾

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: 写配色约束测试**

增加静态契约：新组件类名存在，并且新增样式仅使用 `var(--foreground)`、`var(--muted-foreground)`、`var(--border)`、`var(--card)`、`var(--muted)`、`var(--primary)`、`var(--primary-foreground)`、`var(--skill-hover)`、`var(--shadow-lg)` 等现有变量。

- [ ] **Step 2: 删除旧样式并实现新样式**

删除 `.skill-template-start`、`.skill-import-dropzone` 和 `.is-import-mode`。新增 `.skill-starter-section`、`.skill-structured-*`、`.skill-import-dialog-*`，不改根布局和主题变量，不添加十六进制、rgb 或 hsl 色值。

- [ ] **Step 3: 增加窄屏规则**

在现有 `760px` 媒体查询中将结构化表单双列字段折为单列；弹窗宽度限制为视口内。

- [ ] **Step 4: 运行前端测试、Lint 和构建**

Run: `pnpm --filter educlaw-web test && pnpm --filter educlaw-web lint && pnpm --filter educlaw-web build`

Expected: 全部通过；构建只允许已有的 chunk-size 提示。

- [ ] **Step 5: 提交**

```bash
git add educlaw-web/src/components/skill-workspace/skill-workspace.css educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts
git commit -m "style: polish focused Skill creation flows"
```

### Task 6: 全量验证与本地展示

**Files:**
- No source files expected.

- [ ] **Step 1: 运行仓库检查**

Run: `pnpm check`

Expected: lint、测试和构建全部通过。

- [ ] **Step 2: 检查修改范围**

Run: `git diff c135466..HEAD --check && git diff c135466..HEAD --stat`

Expected: 仅创建流程相关组件、页面分支、测试和样式发生变化。

- [ ] **Step 3: 创建回退镜像并重建前端**

```bash
docker tag educlaw-web:latest educlaw-web:backup-before-creation-flow-refinement-20260803
docker compose build educlaw-web
docker compose up -d --no-build --no-deps educlaw-web
```

- [ ] **Step 4: 检查本地服务**

Run: `docker compose ps && curl.exe -sS -H "Host: eduskill.localhost" http://127.0.0.1/healthz`

Expected: web、server、db 均为 Up，返回 `{"ok":true}`。
