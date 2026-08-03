# Skill 创建下拉菜单与文档模式 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在当前运行版上仅把创建方式改成下拉菜单、恢复多文档生成模式，并简化对话中的教学材料附件入口。

**Architecture:** 保留 `SkillFirstWorkspace` 的现有三栏结构和主题样式。`SkillWorkspaceSidebar` 只负责创建方式下拉菜单；新增独立的 `DocumentSkillCreationPanel` 复用现有 `/packages/generate/stream`，通过纯状态工具管理多文档批量任务；`GuidedSkillCreationPanel` 只做附件按钮的视觉简化。

**Tech Stack:** React 19、TypeScript、Vitest、现有 `liteApi.generatePackageStream`、Mammoth、CSS。

---

### Task 1: 锁定创建菜单和材料入口的 UI 合约

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: 写失败的菜单与材料入口测试**

将现有“左侧常驻创建方式”断言替换为以下合约：

```ts
it('opens five Skill creation modes from a compact menu', () => {
  const source = read('./SkillWorkspaceSidebar.tsx');

  expect(source).toContain('skill-create-menu');
  expect(source).toContain('自然对话创建');
  expect(source).toContain('从描述文档生成');
  expect(source).toContain('从模板创建');
  expect(source).toContain('导入已有 Skill');
  expect(source).toContain('空白创建');
  expect(source).not.toContain('skill-sidebar-subnav" aria-label="新建 Skill 的方式');
});

it('keeps teaching material upload as a compact reference attachment', () => {
  const source = read('./GuidedSkillCreationPanel.tsx');

  expect(source).toContain('skill-material-icon-button');
  expect(source).toContain('title="添加教学材料"');
  expect(source).not.toContain('<strong>{props.createMode');
  expect(source).not.toContain('DOCX、Markdown、TXT，也可拖入');
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter educlaw-web test`

Expected: `skill-workspace-ui.test.ts` 因缺少 `skill-create-menu`、`从描述文档生成` 和 `skill-material-icon-button` 失败。

- [ ] **Step 3: 提交测试**

```bash
git add educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts
git commit -m "test: define compact Skill creation controls"
```

### Task 2: 将五种创建方式改成下拉菜单

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: 扩展创建模式类型和固定菜单文案**

在 `SkillWorkspaceSidebar.tsx` 中将类型和配置改为：

```ts
export type SkillCreateMode =
  | 'conversation'
  | 'document'
  | 'template'
  | 'import'
  | 'manual';

const creationModes = [
  { mode: 'conversation', label: '自然对话创建', description: '通过问答逐步生成', icon: MessageSquareText },
  { mode: 'document', label: '从描述文档生成', description: '一份文档生成一个 Skill', icon: FileText },
  { mode: 'template', label: '从模板创建', description: '选择教育场景后调整', icon: LayoutTemplate },
  { mode: 'import', label: '导入已有 Skill', description: '导入标准 Skill ZIP', icon: FileUp },
  { mode: 'manual', label: '空白创建', description: '直接编辑 SKILL.md', icon: PencilLine },
] as const;
```

- [ ] **Step 2: 用按钮锚定的下拉菜单替换常驻子导航**

使用组件内 `createMenuOpen` 状态；点击“新建 Skill”切换菜单，选择方式时依次调用 `onCreateMode(mode)` 和 `setCreateMenuOpen(false)`。菜单结构保持在 `.skill-sidebar-commands` 附近，并为菜单按钮提供 `aria-expanded`、`aria-haspopup="menu"` 与 `role="menuitem"`。

- [ ] **Step 3: 添加与现有变量一致的菜单样式**

新增 `.skill-create-menu`、`.skill-create-menu-item`、`.skill-create-menu-icon` 和 `.skill-create-menu-copy`。只使用 `var(--card)`、`var(--border)`、`var(--primary-soft)`、`var(--muted-foreground)` 和现有阴影变量，不修改 `.skill-workspace-root`、`.skill-sidebar`、`.skill-main-stage` 或主题变量。

- [ ] **Step 4: 运行 UI 合约测试**

Run: `pnpm --filter educlaw-web test`

Expected: 菜单合约通过；文档面板与材料按钮相关测试仍失败。

- [ ] **Step 5: 提交菜单实现**

```bash
git add educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx educlaw-web/src/components/skill-workspace/skill-workspace.css educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts
git commit -m "feat: open Skill creation modes from a menu"
```

### Task 3: 恢复独立的多文档 Skill 生成模式

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/document-skill-creation-state.ts`
- Create: `educlaw-web/src/components/skill-workspace/document-skill-creation-state.test.ts`
- Create: `educlaw-web/src/components/skill-workspace/DocumentSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/pages/SkillFirstWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

- [ ] **Step 1: 写批量任务纯状态测试**

```ts
import { describe, expect, it } from 'vitest';
import { createDocumentBatchPlan, summarizeDocumentBatch } from './document-skill-creation-state';

describe('document Skill creation state', () => {
  it('creates one generation task per document', () => {
    const plan = createDocumentBatchPlan(
      [{ name: 'a.docx', content: 'a' }, { name: 'b.md', content: 'b' }],
      100,
    );
    expect(plan.map((item) => [item.name, item.status])).toEqual([
      ['a.docx', 'waiting'],
      ['b.md', 'waiting'],
    ]);
  });

  it('summarizes mixed completion without losing failures', () => {
    expect(summarizeDocumentBatch([
      { id: '1', name: 'a', status: 'done', packageId: '10' },
      { id: '2', name: 'b', status: 'error', error: '生成失败' },
    ])).toEqual({ successCount: 1, failureCount: 1 });
  });
});
```

- [ ] **Step 2: 运行状态测试确认失败**

Run: `pnpm --filter educlaw-web test`

Expected: 找不到 `document-skill-creation-state`。

- [ ] **Step 3: 实现状态类型与纯函数**

定义 `DocumentBatchRun`、`createDocumentBatchPlan(documents, now)` 和 `summarizeDocumentBatch(runs)`，确保任务 ID 同时包含时间、索引和文件名。

- [ ] **Step 4: 实现独立文档生成面板**

`DocumentSkillCreationPanel` 接收：

```ts
type Props = {
  token: string;
  onGenerated: () => Promise<void> | void;
};
```

面板要求：

- 文件输入接受 `.txt,.md,.docx,.csv,.json,.yaml,.yml,.js,.ts,.py,.html,.css`。
- DOCX 使用 `mammoth.extractRawText`，其他文件使用 `file.text()`。
- 单文档调用一次 `liteApi.generatePackageStream(token, instruction, undefined, [document], onEvent)`。
- 多文档为每份文档单独调用一次，最多同时运行 2 个任务。
- 每个任务显示 `waiting`、`running`、`done` 或 `error`；失败不取消其他文档。
- 全部结束后调用 `onGenerated()` 刷新仓库，并保留失败项供用户查看。

- [ ] **Step 5: 在工作区只按 `document` 模式切换面板**

在 `SkillFirstWorkspace.tsx` 当前创建视图分支中使用：

```tsx
createMode === 'document' ? (
  <DocumentSkillCreationPanel
    token={token}
    onGenerated={async () => {
      await refreshRepository();
      dispatchWorkspace({ type: 'navigate', view: 'repository' });
    }}
  />
) : (
  <GuidedSkillCreationPanel ... />
)
```

不改变完成 Skill 的运行、测试、优化或版本分支。

- [ ] **Step 6: 添加面板样式与静态合约断言**

样式只新增 `.skill-document-create-*` 选择器，复用现有颜色、圆角和阴影变量；测试确认 `SkillFirstWorkspace.tsx` 包含 `createMode === 'document'` 和 `DocumentSkillCreationPanel`。

- [ ] **Step 7: 运行前端测试**

Run: `pnpm --filter educlaw-web test`

Expected: 全部 Skill 工作区测试通过。

- [ ] **Step 8: 提交文档生成模式**

```bash
git add educlaw-web/src/components/skill-workspace/document-skill-creation-state.ts educlaw-web/src/components/skill-workspace/document-skill-creation-state.test.ts educlaw-web/src/components/skill-workspace/DocumentSkillCreationPanel.tsx educlaw-web/src/pages/SkillFirstWorkspace.tsx educlaw-web/src/components/skill-workspace/skill-workspace.css educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts
git commit -m "feat: restore document-based Skill generation"
```

### Task 4: 简化教学材料附件入口

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/GuidedSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`

- [ ] **Step 1: 将两行材料卡片替换为图标按钮**

```tsx
<button
  className="skill-material-icon-button"
  onClick={() => fileInputRef.current?.click()}
  title="添加教学材料"
  aria-label="添加教学材料"
>
  <Paperclip size={16} />
</button>
```

导入 ZIP 模式仍使用独立导入页面，不复用该按钮。

- [ ] **Step 2: 删除旧材料卡片样式并添加紧凑图标样式**

删除 `.skill-material-button`、其 `strong`、`small` 和内部纵向布局；新增 29×29 像素的 `.skill-material-icon-button`，默认透明背景，悬浮时使用 `var(--skill-hover)`。

- [ ] **Step 3: 运行前端测试、Lint 与构建**

Run:

```bash
pnpm --filter educlaw-web test
pnpm --filter educlaw-web lint
pnpm --filter educlaw-web build
```

Expected: 测试全部通过，ESLint 无错误，Vite 生产构建成功。

- [ ] **Step 4: 提交材料入口微调**

```bash
git add educlaw-web/src/components/skill-workspace/GuidedSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/skill-workspace.css
git commit -m "style: simplify teaching material attachment"
```

### Task 5: 本地容器验证与回退确认

**Files:**
- No source file changes expected.

- [ ] **Step 1: 构建新的本地前端镜像**

Run: `docker compose build educlaw-web`

Expected: `educlaw-web:latest` 构建成功。

- [ ] **Step 2: 只切换本地前端容器**

Run: `docker compose up -d --no-build educlaw-web`

Expected: `educlaw-educlaw-web-1` 重新创建并运行；认证、Kong、后端和数据库不重启。

- [ ] **Step 3: 验证本地域名与静态资源**

Run:

```powershell
curl.exe -sS -D - -o NUL http://eduskill.localhost/login
curl.exe -sS -H "Host: eduskill.localhost" http://127.0.0.1/healthz
docker compose logs --since=5m educlaw-web
```

Expected: `/login` 返回 200，`/healthz` 返回 `{"ok":true}`，前端日志没有 error 或 fatal。

- [ ] **Step 4: 浏览器人工验收**

验证：外围圆角和配色未变化；点击“新建 Skill”出现五项菜单；“从描述文档生成”支持多文件独立任务；自然对话输入框只显示简洁附件图标；其他 Skill 功能仍可进入。
