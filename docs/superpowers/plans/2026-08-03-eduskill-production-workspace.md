# EduSkill Production Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved Skill-first workspace, connect every visible action to the existing creation, Arena, optimization, and version services, and deploy it safely to `https://eduskill.innoagent.tech/login`.

**Architecture:** Keep the existing guided-creation and Skill-version services. Use fixed-version Skill Arena threads as the execution primitive: `agent` mode powers single-Skill run/test and `compare` mode powers Arena. Reuse the existing interactive optimization APIs with the latest run thread, while the frontend owns only view state, streaming presentation, and responsive layout.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Express, PostgreSQL, SSE, nginx, pnpm.

---

### Task 1: Make the left sidebar the single navigation surface

**Files:**
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-state.ts`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace-state.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx`
- Modify: `educlaw-web/src/pages/SkillFirstWorkspace.tsx`

- [ ] **Step 1: Write failing reducer tests**

Add tests proving `run` and `arena` are valid destinations and a completed creation navigates to `run` without opening the context panel.

```ts
expect(skillWorkspaceReducer(state, { type: 'navigate', view: 'run' }).activeView).toBe('run');
expect(skillWorkspaceReducer(state, { type: 'navigate', view: 'arena' }).activeView).toBe('arena');
```

- [ ] **Step 2: Run the reducer test and verify failure**

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-workspace-state.test.ts`

Expected: TypeScript/test failure because `run` and `arena` are not yet workspace views.

- [ ] **Step 3: Extend navigation state and sidebar props**

Add `run` and `arena` to `SkillWorkspaceView`. Pass `activeView` and `onNavigate` into the sidebar. Render two compact groups:

```ts
const createItems = ['create', 'template', 'import', 'manual'] as const;
const skillItems = ['run', 'test', 'arena', 'optimize', 'versions'] as const;
```

Keep `新建 Skill` and `Skill 仓库` at the top, creation sub-actions directly below `新建 Skill`, and selected-Skill actions below the current Skill name.

- [ ] **Step 4: Route completed creation to run**

In the guided `done` event replace overview navigation with:

```ts
dispatchWorkspace({ type: 'navigate', view: 'run' });
publishUpdate({
  id: 'skill-created',
  title: 'Skill v1 已保存',
  message: '现在可以直接输入真实任务运行这个 Skill。',
});
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter educlaw-web test`

Expected: all workspace state tests pass.

### Task 2: Move creation identity left and make document upload obvious

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/SkillMaterialPicker.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-materials.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/GuidedSkillCreationPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`

- [ ] **Step 1: Add failing material validation tests**

Test accepted extensions and limits:

```ts
expect(validateSkillMaterial({ name: 'lesson.docx', size: 1024 })).toBeNull();
expect(validateSkillMaterial({ name: 'image.png', size: 1024 })).toBe('仅支持 DOCX、Markdown 和 TXT');
expect(validateSkillMaterial({ name: 'large.md', size: 11 * 1024 * 1024 })).toBe('单个文件不能超过 10MB');
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-materials.test.ts`

Expected: FAIL because `validateSkillMaterial` does not exist.

- [ ] **Step 3: Implement the picker**

Render a labeled control instead of a paperclip-only icon:

```tsx
<button className="skill-material-button" onClick={openPicker}>
  <Paperclip size={16} />
  <span>添加教学材料</span>
</button>
<small>支持 DOCX、Markdown、TXT，也可以拖放到输入区</small>
```

The whole composer accepts drag events, validates up to 10 files, and sends parsed documents through the existing `onFiles` callback.

- [ ] **Step 4: Remove the centered creation heading**

Delete the large `自然对话式创建 / 创建一个教育 Skill` header and its horizontal rule from the center. Keep the conversation, starter suggestions, composer, and confirmation/generation states. The main divider is the full-width workspace top bar.

- [ ] **Step 5: Run tests and a focused build**

Run: `pnpm --filter educlaw-web test && pnpm --filter educlaw-web build`

Expected: tests and build pass.

### Task 3: Implement real fixed-version Skill execution

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/skill-run-state.ts`
- Create: `educlaw-web/src/components/skill-workspace/skill-run-state.test.ts`
- Create: `educlaw-web/src/components/skill-workspace/SkillRunWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillDetailWorkspace.tsx`

- [ ] **Step 1: Write failing stream-state tests**

Cover user-message insertion, enhanced deltas, completion, retryable errors, and thread reuse.

```ts
const streaming = runReducer(initialRunState, { type: 'delta', delta: '活动步骤' });
expect(streaming.assistantDraft).toBe('活动步骤');
```

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-run-state.test.ts`

Expected: FAIL because the reducer does not exist.

- [ ] **Step 3: Create a fixed-version Arena thread**

When the first message is sent, create a Skill Arena thread whose left and right selection both point to the current version; use `agent` mode so only the fixed enhanced side is returned:

```ts
const thread = await liteApi.createArenaThread(token, packageId, {
  idempotencyKey: crypto.randomUUID(),
  basePackageVersionId: currentVersion.createdInPackageVersionId,
  left: { skillId: currentVersion.skillId, skillVersionId: currentVersion.id },
  right: { skillId: currentVersion.skillId, skillVersionId: currentVersion.id },
});
await liteApi.sendMessageStream(token, String(thread.id), content, undefined, 'agent', onEvent);
```

Persist and render returned Arena messages; do not fabricate an assistant response.

- [ ] **Step 4: Render the run view**

Use the same flat conversation layout and bottom composer as creation. Show the current version in the compact top bar and expose retry when SSE returns `error` or `stream_end.ok === false`.

- [ ] **Step 5: Run tests and build**

Run: `pnpm --filter educlaw-web test && pnpm --filter educlaw-web build`

Expected: all run-state tests pass and TypeScript builds.

### Task 4: Separate real test and Arena comparison views

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/SkillArenaWorkspace.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-arena-selection.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/SkillDetailWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillContextPanel.tsx`

- [ ] **Step 1: Write failing selection tests**

Test that normal test fixes both sides to current version and Arena requires two distinct active versions.

- [ ] **Step 2: Run the test and verify failure**

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-arena-selection.test.ts`

Expected: FAIL before the selection helper exists.

- [ ] **Step 3: Implement test using the run executor**

The `test` view uses the same fixed-version executor as `run`. Its prompt and result remain persisted as Arena thread messages on the backend; frontend state is reconstructed from the returned thread detail and labels the fixed version explicitly.

- [ ] **Step 4: Implement Arena using compare mode**

Create a thread with two user-selected versions and stream with `compare` mode. Render the two responses in the existing Arena-style two-column result without nested cards.

- [ ] **Step 5: Verify test and Arena flows**

Run the focused tests, then build the web app. Expected: no static placeholder response remains in either view.

### Task 5: Connect interactive optimization and version creation

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/SkillOptimizationWorkspace.tsx`
- Create: `educlaw-web/src/components/skill-workspace/skill-optimization-state.test.ts`
- Modify: `educlaw-web/src/components/skill-workspace/SkillDetailWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillContextPanel.tsx`

- [ ] **Step 1: Write failing optimization-state tests**

Cover diagnosis loading, real assistant messages, adopted changes, application success, and retryable failure.

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm --filter educlaw-web exec vitest run src/components/skill-workspace/skill-optimization-state.test.ts`

- [ ] **Step 3: Reuse existing optimization APIs**

Start with the latest run/Arena thread:

```ts
const diagnosis = await liteApi.diagnosePackage(token, packageId, threadId);
const result = await liteApi.chatOptimize(token, packageId, sessionId, messages, adoptedChanges);
const saved = await liteApi.applyInteractiveChanges(token, packageId, sessionId, adoptedChanges, note);
```

Show diagnosis and adopted-change summaries in the right panel. After apply, reload Skill versions and publish a `version-changed` pinned update.

- [ ] **Step 4: Remove static optimization conversation**

Render only persisted/returned service messages. Disable `保存为新版本` until at least one change is adopted.

- [ ] **Step 5: Run tests and build**

Expected: all optimization tests pass and the production build succeeds.

### Task 6: Finish repository, user menu, right rail, and responsive polish

**Files:**
- Create: `educlaw-web/src/components/skill-workspace/SkillUserMenu.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillRepositoryWorkspace.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillWorkspaceSidebar.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/SkillContextPanel.tsx`
- Modify: `educlaw-web/src/components/skill-workspace/skill-workspace.css`
- Modify: `educlaw-web/qa.html`

- [ ] **Step 1: Add UI contract tests**

Assert that settings is absent as a standalone footer item, the avatar menu owns account/settings/logout, and right context remains closed in the initial state.

- [ ] **Step 2: Implement the avatar popover and repository actions**

Keep import visible with creation methods, remove the footer settings row, and make completed repository entries open `run` while drafts open `create`.

- [ ] **Step 3: Polish responsive rules**

At 1440/1024px use fixed side columns with a flexible center. At 700px collapse the left sidebar to icons and overlay the right panel only when open. Ensure no horizontal overflow.

- [ ] **Step 4: Capture visual QA**

Capture new, run, Arena, optimize, versions, and repository at 1440x900, 1024x768, and 700x780. Inspect every image before continuing.

### Task 7: Restore a clean regression baseline

**Files:**
- Modify only the production code or mocks proven by the failing tests.
- Tests: existing `educlaw-server/src/services/arena-service.*.test.ts` and `package-service.generate.test.ts`.

- [ ] **Step 1: Re-run each existing failure in isolation**

Run the five failing tests from the current full-suite baseline individually. Record whether the issue is a stale mock, numeric ID normalization, assistant-message return shape, or rubric candidate expansion.

- [ ] **Step 2: Apply one root-cause fix at a time**

Do not weaken assertions. Add/adjust regression tests before each production fix.

- [ ] **Step 3: Run the complete server and web suites**

Run:

```bash
pnpm --filter educlaw-server test
pnpm --filter educlaw-web test
pnpm --filter educlaw-server lint
pnpm --filter educlaw-web lint
pnpm build
```

Expected: zero failures and zero lint errors before deployment.

### Task 8: Deploy safely to production and verify

**Files:**
- Use: `scripts/start-prod-tmux.sh` or `scripts/deploy-prod.sh`
- Do not persist credentials in repository files.

- [ ] **Step 1: Commit the reviewed implementation in scoped commits**

Verify `git diff --check`, review staged scope, and keep generated QA/browser files out of commits.

- [ ] **Step 2: Back up production**

On the production host, back up the deployed frontend directory, current commit, `.env`, and PostgreSQL database before replacing files.

- [ ] **Step 3: Deploy the exact tested commit**

Pull the reviewed branch/commit on the server, install with the frozen lockfile, build shared/server/web, restart the backend, publish frontend assets, and reload nginx.

- [ ] **Step 4: Run production smoke checks**

Verify:

```text
GET /login -> 200
GET /healthz -> 200
login -> Skill workspace
create draft -> database row exists
complete creation -> run view
run current Skill -> real streamed answer
open versions -> current version visible
```

- [ ] **Step 5: Report deployment evidence**

Return the deployed commit SHA, health results, production URL, and rollback location.
