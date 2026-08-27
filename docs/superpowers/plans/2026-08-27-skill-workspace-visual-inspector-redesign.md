# Skill 工作区视觉与统一右侧栏重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `/skills` 重构为字体统一、视觉克制、上下文连续的三栏工作区，并把多模态及其他生成流程的辅助内容统一迁入非模态右侧检查器。

**Architecture:** 使用 `WorkspaceInspectorProvider` 保存轻量面板描述和开合状态，`WorkspaceInspector` 提供稳定外壳，各业务组件通过 `InspectorPortal` 把实时内容渲染到 Outlet，避免把多模态大状态提升到页面层。视觉令牌、工作区外壳、检查器、多模态和仓库样式分文件维护，旧 `skill-workspace.css` 只作为迁移期聚合入口，最终不保留重复规则。

**Tech Stack:** React 19.2、TypeScript 5.9、Vite 7、Tailwind CSS 4、Vitest 4、Radix UI、TanStack Virtual、CSS custom properties、`@fontsource-variable/noto-sans-sc` 5.3.0

**Spec:** `docs/superpowers/specs/2026-08-27-skill-workspace-visual-inspector-redesign.md`

## Global Constraints

- 只修改 `/skills` Skill-first 工作区；不重做登录页、管理后台、旧 Agent 工作台和非 `/skills` 页面。
- 不修改后端接口、数据库、Python Worker、对象存储、媒体状态机和不可变版本规则。
- 不在用户界面展示 Pack、Package、Worker、对象键或数据库 ID。
- 多模态创建不加入 Arena 发布门禁；确认生成后直接进入工作区并保存到 Skill 仓库。
- 素材和派生产物不物理删除；现有删除仍是引用或业务对象删除。
- 服务端详情是业务事实来源；Inspector、筛选、宽度和滚动位置只是 UI 状态。
- 多模态继续懒加载；转录和证据超过 50 条时必须虚拟化。
- 可读文本不得低于 `12px`；正文使用本地自托管 `Noto Sans SC Variable`。
- 桌面 Inspector 非模态、不锁焦点；只有删除、导入、未保存离开和权限确认使用模态 Dialog。
- 所有行为修改测试先行；每次先运行定向测试看到预期失败，再写实现。
- 保留工作区现有未提交文件 `educlaw-web/src/components/agent/build-components.tsx`；禁止 `git add -A`、`git add .`、reset 或 clean。
- 每次提交只暂存任务列出的路径；本计划不执行 push。

## File Map

### New files

- `educlaw-web/src/components/skill-workspace/styles/workspace-tokens.css`：字体、颜色、字号、间距、圆角、阴影、z-index 和动效令牌。
- `educlaw-web/src/components/skill-workspace/styles/workspace-shell.css`：三栏外壳、左栏、主区域和响应式断点。
- `educlaw-web/src/components/skill-workspace/styles/workspace-controls.css`：按钮、输入、菜单、状态和焦点的工作区级样式。
- `educlaw-web/src/components/skill-workspace/styles/workspace-inspector.css`：右栏、工具轨、Outlet、拖动和移动 Sheet。
- `educlaw-web/src/components/skill-workspace/styles/creation-workflows.css`：自然对话、文档和结构化创建。
- `educlaw-web/src/components/skill-workspace/styles/multimodal-workbench.css`：多模态四步、播放器、证据轨和虚拟列表。
- `educlaw-web/src/components/skill-workspace/styles/repository.css`：Skill 仓库、批量选择和删除确认。
- `educlaw-web/src/components/skill-workspace/styles/skill-detail.css`：运行、测试、Arena、优化和版本。
- `educlaw-web/src/components/skill-workspace/workspace-inspector-state.ts`：Inspector 类型、reducer、URL 解析和关闭判断。
- `educlaw-web/src/components/skill-workspace/workspace-inspector-state.test.ts`：Inspector 纯状态测试。
- `educlaw-web/src/components/skill-workspace/WorkspaceInspectorProvider.tsx`：Context、Outlet 节点、URL 和宽度持久化。
- `educlaw-web/src/components/skill-workspace/WorkspaceInspector.tsx`：统一右栏外壳与紧凑工具轨。
- `educlaw-web/src/components/skill-workspace/InspectorPortal.tsx`：按 owner 将业务内容 portal 到 Outlet。
- `educlaw-web/src/components/skill-workspace/SkillInspectorContent.tsx`：现有摘要、版本和优化内容。
- `educlaw-web/src/components/skill-workspace/DocumentInspectorContent.tsx`：文档批量生成状态。
- `educlaw-web/src/components/skill-workspace/StructuredInspectorContent.tsx`：结构化填写摘要和材料。
- `educlaw-web/src/components/skill-workspace/RepositoryInspectorContent.tsx`：仓库选中与批量选择摘要。
- `educlaw-web/src/components/skill-workspace/multimodal/MultimodalInspectorContent.tsx`：转录、证据、诊断、概览、候选和 Skill 预览。
- `educlaw-web/src/components/skill-workspace/workspace-visual-contract.test.ts`：字体、样式拆分、最小字号和弹窗政策静态门禁。

### Modified files

- `educlaw-web/package.json`、`pnpm-lock.yaml`：增加固定版本本地字体依赖。
- `educlaw-web/src/main.tsx`：加载 Fontsource 变量字体。
- `educlaw-web/src/index.css`：全局字体变量和减少装饰背景。
- `educlaw-web/src/pages/SkillFirstWorkspace.tsx`：挂载 Provider、统一 Inspector，并移除页面层旧右栏宽度逻辑。
- `educlaw-web/src/components/skill-workspace/skill-workspace-state.ts`：只保留工作区导航和通知，不再保存 Inspector 的重复状态。
- `educlaw-web/src/components/skill-workspace/skill-workspace-state.test.ts`：更新工作区 reducer 契约。
- `educlaw-web/src/components/skill-workspace/SkillContextPanel.tsx`：迁移为 `SkillInspectorContent.tsx` 后删除。
- `educlaw-web/src/components/skill-workspace/MultimodalSkillCreationPanel.tsx`：以 Inspector API 代替本地 Drawer 开关。
- `educlaw-web/src/components/skill-workspace/multimodal/MediaReviewPane.tsx`、`MultimodalOverviewStep.tsx`、`MultimodalCandidateStep.tsx`、`MultimodalProgressStep.tsx`、`MultimodalReleaseStep.tsx`：入口文案和触发器改接 Inspector。
- `educlaw-web/src/components/skill-workspace/multimodal/MultimodalDataDrawers.tsx`：内容迁移后删除。
- `educlaw-web/src/components/skill-workspace/multimodal/MultimodalDrawer.tsx`：删除。
- `educlaw-web/src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts`：更新为非模态 Inspector 契约。
- `educlaw-web/src/components/skill-workspace/DocumentSkillCreationPanel.tsx`、`StructuredSkillCreationPanel.tsx`、`SkillRepositoryWorkspace.tsx`：注册并更新对应 Inspector。
- `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`：更新统一右栏、字体与样式契约。
- `educlaw-web/src/components/skill-workspace/skill-workspace.css`：变为样式模块聚合入口，删除已经迁移的规则。

---

### Task 1: 建立字体和视觉令牌

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/workspace-visual-contract.test.ts`
- Create: `educlaw-web/src/components/skill-workspace/styles/workspace-tokens.css`
- Modify: `educlaw-web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `educlaw-web/src/main.tsx`
- Modify: `educlaw-web/src/index.css`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`

**Interfaces:**
- Produces: CSS 变量 `--workspace-font-ui`、`--workspace-font-mono`、`--workspace-canvas`、`--workspace-surface`、`--workspace-ink`、`--workspace-muted`、`--workspace-primary`、`--workspace-evidence`、`--workspace-warning`、`--workspace-danger`、`--workspace-border`、`--workspace-space-*`、`--workspace-radius-*`、`--workspace-motion-*`。
- Consumes: none。

- [ ] **Step 1: 写字体与令牌失败测试**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Skill workspace visual contract', () => {
  it('self-hosts one Simplified Chinese variable UI font', () => {
    const pkg = JSON.parse(read('../../../package.json')) as {
      dependencies: Record<string, string>;
    };
    const main = read('../../main.tsx');

    expect(pkg.dependencies['@fontsource-variable/noto-sans-sc']).toBe('5.3.0');
    expect(main).toContain("@fontsource-variable/noto-sans-sc/wght.css");
  });

  it('defines workspace typography and semantic color tokens', () => {
    const tokens = read('./styles/workspace-tokens.css');

    expect(tokens).toContain('--workspace-font-ui: "Noto Sans SC Variable"');
    expect(tokens).toContain('--workspace-primary: #4658c9');
    expect(tokens).toContain('--workspace-evidence: #28766f');
    expect(tokens).toContain('--workspace-text-xs: 12px');
    expect(tokens).not.toMatch(/--workspace-text-[^:]+:\s*(?:[0-9]|1[01])px/);
  });
});
```

- [ ] **Step 2: 运行测试并确认因依赖、导入和令牌不存在而失败**

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/workspace-visual-contract.test.ts`

Expected: FAIL，错误包含 `@fontsource-variable/noto-sans-sc` 未定义或 `workspace-tokens.css` 不存在。

- [ ] **Step 3: 安装固定字体依赖**

Run: `pnpm --filter educlaw-web add --save-exact @fontsource-variable/noto-sans-sc@5.3.0`

确认 `educlaw-web/package.json` 使用精确版本 `5.3.0`，不是范围版本；若 pnpm 写入 `^5.3.0`，用 `apply_patch` 改为 `5.3.0` 后运行 `pnpm install --lockfile-only` 同步锁文件。

- [ ] **Step 4: 在入口加载 Fontsource 并建立令牌**

在 `main.tsx` 的 `index.css` 之前加入：

```ts
import '@fontsource-variable/noto-sans-sc/wght.css';
```

在 `workspace-tokens.css` 写入：

```css
.skill-workspace-root {
  --workspace-font-ui: "Noto Sans SC Variable", "PingFang SC", "Microsoft YaHei UI", sans-serif;
  --workspace-font-mono: "SFMono-Regular", "Cascadia Code", Consolas, monospace;
  --workspace-canvas: #f4f6f5;
  --workspace-surface: #ffffff;
  --workspace-ink: #18212d;
  --workspace-muted: #66727e;
  --workspace-primary: #4658c9;
  --workspace-evidence: #28766f;
  --workspace-warning: #b7652e;
  --workspace-danger: #c24141;
  --workspace-border: #dde2e1;
  --workspace-text-xs: 12px;
  --workspace-text-sm: 13px;
  --workspace-text-md: 15px;
  --workspace-text-lg: 18px;
  --workspace-text-xl: 24px;
  --workspace-space-1: 4px;
  --workspace-space-2: 8px;
  --workspace-space-3: 12px;
  --workspace-space-4: 16px;
  --workspace-space-6: 24px;
  --workspace-space-8: 32px;
  --workspace-radius-sm: 6px;
  --workspace-radius-md: 8px;
  --workspace-radius-lg: 12px;
  --workspace-motion-fast: 120ms;
  --workspace-motion-base: 180ms;
  font-family: var(--workspace-font-ui);
  font-synthesis: none;
}

.dark .skill-workspace-root {
  --workspace-canvas: #111717;
  --workspace-surface: #171e20;
  --workspace-ink: #edf2f1;
  --workspace-muted: #a9b4b4;
  --workspace-primary: #9ba8ff;
  --workspace-evidence: #67bdb4;
  --workspace-warning: #e2a070;
  --workspace-danger: #f08181;
  --workspace-border: #2d3839;
}
```

在 `index.css` 将 `body` 的字体改为 `"Noto Sans SC Variable"` 优先，并把工作区视觉从紫色网格和双径向渐变降为稳定的单色背景；不要删除非 `/skills` 页面仍在使用的通用动画类。

在 `skill-workspace.css` 第一行加入：

```css
@import "./styles/workspace-tokens.css";
```

- [ ] **Step 5: 运行定向测试、Lint 和构建**

Run:

```powershell
pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/workspace-visual-contract.test.ts
pnpm --filter educlaw-web lint
pnpm --filter educlaw-web build
```

Expected: 三条命令 exit 0；构建产物只引用本地字体资源，不出现 `fonts.googleapis.com`。

- [ ] **Step 6: 提交**

```powershell
git add -- educlaw-web/package.json pnpm-lock.yaml educlaw-web/src/main.tsx educlaw-web/src/index.css educlaw-web/src/components/skill-workspace/skill-workspace.css educlaw-web/src/components/skill-workspace/workspace-visual-contract.test.ts educlaw-web/src/components/skill-workspace/styles/workspace-tokens.css
git commit -m "style: establish skill workspace visual tokens"
```

### Task 2: 建立 Inspector 纯状态与 URL 契约

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/workspace-inspector-state.ts`
- Create: `educlaw-web/src/components/skill-workspace/workspace-inspector-state.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-state.ts`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-state.test.ts`

**Interfaces:**
- Produces: `InspectorOwner`、`InspectorView`、`InspectorDescriptor`、`WorkspaceInspectorState`、`createWorkspaceInspectorState()`、`workspaceInspectorReducer()`、`parseInspectorSearch()`、`writeInspectorSearch()`、`requiresInspectorCloseConfirmation()`。
- Produces simplified `SkillWorkspaceState` containing only `activeView` and `pinnedUpdate`.
- Consumes: Task 1 only at UI layer; pure state has no CSS dependency。

- [ ] **Step 1: 写 Inspector 状态失败测试**

```ts
import { describe, expect, it } from 'vitest';
import {
  createWorkspaceInspectorState,
  parseInspectorSearch,
  requiresInspectorCloseConfirmation,
  workspaceInspectorReducer,
  writeInspectorSearch,
} from './workspace-inspector-state';

const transcript = {
  owner: 'multimodal' as const,
  view: 'multimodal-transcript' as const,
  title: '完整转录',
};

describe('workspace inspector state', () => {
  it('opens, replaces and closes a lightweight descriptor', () => {
    const opened = workspaceInspectorReducer(createWorkspaceInspectorState(), {
      type: 'open',
      descriptor: transcript,
    });
    const replaced = workspaceInspectorReducer(opened, {
      type: 'open',
      descriptor: { ...transcript, view: 'multimodal-evidence', title: '证据库' },
    });
    const closed = workspaceInspectorReducer(replaced, { type: 'close' });

    expect(opened.open).toBe(true);
    expect(replaced.descriptor?.view).toBe('multimodal-evidence');
    expect(closed.open).toBe(false);
    expect(closed.descriptor).toBeNull();
  });

  it('requires confirmation only for a dirty open panel', () => {
    const dirty = workspaceInspectorReducer(
      workspaceInspectorReducer(createWorkspaceInspectorState(), {
        type: 'open', descriptor: transcript,
      }),
      { type: 'set-dirty', dirty: true },
    );
    expect(requiresInspectorCloseConfirmation(dirty)).toBe(true);
    expect(requiresInspectorCloseConfirmation(createWorkspaceInspectorState())).toBe(false);
  });

  it('round-trips safe inspector query state and rejects unknown views', () => {
    const search = writeInspectorSearch('?tab=skills', { ...transcript, itemId: 'segment-9' });
    expect(search).toContain('inspector=multimodal%3Amultimodal-transcript');
    expect(parseInspectorSearch(search)).toEqual({ ...transcript, itemId: 'segment-9' });
    expect(parseInspectorSearch('?inspector=multimodal%3Aunknown')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试并确认模块不存在**

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/workspace-inspector-state.test.ts`

Expected: FAIL with `Failed to resolve import "./workspace-inspector-state"`。

- [ ] **Step 3: 实现确定的类型与 reducer**

```ts
export type InspectorOwner =
  | 'workspace'
  | 'guided'
  | 'document'
  | 'structured'
  | 'multimodal'
  | 'repository'
  | 'skill';

export type InspectorView =
  | 'summary'
  | 'versions'
  | 'optimization'
  | 'document-materials'
  | 'structured-summary'
  | 'repository-selection'
  | 'multimodal-progress'
  | 'multimodal-transcript'
  | 'multimodal-evidence'
  | 'multimodal-diagnostics'
  | 'multimodal-overview'
  | 'multimodal-candidate'
  | 'multimodal-skill';

export type InspectorDescriptor = {
  owner: InspectorOwner;
  view: InspectorView;
  title: string;
  description?: string;
  itemId?: string;
  preferredWidth?: number;
};

export type WorkspaceInspectorState = {
  open: boolean;
  descriptor: InspectorDescriptor | null;
  dirty: boolean;
  fullscreen: boolean;
};
```

`parseInspectorSearch()` 只接受显式 owner/view allowlist，并从固定标题表恢复标题；`writeInspectorSearch()` 只改 `inspector` 和 `inspectorItem`，保留其他查询参数。关闭后清除 dirty/fullscreen。

同时从 `SkillWorkspaceState` 删除 `contextOpen` 和 `contextView`；`navigate` 和 `publish-update` 不再隐式控制右栏，由调用方显式调用 Inspector API。

- [ ] **Step 4: 运行两个 reducer 测试并修正旧断言**

Run:

```powershell
pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/workspace-inspector-state.test.ts src/components/skill-workspace/skill-workspace-state.test.ts
```

Expected: PASS。旧测试只验证 `activeView` 与 `pinnedUpdate`，不再断言 `contextOpen/contextView`。

- [ ] **Step 5: 提交**

```powershell
git add -- educlaw-web/src/components/skill-workspace/workspace-inspector-state.ts educlaw-web/src/components/skill-workspace/workspace-inspector-state.test.ts educlaw-web/src/components/skill-workspace/skill-workspace-state.ts educlaw-web/src/components/skill-workspace/skill-workspace-state.test.ts
git commit -m "refactor: define workspace inspector state"
```

### Task 3: 建立统一 Inspector 外壳并迁移现有右栏

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/WorkspaceInspectorProvider.tsx`
- Create: `educlaw-web/src/components/skill-workspace/WorkspaceInspector.tsx`
- Create: `educlaw-web/src/components/skill-workspace/InspectorPortal.tsx`
- Create: `educlaw-web/src/components/skill-workspace/SkillInspectorContent.tsx`
- Create: `educlaw-web/src/components/skill-workspace/styles/workspace-inspector.css`
- Create: `educlaw-web/src/components/skill-workspace/styles/workspace-shell.css`
- Modify: `educlaw-web/src/pages/SkillFirstWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`
- Delete: `educlaw-web/src/components/skill-workspace/SkillContextPanel.tsx`

**Interfaces:**
- Consumes: Task 2 `WorkspaceInspectorState` and reducer.
- Produces: `useWorkspaceInspector(): WorkspaceInspectorController`。
- Produces: `InspectorPortal({ owner, children })`。
- Produces: stable DOM outlet marked `data-workspace-inspector-outlet`。

- [ ] **Step 1: 更新 UI 契约测试并看到失败**

在 `skill-workspace-ui.test.ts` 将旧 `SkillContextPanel` 断言改为：

```ts
it('keeps one non-modal inspector mounted beside the main stage', () => {
  const page = read('../../pages/SkillFirstWorkspace.tsx');
  const shell = read('./WorkspaceInspector.tsx');
  const portal = read('./InspectorPortal.tsx');

  expect(page).toContain('<WorkspaceInspectorProvider>');
  expect(page).toContain('<WorkspaceInspector');
  expect(page).not.toContain('<SkillContextPanel');
  expect(shell).toContain('<aside');
  expect(shell).not.toContain('role="dialog"');
  expect(shell).toContain('data-workspace-inspector-outlet');
  expect(portal).toContain('createPortal');
});
```

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-workspace-ui.test.ts`

Expected: FAIL，因为 Provider、Shell 和 Portal 尚不存在。

- [ ] **Step 2: 实现 Provider 控制器**

```ts
export type WorkspaceInspectorController = {
  state: WorkspaceInspectorState;
  outlet: HTMLElement | null;
  setOutlet: (node: HTMLElement | null) => void;
  openInspector: (descriptor: InspectorDescriptor) => void;
  closeInspector: (options?: { force?: boolean }) => boolean;
  setInspectorDirty: (dirty: boolean) => void;
  toggleInspectorFullscreen: () => void;
};
```

Provider 使用 `useReducer`；通过 `useSearchParams()` 同步安全 URL；使用版本化键 `eduskill:workspace-inspector:v1` 保存 `{ width }`，读取时夹在 `320–520`。`closeInspector()` 遇到 dirty 时返回 `false`，由 UI 打开统一未保存确认；不得直接调用 `window.confirm()`。

- [ ] **Step 3: 实现稳定 Shell 与 Portal**

`WorkspaceInspector` 始终挂载 `<aside>`。关闭时只显示 44px 工具轨；打开时显示标题、说明、全屏和关闭按钮。拖动手柄支持鼠标和键盘：`ArrowLeft/ArrowRight` 每次改变 16px，`Home/End` 调至 320/520。

`InspectorPortal` 的核心实现：

```tsx
export function InspectorPortal(props: { owner: InspectorOwner; children: ReactNode }) {
  const { outlet, state } = useWorkspaceInspector();
  if (!outlet || !state.open || state.descriptor?.owner !== props.owner) return null;
  return createPortal(props.children, outlet);
}
```

- [ ] **Step 4: 将现有摘要、版本和优化内容迁入 Portal**

把 `SkillContextPanel.tsx` 中的 `ContextSummary`、`RequirementSummary`、`VersionSummary` 和 `SkillAnswerOptimizationPanel` 选择逻辑迁入 `SkillInspectorContent.tsx`。页面根据当前 view 显式调用：

```ts
openInspector({ owner: 'skill', view: 'summary', title: '当前 Skill' });
openInspector({ owner: 'skill', view: 'versions', title: '最近版本' });
openInspector({ owner: 'skill', view: 'optimization', title: '改进这条回答' });
```

`SkillFirstWorkspace` 改成外层 Provider + 内层 `SkillFirstWorkspaceContent`，移除 `contextWidth`、鼠标 resize effect、旧 resize handle 和 `SkillContextPanel`。在主内容后渲染一个 `WorkspaceInspector`，并使用 `InspectorPortal owner="guided"` 或 `owner="skill"` 输出内容。

- [ ] **Step 5: 运行定向测试和构建**

Run:

```powershell
pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/workspace-inspector-state.test.ts src/components/skill-workspace/skill-workspace-state.test.ts src/components/skill-workspace/skill-workspace-ui.test.ts
pnpm --filter educlaw-web build
```

Expected: PASS；页面只有一个 `.workspace-inspector` 外壳，默认工作区可构建。

- [ ] **Step 6: 提交**

```powershell
git add -- educlaw-web/src/pages/SkillFirstWorkspace.tsx educlaw-web/src/components/skill-workspace/WorkspaceInspectorProvider.tsx educlaw-web/src/components/skill-workspace/WorkspaceInspector.tsx educlaw-web/src/components/skill-workspace/InspectorPortal.tsx educlaw-web/src/components/skill-workspace/SkillInspectorContent.tsx educlaw-web/src/components/skill-workspace/styles/workspace-inspector.css educlaw-web/src/components/skill-workspace/styles/workspace-shell.css educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts educlaw-web/src/components/skill-workspace/SkillContextPanel.tsx
git commit -m "refactor: unify skill workspace inspector"
```

### Task 4: 将多模态 Drawer 迁入 Inspector Outlet

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalInspectorContent.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/MultimodalSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MediaReviewPane.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalOverviewStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalCandidateStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalProgressStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalReleaseStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts`
- Delete: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalDrawer.tsx`
- Delete: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalDataDrawers.tsx`

**Interfaces:**
- Consumes: Task 3 `useWorkspaceInspector()` and `InspectorPortal`。
- Produces: `MultimodalInspectorContent` with the same domain callback props as `MultimodalDataDrawers`, except `open` and `onOpenChange` are removed and current view is passed as `view: Extract<InspectorView, \`multimodal-${string}\`>`。
- Preserves: `VirtualTranscriptList`、`VirtualEvidenceList`、`useVirtualizer` and overscan 6。

- [ ] **Step 1: 先把 UI 契约改成 Inspector 并看到失败**

将测试中的 Drawer 断言替换为：

```ts
it('renders complete multimodal data in the shared non-modal inspector', () => {
  const panel = read('../MultimodalSkillCreationPanel.tsx');
  const inspector = read('./MultimodalInspectorContent.tsx');

  expect(panel).toContain("openInspector({ owner: 'multimodal'");
  expect(panel).toContain('<InspectorPortal owner="multimodal">');
  expect(inspector).toContain('useVirtualizer');
  expect(inspector).toContain('getVirtualItems()');
  expect(inspector).not.toContain('Dialog.Root');
  expect(panel).not.toContain('<MultimodalDataDrawers');
});
```

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts`

Expected: FAIL，因为新 Inspector 内容不存在，旧实现仍使用 Dialog。

- [ ] **Step 2: 提取不带外壳的多模态内容**

复制现有虚拟列表、筛选和各视图主体到 `MultimodalInspectorContent.tsx`，删除 `MultimodalDrawer` 包裹。组件根节点按 view 使用稳定的 `data-inspector-view`：

```tsx
return (
  <div className="skill-mm-inspector" data-inspector-view={props.view}>
    {props.view === 'multimodal-transcript' ? <TranscriptView {...props} /> : null}
    {props.view === 'multimodal-evidence' ? <EvidenceView {...props} /> : null}
    {props.view === 'multimodal-diagnostics' ? <DiagnosticsView {...props} /> : null}
    {props.view === 'multimodal-overview' ? <OverviewView {...props} /> : null}
    {props.view === 'multimodal-candidate' ? <CandidateEditor {...props} /> : null}
    {props.view === 'multimodal-skill' ? <SkillPreview {...props} /> : null}
  </div>
);
```

在虚拟列表的 `useVirtualizer` 配置中继续使用业务 key、`measureElement` 和 `overscan: 6`；Inspector 宽度变化时调用 `measure()`。

- [ ] **Step 3: 将所有触发器改接统一 Inspector**

在 `MultimodalSkillCreationPanel` 使用：

```ts
const { state: inspectorState, openInspector, closeInspector, setInspectorDirty } =
  useWorkspaceInspector();

const openMultimodalInspector = (
  view: Extract<InspectorView, `multimodal-${string}`>,
  title: string,
  itemId?: string,
) => openInspector({ owner: 'multimodal', view, title, itemId, preferredWidth: 400 });
```

映射固定为：转录 `multimodal-transcript`、证据 `multimodal-evidence`、诊断 `multimodal-diagnostics`、Adler 全部结论 `multimodal-overview`、候选 `multimodal-candidate`、Skill 预览 `multimodal-skill`。处理阶段首次进入时打开 `multimodal-progress`，但用户手动关闭后同一阶段不重复抢占。

候选编辑有本地修改时调用 `setInspectorDirty(true)`；保存、废弃、拆分成功或放弃后设为 `false`。多模态组件卸载时，仅当当前 owner 是 `multimodal` 才强制清理 Inspector。

- [ ] **Step 4: 删除旧 Drawer 并验证没有残留样式或 Dialog 引用**

Run:

```powershell
rg -n "MultimodalDrawer|MultimodalDataDrawers|skill-mm-drawer|Dialog\.Root" educlaw-web/src/components/skill-workspace
```

Expected: 无输出；其他删除/导入 Dialog 不受影响。

- [ ] **Step 5: 运行多模态与工作区测试、Lint 和构建**

Run:

```powershell
pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts src/components/skill-workspace/skill-workspace-ui.test.ts
pnpm --filter educlaw-web lint
pnpm --filter educlaw-web build
```

Expected: PASS；多模态独立 chunk 仍存在，默认工作区没有同步导入 `MultimodalInspectorContent`。

- [ ] **Step 6: 提交**

```powershell
git add -- educlaw-web/src/components/skill-workspace/MultimodalSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/multimodal/MediaReviewPane.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalOverviewStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalCandidateStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalProgressStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalReleaseStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalInspectorContent.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalDrawer.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalDataDrawers.tsx educlaw-web/src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts
git commit -m "refactor: move multimodal details into inspector"
```

### Task 5: 接入文档、结构化和仓库上下文

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/DocumentInspectorContent.tsx`
- Create: `educlaw-web/src/components/skill-workspace/StructuredInspectorContent.tsx`
- Create: `educlaw-web/src/components/skill-workspace/RepositoryInspectorContent.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/DocumentSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/StructuredSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillRepositoryWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts`

**Interfaces:**
- Consumes: Task 3 Inspector API。
- Produces: document view using `DocumentSource[]` and `DocumentBatchRun[]`; structured view using `StructuredSkillDraft` and `GuidedCreationDocument[]`; repository view using `RepositorySkill[]` and selected IDs。

- [ ] **Step 1: 写三个生成/仓库 Inspector 失败契约**

```ts
it('uses the shared inspector for document, structured and repository context', () => {
  const document = read('./DocumentSkillCreationPanel.tsx');
  const structured = read('./StructuredSkillCreationPanel.tsx');
  const repository = read('./SkillRepositoryWorkspace.tsx');

  expect(document).toContain('<DocumentInspectorContent');
  expect(document).toContain('<InspectorPortal owner="document">');
  expect(structured).toContain('<StructuredInspectorContent');
  expect(structured).toContain('<InspectorPortal owner="structured">');
  expect(repository).toContain('<RepositoryInspectorContent');
  expect(repository).toContain('<InspectorPortal owner="repository">');
});
```

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-workspace-ui.test.ts`

Expected: FAIL with missing Inspector content strings。

- [ ] **Step 2: 文档生成右栏**

文件加入后打开：

```ts
openInspector({
  owner: 'document',
  view: 'document-materials',
  title: '文档与生成状态',
  description: `${next.length} 份文档`,
});
```

中央区只保留上传、统一要求和主按钮；文件清单、等待/运行/成功/失败状态、成功失败计数进入 `DocumentInspectorContent`。失败条目显示原因和“移除后重新生成”的下一步，不提供无效的通用重试。

- [ ] **Step 3: 结构化创建右栏**

首次填写非空字段或添加材料后打开 `structured-summary`。`StructuredInspectorContent` 展示七个可理解字段的完成状态、文档列表和规则摘要；不得展示格式化后发送给后端的拼接文本。字段修改只更新局部摘要，不重置表单焦点。

- [ ] **Step 4: 仓库右栏**

普通模式保持现有单击打开 Skill 的行为；行获得键盘焦点或打开行菜单时更新右栏快速预览，不增加双击门槛。批量管理时 Inspector 显示当前筛选总数、已选择数和选中名称摘要；删除动作仍打开现有 `SkillDeleteConfirmDialog`，不迁入非模态右栏。

- [ ] **Step 5: 运行定向测试和构建**

Run:

```powershell
pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-workspace-ui.test.ts src/components/skill-workspace/document-skill-creation-state.test.ts src/components/skill-workspace/structured-skill-creation-state.test.ts src/components/skill-workspace/skill-repository-state.test.ts
pnpm --filter educlaw-web build
```

Expected: PASS；删除确认仍有 `role="alertdialog"`，导入仍有 `role="dialog"`。

- [ ] **Step 6: 提交**

```powershell
git add -- educlaw-web/src/components/skill-workspace/DocumentInspectorContent.tsx educlaw-web/src/components/skill-workspace/StructuredInspectorContent.tsx educlaw-web/src/components/skill-workspace/RepositoryInspectorContent.tsx educlaw-web/src/components/skill-workspace/DocumentSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/StructuredSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/SkillRepositoryWorkspace.tsx educlaw-web/src/components/skill-workspace/skill-workspace-ui.test.ts
git commit -m "feat: add contextual inspectors to skill workflows"
```

### Task 6: 拆分 CSS 并完成视觉、响应式和无障碍整理

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/styles/workspace-controls.css`
- Create: `educlaw-web/src/components/skill-workspace/styles/creation-workflows.css`
- Create: `educlaw-web/src/components/skill-workspace/styles/multimodal-workbench.css`
- Create: `educlaw-web/src/components/skill-workspace/styles/repository.css`
- Create: `educlaw-web/src/components/skill-workspace/styles/skill-detail.css`
- Modify: `educlaw-web/src/components/skill-workspace/styles/workspace-shell.css`
- Modify: `educlaw-web/src/components/skill-workspace/styles/workspace-inspector.css`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Modify: `educlaw-web/src/components/skill-workspace/workspace-visual-contract.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/WorkspaceInspector.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/DocumentSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/StructuredSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillRepositoryWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MediaReviewPane.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalProgressStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalOverviewStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalCandidateStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalReleaseStep.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalInspectorContent.tsx`

**Interfaces:**
- Consumes: Tasks 1–5 class names and tokens。
- Produces: one CSS owner per visual domain and no duplicate critical shell selectors。

- [ ] **Step 1: 扩展静态失败门禁**

```ts
it('keeps the legacy stylesheet as an import-only compatibility entry', () => {
  const css = read('./skill-workspace.css');
  expect(css).toContain('@import "./styles/workspace-tokens.css";');
  expect(css).toContain('@import "./styles/workspace-shell.css";');
  expect(css).toContain('@import "./styles/workspace-inspector.css";');
  expect(css).not.toMatch(/\.skill-workspace-root\s*\{/);
  expect(css).not.toMatch(/\.workspace-inspector\s*\{/);
});

it('keeps readable text and focus rules in the workspace styles', () => {
  const styles = [
    read('./styles/workspace-controls.css'),
    read('./styles/workspace-inspector.css'),
    read('./styles/multimodal-workbench.css'),
  ].join('\n');
  expect(styles).not.toMatch(/font-size:\s*(?:[0-9]|1[01])px/);
  expect(styles).toContain(':focus-visible');
  expect(styles).not.toContain('transition: all');
});
```

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/workspace-visual-contract.test.ts`

Expected: FAIL，因为旧 CSS 仍包含实现规则和小字号。

- [ ] **Step 2: 按选择器责任迁移，不复制**

迁移顺序固定为：tokens → shell/sidebar/main → controls → inspector → creation → multimodal → repository → skill detail。每迁移一组，用 `apply_patch` 从旧文件删除原规则，再加入目标文件；禁止同一选择器同时留在旧文件和新文件。

最终 `skill-workspace.css` 内容严格为：

```css
@import "./styles/workspace-tokens.css";
@import "./styles/workspace-shell.css";
@import "./styles/workspace-controls.css";
@import "./styles/workspace-inspector.css";
@import "./styles/creation-workflows.css";
@import "./styles/multimodal-workbench.css";
@import "./styles/repository.css";
@import "./styles/skill-detail.css";
```

- [ ] **Step 3: 实现三档响应式和非模态行为**

`workspace-shell.css` 使用 `240px minmax(0,1fr) var(--inspector-current-width)`；`>=1280px` 固定三栏，`1024–1279px` Inspector 绝对覆盖主区右侧，`768–1023px` 左栏折叠为 56px，`<768px` Inspector 从底部出现并使用 `env(safe-area-inset-bottom)`。桌面 Inspector 不渲染遮罩、不设置 `aria-modal`、不锁焦点。

- [ ] **Step 4: 完成视觉整理**

- 页面标题 `24/32`、区标题 `18/26`、正文 `15/24`、右栏 `13/20`、辅助 `12/18`。
- 只保留 6/8/12px 圆角；默认内容面无阴影。
- 移除多模态局部 font-family、旧紫色发光、shimmer、float 和无信息网格背景。
- 按钮用明确 hover、active、disabled、focus-visible 状态；不使用 `outline: none` 除非同规则提供替代焦点。
- 所有 sticky header/footer 配置 `scroll-padding` 或内容 padding，不能遮挡焦点。
- 关键帧图片添加稳定 aspect-ratio、width/height 或占位尺寸和 `loading="lazy"`。

- [ ] **Step 5: 按最新 Web Interface Guidelines 做源码审查并修复**

检查范围：`educlaw-web/src/components/skill-workspace/**/*.tsx` 和新 styles。至少修复：图标按钮缺少 `aria-label`、装饰图标缺少 `aria-hidden`、输入缺少 `name/autocomplete`、原生日期格式改用已有统一 formatter 或 `Intl.DateTimeFormat`、可点击非 button 元素、焦点被 sticky 区域遮挡。不得把 Title Case 英文规则机械应用到中文文案。

- [ ] **Step 6: 运行全部前端测试、Lint 和构建**

Run:

```powershell
pnpm --filter educlaw-web test
pnpm --filter educlaw-web lint
pnpm --filter educlaw-web build
```

Expected: tests 0 failed；lint 0 errors；build exit 0。

- [ ] **Step 7: 提交**

```powershell
git add -- educlaw-web/src/components/skill-workspace/skill-workspace.css educlaw-web/src/components/skill-workspace/styles/workspace-shell.css educlaw-web/src/components/skill-workspace/styles/workspace-controls.css educlaw-web/src/components/skill-workspace/styles/workspace-inspector.css educlaw-web/src/components/skill-workspace/styles/creation-workflows.css educlaw-web/src/components/skill-workspace/styles/multimodal-workbench.css educlaw-web/src/components/skill-workspace/styles/repository.css educlaw-web/src/components/skill-workspace/styles/skill-detail.css educlaw-web/src/components/skill-workspace/workspace-visual-contract.test.ts educlaw-web/src/components/skill-workspace/WorkspaceInspector.tsx educlaw-web/src/components/skill-workspace/DocumentSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/StructuredSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/SkillRepositoryWorkspace.tsx educlaw-web/src/components/skill-workspace/multimodal/MediaReviewPane.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalProgressStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalOverviewStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalCandidateStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalReleaseStep.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalInspectorContent.tsx
git commit -m "style: refine skill workspace layout and typography"
```

提交前运行 `git diff --cached --name-only`，确认没有 `educlaw-web/src/components/agent/build-components.tsx`；若出现，停止提交并取消暂存该文件。

### Task 7: 性能稳定性与真实浏览器验收

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/MultimodalSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/MultimodalInspectorContent.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/WorkspaceInspectorProvider.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/workspace-inspector-state.test.ts`
- Modify: `docs/2026-08-23-multimodal-skill-pack-operations-runbook.md`

**Interfaces:**
- Consumes: completed Inspector and styles。
- Produces: measured performance behavior, fresh verification evidence and updated acceptance steps。

- [ ] **Step 1: 写防卸载、去抖和旧响应失败测试**

在现有测试中增加源码与纯状态断言：

```ts
it('keeps the multimodal workflow mounted while inspector views change', () => {
  const panel = read('../MultimodalSkillCreationPanel.tsx');
  expect(panel).toContain('<InspectorPortal owner="multimodal">');
  expect(panel).not.toContain('key={inspectorState.descriptor');
  expect(panel).toContain('useDeferredValue');
});
```

为 URL/owner 清理增加 reducer 测试：切换到非多模态 owner 后，旧 multimodal itemId 不保留；关闭后其他查询参数仍存在。

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts src/components/skill-workspace/workspace-inspector-state.test.ts`

Expected: 新断言至少一项 FAIL，再进行实现。

- [ ] **Step 2: 收紧渲染边界**

- 搜索词通过 `useDeferredValue(query)` 进入过滤逻辑。
- 将转录、证据行和候选编辑器拆为模块级组件，不在 render 内定义组件。
- 高频 `currentTimeMs` 只驱动 `MediaReviewPane` 和当前证据派生，不进入 Provider state。
- `openInspector` 和 `closeInspector` 使用稳定 callback；Provider context value 使用 `useMemo`。
- 多模态组件卸载时按 owner 清理，普通 Inspector view 切换不改变 `multimodalCreationKey`。

- [ ] **Step 3: 记录构建 chunk 基线和变化**

Run:

```powershell
pnpm --filter educlaw-web build
Get-ChildItem -LiteralPath 'educlaw-web/dist/assets' | Sort-Object Length -Descending | Select-Object -First 20 Name,Length
```

记录默认入口 JS、懒加载多模态 JS、CSS 和字体总大小。多模态 JS 相比提交 `6c042e8` 的基线 `74.42 kB / gzip 23.72 kB` 增长超过 15% 时，检查静态导入和重复依赖；字体资源按 unicode range 单独记录，不计入多模态 JS。

- [ ] **Step 4: 启动本地 Docker 并执行真实浏览器检查**

按照 `docs/2026-08-23-multimodal-skill-pack-operations-runbook.md` 重建 Web 镜像和依赖服务。使用：

`C:\Users\19118\Downloads\video_1.1 函数___《高等数学》同..._0.mp4`

完成以下路径：上传 → 安全校验 → 转录与证据 → 内容确认 → 候选选择 → 确认生成 → 工作区试用 → 仓库查看。验收时记录：

- 右栏切换转录、证据、诊断、候选和 Skill 预览时视频不回到 `0:00`。
- SSE 降级到轮询时不插入布局横幅、不反复开关右栏。
- 500 条以上证据时 DOM 只包含虚拟窗口附近条目。
- 确认生成后新 Skill 在左栏工作区与仓库同时出现。
- 删除确认仍为 alertdialog，取消后焦点返回原按钮。

- [ ] **Step 5: 做六个视口和两种主题验收**

检查 `375×812`、`768×1024`、`1024×768`、`1366×768`、`1440×900`、`1920×1080`。每个视口检查无横向溢出、主操作可见、右栏/Sheet 不遮挡焦点。浅色、深色、`prefers-reduced-motion: reduce` 各检查一次；键盘完成打开右栏、筛选、选择候选、确认生成和关闭右栏。

- [ ] **Step 6: 更新运行手册**

在运行手册的 Web 验收部分写入新的右栏入口、移动 Sheet、字体本地加载、真实视频路径和检查顺序；删除旧“打开多模态 Drawer”的描述，不修改后端运维步骤。

- [ ] **Step 7: 跑新鲜全量门禁**

Run:

```powershell
pnpm check
python -m pytest python/media_worker/tests -q
git diff --check
git status --short
```

Expected:

- Web/server/shared lint、测试和 build 全部 exit 0；
- Python Worker 既有测试 0 failed；
- `git diff --check` 无错误；
- `git status --short` 只包含本任务文件和预先存在的 `educlaw-web/src/components/agent/build-components.tsx`，后者不暂存。

- [ ] **Step 8: 提交最终性能与验收调整**

```powershell
git add -- educlaw-web/src/components/skill-workspace/MultimodalSkillCreationPanel.tsx educlaw-web/src/components/skill-workspace/multimodal/MultimodalInspectorContent.tsx educlaw-web/src/components/skill-workspace/WorkspaceInspectorProvider.tsx educlaw-web/src/components/skill-workspace/multimodal/multimodal-wizard-ui.test.ts educlaw-web/src/components/skill-workspace/workspace-inspector-state.test.ts docs/2026-08-23-multimodal-skill-pack-operations-runbook.md
git commit -m "perf: stabilize skill workspace inspector"
```

## Final Review Gate

实施完成后逐项对照设计规范第 1–15 节：

- 字体本地加载、最小字号和语义令牌；
- 单一 Inspector 外壳和弹窗政策；
- 多模态全部辅助内容进入右栏；
- 文档、结构化、仓库和 Skill 详情共享右栏；
- CSS 无重复关键选择器；
- 三档响应式与移动 Sheet；
- 无障碍、减少动画、加载、空状态和失败状态；
- 多模态懒加载、虚拟列表和 chunk 体积；
- 真实视频完整闭环；
- 全量门禁输出。

发现任何缺口时先补失败测试，再修复，不能仅在验收记录中注明“后续处理”。最终不自动 push；由用户审核真实页面和 diff 后决定是否推送。
