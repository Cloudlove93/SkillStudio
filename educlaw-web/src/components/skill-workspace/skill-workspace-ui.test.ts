import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');
const workspaceCss = () =>
  [
    './styles/workspace-shell.css',
    './styles/workspace-controls.css',
    './styles/workspace-inspector.css',
    './styles/creation-workflows.css',
    './styles/multimodal-workbench.css',
    './styles/repository.css',
    './styles/skill-detail.css',
  ]
    .map(read)
    .join('\n');

describe('Skill-first workspace UI contract', () => {
  it('uses the Skill workspace as the authenticated default and retires legacy screens', () => {
    const source = read('../../App.tsx');

    expect(source).toContain(
      'path="/" element={<RequireAuth><SkillFirstWorkspace /></RequireAuth>}',
    );
    expect(source).toContain(
      'path="/legacy" element={<Navigate to="/" replace />}',
    );
    expect(source).not.toContain("import('./pages/Workspace')");
  });

  it('provides one compact entry to the shared right inspector', () => {
    const source = read('./WorkspaceInspector.tsx');

    expect(source).toContain('workspace-inspector-rail');
    expect(source).toContain('aria-label="展开右侧栏"');
    expect(source).not.toContain('aria-label="功能选项"');
  });

  it('uses one shared non-modal inspector instead of feature-owned right-panel dialogs', () => {
    const provider = read('./WorkspaceInspectorProvider.tsx');
    const inspector = read('./WorkspaceInspector.tsx');
    const portal = read('./InspectorPortal.tsx');
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(provider).toContain('workspaceInspectorReducer');
    expect(provider).toContain('eduskill:workspace-inspector:v1');
    expect(inspector).toContain('<aside');
    expect(inspector).toContain('data-workspace-inspector-outlet');
    expect(inspector).not.toContain('role="dialog"');
    expect(portal).toContain('createPortal');
    expect(page).toContain('<WorkspaceInspectorProvider>');
    expect(page).toContain('<InspectorPortal');
    expect(page).not.toContain('<SkillContextPanel');
  });

  it('keeps both sidebars mounted while their columns animate', () => {
    const context = read('./WorkspaceInspector.tsx');
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const css = read('./styles/workspace-inspector.css');

    expect(context).toContain("state.open ? 'is-open' : 'is-collapsed'");
    expect(context).toContain('workspace-inspector-panel');
    expect(context).toContain('data-workspace-inspector-outlet');
    expect(sidebar).not.toContain('!collapsed && <span>');
    expect(css).toContain('.workspace-inspector-panel');
    expect(css).not.toContain(
      'transition: width 220ms ease, opacity 180ms ease, transform 220ms ease;',
    );
  });

  it('does not explain the center and right panel layout inside runtime information', () => {
    const context = read('./SkillInspectorContent.tsx');

    expect(context).not.toContain('中间区域用于任务和结果');
    expect(context).not.toContain('不挤占主要交互空间');
  });

  it('renders status updates as auto-closing overlays without shifting the center layout', () => {
    const source = read('./SkillPinnedUpdate.tsx');
    const css = workspaceCss();

    expect(source).toContain('skill-transient-notification');
    expect(source).toContain('getSkillNotificationDuration');
    expect(source).toContain('onMouseEnter');
    expect(source).toContain('onDismiss');
    expect(source).toContain('actionLabel');
    expect(css).toMatch(/\.skill-transient-notification\s*\{\s*position:\s*absolute;/s);
  });

  it('expands the desktop context panel inside the grid instead of covering the main stage', () => {
    const shell = workspaceCss();
    const css = read('./styles/workspace-inspector.css');

    expect(css).toMatch(
      /\.skill-workspace-root\.is-context-open \.workspace-inspector\s*\{/,
    );
    expect(shell).toMatch(/\.skill-content-column\s*\{[^}]*display:\s*flex;/s);
    expect(css).toContain('flex-basis: var(--workspace-inspector-width)');
    expect(css).toContain('@media (max-width: 767px)');
  });

  it('opens four focused Skill creation actions from the compact menu', () => {
    const source = read('./SkillWorkspaceSidebar.tsx');
    const css = workspaceCss();

    expect(source).toContain('skill-create-menu');
    const sidebarRule = css.match(/\.skill-sidebar\s*\{([^}]*)\}/s)?.[1] ?? '';
    expect(sidebarRule).toContain('overflow: visible');
    expect(sidebarRule).toContain('z-index: 20');
    expect(source).toContain('对话共创');
    expect(source).toContain('文档生成');
    expect(source).toContain('完整填写');
    expect(source).toContain('导入 Skill');
    expect(source).not.toContain("mode: 'template'");
    expect(source).not.toContain('自然对话创建');
    expect(source).not.toContain('从模板创建');
    expect(source).not.toContain(
      'skill-sidebar-subnav" aria-label="新建 Skill 的方式',
    );
  });

  it('uses education scenarios as conversation starters instead of a template page', () => {
    const source = read('./GuidedSkillCreationPanel.tsx');
    const scenarios = read('./education-scenarios.ts');

    expect(source).toContain('从一个教学目标开始');
    expect(source).toContain(
      '描述你的教学目标，我会协助梳理需求并生成可运行的 Skill。',
    );
    expect(source).toContain('精选教学场景');
    expect(source).not.toContain('先简单描述目标，我会通过对话帮你逐步补全。');
    expect(source).toContain(
      "import { educationScenarios } from './education-scenarios'",
    );
    expect(source).toContain('educationScenarios.map((scenario)');
    expect(source).toContain('scenario.description');
    expect(source).toContain('scenario.tone');
    expect(scenarios).not.toContain("label: '课堂活动设计'");
    expect(scenarios).not.toContain("label: '作业反馈'");
    expect(scenarios).not.toContain("label: '练习题生成'");
    expect(scenarios).toContain('完整课时设计');
    expect(scenarios).toContain('分层教学设计');
    expect(source).not.toContain("props.createMode === 'template'");
    expect(source).not.toContain('skill-template-start');
  });

  it('shows the current co-creation stage without adding another content layer', () => {
    const source = read('./GuidedSkillCreationPanel.tsx');
    const css = workspaceCss();

    expect(source).toContain('skill-guided-progress');
    expect(source).toContain('提炼你的做法');
    expect(source).toContain('教师经验');
    expect(source).toContain('教育策略');
    expect(source).toContain('行动调整');
    expect(source).toContain('效果复核');
    expect(source).toContain('props.session.flow_version >= 3');
    expect(source).toContain('props.session.completed_steps?.length');
    expect(source).toContain('props.session.confirmed_stages.length + 1');
    expect(source).toContain('total: 5');
    expect(css).toMatch(/\.skill-guided-progress\s*\{[^}]*display:\s*flex;/s);
    expect(css).not.toContain('.skill-guided-stage-card');
  });

  it('renders a guided user message immediately while the assistant is responding', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const panel = read('./GuidedSkillCreationPanel.tsx');

    expect(page).toMatch(/setPendingGuidedMessage\(\s*createPendingGuidedMessage\(/s);
    expect(page).toContain('pendingMessage={visiblePendingGuidedMessage}');
    expect(panel).toContain('shouldDisplayPendingGuidedMessage(');
    expect(panel).toContain('props.pendingMessage.content');
  });

  it('uses Codex accent colors only on the education scenario icons', () => {
    const source = read('./GuidedSkillCreationPanel.tsx');
    const css = workspaceCss();

    expect(source).toContain("scenario.tone === 'codex-orange'");
    expect(source).toMatch(/<ScenarioIcon size=\{20\}[^>]*\/>/);
    expect(css).toMatch(
      /\.skill-starter-card\.is-codex-orange\s*\{[^}]*--starter-accent:\s*#e25507;/s,
    );
    expect(css).toMatch(
      /\.skill-starter-card\.is-codex-green\s*\{[^}]*--starter-accent:\s*#00a240;/s,
    );
    expect(css).toMatch(
      /\.skill-starter-card-icon\s*\{[^}]*background:\s*transparent;/s,
    );
    expect(css).toMatch(
      /\.skill-starter-card:hover\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--muted\)/s,
    );
    expect(css).not.toMatch(
      /\.skill-starter-card:hover\s*\{[^}]*var\(--starter-accent\)/s,
    );
  });

  it('uses centered, action-oriented empty states across Skill workspaces', () => {
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');
    const optimize = read('./SkillOptimizeWorkspace.tsx');
    const css = workspaceCss();

    expect(run).toContain(
      "purpose === 'test' ? '试一试当前 Skill' : '开始使用这个 Skill'",
    );
    expect(run).toContain('用真实任务检查回答是否符合你的预期。');
    expect(run).toContain('输入一个教学任务，看看它如何完成。');
    expect(arena).toContain('<h2>版本对比</h2>');
    expect(arena).toContain('输入同一个任务，直观比较两个版本的回答效果');
    expect(optimize).toContain('正在分析这个 Skill');
    expect(optimize).toContain('马上为你整理值得改进的地方。');
    expect(run).not.toContain('系统会固定使用');
    expect(arena).not.toContain('保存在服务端');
    expect(css).toMatch(
      /\.skill-flat-empty\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*flex-direction:\s*column;/s,
    );
    expect(css).toMatch(/\.skill-flat-empty p\s*\{[^}]*max-width:/s);
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.skill-starter-chips\s*\{\s*grid-template-columns:\s*1fr;/,
    );
  });

  it('keeps the left sidebar focused on Skills and conversations', () => {
    const source = read('./SkillWorkspaceSidebar.tsx');

    expect(source).toContain('skill-repository-link');
    expect(source).toContain('skill-skill-conversations');
    expect(source).toContain('skill-skill-group');
    expect(source).not.toContain('className="skill-sidebar-subnav"');
  });

  it('provides rename and delete actions for recent sessions', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const css = workspaceCss();

    expect(sidebar).toContain('aria-label="会话操作"');
    expect(sidebar).toContain('重命名');
    expect(sidebar).toContain('删除');
    expect(sidebar).toContain('getSessionName(item)');
    expect(page).toContain('liteApi.renameGuidedCreation');
    expect(page).toContain('liteApi.deleteGuidedCreation');
    expect(css).toContain('.skill-session-actions');
  });

  it('expands the right workspace without covering the left sidebar', () => {
    const context = read('./WorkspaceInspector.tsx');
    const css = read('./styles/workspace-inspector.css');

    expect(css).toMatch(
      /\.skill-content-column:has\(\.workspace-inspector\.is-fullscreen\)\s+\.skill-main-column\s*\{[^}]*display:\s*none/s,
    );
    expect(css).not.toMatch(
      /\.workspace-inspector\.is-fullscreen\s*\{[^}]*inset:\s*12px;/s,
    );
    expect(context).toContain(
      "state.fullscreen ? '退出全屏' : '全屏查看右侧栏'",
    );
  });

  it('does not publish a pinned notification after an ordinary Skill run', () => {
    const detail = read('./SkillDetailWorkspace.tsx');

    expect(detail).not.toContain("id: 'skill-run-completed'");
    expect(detail).not.toContain("title: 'Skill 运行完成'");
    expect(detail).not.toContain("id: 'test-recorded'");
  });

  it('keeps teaching material upload as a compact reference attachment', () => {
    const source = read('./GuidedSkillCreationPanel.tsx');

    expect(source).not.toContain('skill-conversation-header');
    expect(source).toContain('skill-material-icon-button');
    expect(source).toContain('title="添加教学材料"');
    expect(source).not.toContain('<strong>{props.createMode');
    expect(source).not.toContain('DOCX、Markdown、TXT，也可拖入');
    expect(source).toContain('onDrop');
  });

  it('renders document generation as a separate creation mode', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(page).toContain("createMode === 'document'");
    expect(page).toContain('DocumentSkillCreationPanel');
  });

  it('renders complete Skill requirements as a structured form', () => {
    const form = read('./StructuredSkillCreationPanel.tsx');
    const guided = read('./GuidedSkillCreationPanel.tsx');
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(form).toMatch(/<form\s+className="skill-structured-form/s);
    expect(form).toContain('Skill 名称');
    expect(form).toContain('服务对象');
    expect(form).toContain('使用场景');
    expect(form).toContain('核心任务');
    expect(form).toContain('输入内容');
    expect(form).toContain('期望输出');
    expect(form).toContain('规则与边界');
    expect(form).toContain('title="添加教学材料"');
    expect(guided).not.toContain('manualPrompt');
    expect(page).toContain("createMode === 'manual'");
    expect(page).toContain('StructuredSkillCreationPanel');
  });

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

  it('opens Skill ZIP import in a focused dialog', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const dialog = read('./SkillImportDialog.tsx');

    expect(page).toContain("if (mode === 'import')");
    expect(page).toContain('<SkillImportDialog');
    expect(dialog).toContain('role="dialog"');
    expect(dialog).toContain('选择 ZIP 文件');
    expect(dialog).toContain('开始导入');
    expect(dialog).not.toContain('<textarea');
  });

  it('styles the refined creation flows with the existing theme variables', () => {
    const css = workspaceCss();

    expect(css).toContain('.skill-starter-section');
    expect(css).toContain('.skill-structured-form');
    expect(css).toContain('.skill-import-dialog-backdrop');
    expect(css).toContain('.skill-import-dialog-dropzone');
    expect(css).not.toContain('.skill-template-start');
    expect(css).not.toContain('.skill-import-dropzone');
    expect(css).not.toContain('.skill-composer.is-import-mode');
  });

  it('loads the Skill repository through the paginated aggregate endpoint', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(page).toContain('liteApi.listRepositorySkills');
    expect(page).not.toContain('Promise.all(\n      packages.map');
    expect(page).not.toContain('liteApi.listPackageSkills');
    expect(page).toContain('repositorySkills');
  });

  it('loads heavyweight workspace surfaces only when the user opens them', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const detail = read('./SkillDetailWorkspace.tsx');
    const inspector = read('./SkillInspectorContent.tsx');

    for (const moduleName of [
      'GuidedSkillCreationPanel',
      'DocumentSkillCreationPanel',
      'StructuredSkillCreationPanel',
      'SkillRepositoryWorkspace',
      'SkillDetailWorkspace',
    ]) {
      expect(page).toContain(`import('../components/skill-workspace/${moduleName}')`);
    }
    expect(detail).toContain("import('./SkillRunWorkspace')");
    expect(detail).toContain("import('./SkillArenaWorkspace')");
    expect(detail).toContain("import('./SkillOptimizeWorkspace')");
    expect(detail).toContain("import('./SkillVersionWorkspace')");
    expect(inspector).toContain("import('./SkillAnswerOptimizationPanel')");
  });

  it('keeps the center top bar minimal and puts panel controls on the right', () => {
    const detail = read('./SkillDetailWorkspace.tsx');
    const context = read('./WorkspaceInspector.tsx');
    const sidebar = read('./SkillWorkspaceSidebar.tsx');

    expect(detail).not.toContain('skill-topbar-actions');
    expect(context).toContain('is-fullscreen');
    expect(context).toContain('全屏查看右侧栏');
    expect(sidebar).toContain('skill-user-menu');
    expect(sidebar).toContain('skill-skill-conversations');
    expect(sidebar).toContain('skill-skill-group');
    expect(sidebar).toContain('activeSkillKey');
    expect(sidebar).toContain('未完成草稿');
  });

  it('uses theme-aware clickable turn navigation instead of a native chat scrollbar', () => {
    const guided = read('./GuidedSkillCreationPanel.tsx');
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');
    const optimize = read('./SkillOptimizeWorkspace.tsx');
    const navigation = read('./ConversationTurnNavigation.tsx');
    const css = workspaceCss();

    expect(guided).toContain('<ConversationTurnNavigation');
    expect(guided).toContain('containerRef={messageListRef}');
    expect(guided).toContain('guided-turn-');
    expect(run).toContain('<ConversationTurnNavigation');
    expect(arena).toContain('<ConversationTurnNavigation');
    expect(optimize).toContain('<ConversationTurnNavigation');
    expect(navigation).toContain('findActiveConversationTurn');
    expect(navigation).toContain("behavior: 'smooth'");
    expect(navigation).toContain('skill-turn-tooltip');
    expect(navigation).not.toContain('title={turn.label}');
    expect(css).toContain('.skill-turn-navigation');
    expect(css).toContain('.skill-turn-tooltip');
    expect(css).toContain('scrollbar-width: none');
    expect(css).toContain('background: var(--primary)');
  });

  it('puts answer optimization on the answer and keeps the composer focused', () => {
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');
    const tool = read('./OptimizeAlongButton.tsx');

    expect(run).not.toContain('<OptimizeAlongButton');
    expect(arena).not.toContain('<OptimizeAlongButton');
    expect(run).toContain('改进这条回答');
    expect(arena).toContain('改进这个版本');
    expect(run).not.toContain('skill-run-modebar');
    expect(tool).toContain('回答优化');
  });

  it('renders Skill conversation management in the left sidebar', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(sidebar).toContain('skill-conversation-list');
    expect(sidebar).toContain('新建对话');
    expect(sidebar).toContain('onConversationSelect');
    expect(page).toContain('listThreadPage');
    expect(page).toContain('selectedConversationId');
  });

  it('starts answer optimization in the right panel only after explicit feedback', () => {
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');
    const panel = read('./SkillAnswerOptimizationPanel.tsx');
    const api = read('../../api/answer-skill-optimizations.ts');

    expect(run).not.toContain('skill-inline-optimization');
    expect(run).not.toContain('setOptimizingMessageId(answer.id)');
    expect(arena).not.toContain('skill-inline-optimization');
    expect(run).toContain("feedback: ''");
    expect(arena).toContain("feedback: ''");
    expect(panel).toContain('skill-answer-optimization-dialogue');
    expect(panel).toContain('skill-answer-optimization-resize-handle');
    expect(panel).toContain('skill-answer-optimization-status-panel');
    expect(panel).toContain('skill-answer-optimization-status-tabs');
    expect(panel).toContain('skill-answer-optimization-composer');
    expect(panel).toContain('feedbackDraft');
    expect(api).toContain('suggestions(');
    expect(api).toContain('ANSWER_SKILL_OPTIMIZATION_ROUTES.SUGGESTIONS');
    expect(panel).toContain('answerSkillOptimizationApi.suggestions');
    expect(panel).toContain('answerSkillOptimizationApi.resolve');
    expect(panel).toContain('existingOptimizationId');
    expect(panel).not.toContain(
      "setError(cause instanceof Error ? cause.message : '暂时无法生成改进建议')",
    );
    expect(panel).toContain('ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS');
    expect(panel).toContain('skill-answer-optimization-suggestions');
    expect(panel).toContain('setFeedbackDraft(suggestion)');
    expect(panel).toContain(
      '<details className="skill-answer-optimization-origin"',
    );
    expect(panel).toContain('说说希望这条回答怎么改进');
    expect(panel).not.toContain('skill-answer-optimization-footer-status');
    expect(panel).toContain('onDoubleClick={resetPanelHeight}');
    expect(panel).toContain('修改');
    expect(panel).toContain('测试');
    expect(panel).toContain('改进有效');
    expect(panel).toContain('项测试通过');
    expect(panel).toContain('查看评估说明');
    expect(panel).toContain('表现最佳');
    expect(panel).toContain("type ReviewTab = 'changes' | 'preview' | 'tests'");
    expect(panel).toContain('完整预览');
    expect(panel).toContain('撤销这一项');
    expect(panel).toContain('detail.draft?.previewContent');
    expect(panel).toContain('buildChangeRemovalFeedback');
    expect(panel).toContain('准备生成新版本');
    expect(panel).not.toContain(
      "cause instanceof Error ? cause.message : '测试没有完成，请重试'",
    );
    expect(panel).not.toContain(
      "cause instanceof Error ? cause.message : '保存失败，请重试'",
    );
    const css = workspaceCss();
    expect(css).toContain(
      '.skill-answer-optimization-status-content::-webkit-scrollbar',
    );
    expect(css).toContain('min-height: 128px');
    expect(css).not.toContain('--skill-answer-composer-height');
    expect(css).not.toContain('.skill-answer-optimization-composer textarea');
    expect(css).toMatch(
      /\.workspace-inspector-outlet \.skill-answer-optimization-panel\s*\{[^}]*min-height:\s*0;[^}]*height:\s*auto;[^}]*flex:\s*1;/s,
    );
    expect(css).toMatch(/\.skill-answer-optimization-panel \.skill-assistant-message\s*\{[^}]*max-width:\s*100%;/s);
    expect(css).not.toContain(
      '.skill-answer-optimization-panel .prose { max-width: 100%; font-size: 10px',
    );
    expect(css).not.toContain(
      '.skill-answer-optimization-panel .skill-assistant-avatar { width: 24px',
    );
    expect(css).not.toContain(
      '.skill-answer-optimization-panel .skill-user-message { max-width: 90%; padding: 8px 11px; font-size: 10px; }',
    );
  });

  it('renders overall Skill optimization replies with the shared Markdown renderer', () => {
    const optimize = read('./SkillOptimizeWorkspace.tsx');

    expect(optimize).toContain(
      "import { MarkdownContent } from '../lite/lite-rendering'",
    );
    expect(optimize).toContain('<MarkdownContent content={message.content} />');
    expect(optimize).not.toContain(
      '<div className="skill-assistant-message">{message.content}</div>',
    );
  });

  it('integrates the resumable multimodal Skill Pack flow behind a feature flag', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const panel = read('./MultimodalSkillCreationPanel.tsx');
    const state = read('./multimodal-guided-creation-state.ts');
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const css = workspaceCss();

    expect(sidebar).toContain("VITE_MULTIMODAL_SKILL_PACK_ENABLED !== 'false'");
    expect(sidebar).toContain('音视频蒸馏');
    expect(page).toMatch(/lazy\(\(\)\s*=>\s*import\(['"]\.\.\/components\/skill-workspace\/MultimodalSkillCreationPanel['"]\)/s);
    expect(page).toContain('label="正在打开音视频蒸馏"');
    expect(page).toContain("createMode === 'multimodal'");
    expect(page).toContain('<MultimodalSkillCreationPanel');
    expect(panel).toContain('streamMediaProgress');
    expect(panel).toContain('scheduleSseReconnect');
    expect(panel).toContain('streamAbortController.abort()');
    expect(panel).toContain('streamAbortController.signal');
    expect(panel).not.toContain('retryMediaProcessing');
    expect(panel).toContain('系统已自动尝试恢复，仍未成功。请查看诊断。');
    expect(panel).toContain('createMediaAssetPreview');
    expect(panel).toContain('<MultimodalWizardShell');
    expect(panel).toContain("reviewStep === 'processing'");
    expect(panel).toContain("reviewStep === 'overview'");
    expect(panel).toContain("reviewStep === 'candidates'");
    expect(panel).toContain("reviewStep === 'release'");
    expect(panel).toContain('confirmGeneratedMediaSkills');
    expect(panel).not.toContain('startMediaArenaTest');
    expect(panel).not.toContain('运行固定 Arena 测试');
    expect(panel).toContain('确认生成');
    expect(panel).not.toContain('等待发布门禁接入');
    expect(panel).toContain('个融合主题并构建 Skill');
    expect(state).toContain("connection: 'polling'");
    expect(css).toContain('.skill-mm-shell');
    expect(css).toContain('@media (max-width: 900px)');
  });

  it('remounts the multimodal workbench when starting another distillation', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(page).toContain(
      'const [multimodalCreationKey, setMultimodalCreationKey] = useState(0);',
    );
    expect(page).toContain(
      'setMultimodalCreationKey((current) => current + 1);',
    );
    expect(page).toContain('key={multimodalCreationKey}');
  });

  it('supports precise single and batch deletion from a paginated Skill repository', () => {
    const repository = read('./SkillRepositoryWorkspace.tsx');
    const cards = read('./RepositoryCards.tsx');
    const dialog = read('./SkillDeleteConfirmDialog.tsx');
    const api = read('../../api/lite-api.ts');

    expect(repository).toContain("type RepositoryTab = 'created' | 'drafts'");
    expect(repository).toContain('批量管理');
    expect(repository).toContain('全选当前搜索结果');
    expect(repository).toContain('repositoryPageItems');
    expect(cards).toContain('aria-label={`${skill.name}操作`}');
    expect(cards).toContain('data-skill-delete-return={skill.skillId}');
    expect(repository).toContain(
      'returnFocusSkillId={deleteReturnFocusSkillId}',
    );
    expect(repository).toContain('<SkillDeleteConfirmDialog');
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain('cancelButtonRef.current?.focus()');
    expect(dialog).toContain("event.key === 'Tab'");
    expect(dialog).toContain('previousFocus !== document.body');
    expect(dialog).toContain(
      '[data-skill-delete-return="${returnFocusSkillId}"]',
    );
    expect(dialog).toContain("'[data-skill-delete-return-focus]'");
    expect(dialog).toContain('删除选中的 Skill？');
    expect(dialog).toContain('原始素材与处理产物仍会保留');
    expect(api).toContain("'/skills/batch-delete'");
    expect(api).toContain("method: 'POST'");
  });

  it('keeps internal package terminology out of the visible Skill workspace copy', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const multimodal = read('./MultimodalSkillCreationPanel.tsx');
    const multimodalWizard = read('./multimodal/MultimodalWizardShell.tsx');
    const multimodalRelease = read('./multimodal/MultimodalReleaseStep.tsx');
    const multimodalModel = read('./multimodal/multimodal-wizard-model.ts');
    const agentBuild = read('../agent/build-components.tsx');
    const versions = read('./SkillVersionWorkspace.tsx');

    expect(sidebar).toContain('从课堂视频或播客生成 Skill');
    expect(sidebar).not.toContain('从课堂视频或播客生成 Skill Pack');
    expect(multimodal).toContain('确认生成');
    expect(multimodal).not.toContain('确认发布 Skill Pack');
    expect(multimodal).toContain('尚未生成 Skill。');
    expect(multimodal).not.toContain('尚未生成 Skill Pack。');
    expect(multimodalWizard).not.toContain('Skill Pack');
    expect(multimodalRelease).not.toContain('Skill Pack');
    expect(multimodalModel).not.toContain('Skill Pack');
    expect(agentBuild).not.toContain('skill package');
    expect(versions).toContain('无法确认当前 Skill 版本，请刷新后重试');
    expect(versions).not.toContain(
      '无法确认当前 Package Version，请刷新后重试',
    );
  });

  it('cleans repository, workspace, and active selection after server-confirmed deletion', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(page).toContain('const deleteRepositorySkills = async');
    expect(page).toContain('liteApi.batchDeleteSkills(token, skillIds)');
    expect(page).toContain('result.deletedSkillIds');
    expect(page).toMatch(/setRepositorySkills\(\(current\)\s*=>\s*current\.filter/s);
    expect(page).toMatch(/setWorkspaceSkillKeys\(\(current\)\s*=>\s*current\.filter/s);
    expect(page).toContain(
      'activeSkill && deletedSkillIds.has(activeSkill.skillId)',
    );
    expect(page).toContain('setSession(null)');
    expect(page).toContain('setSelectedSessionId(null)');
    expect(page).toContain(
      "dispatchWorkspace({ type: 'navigate', view: 'repository' })",
    );
    expect(page).toContain('await refreshRepository()');
    expect(page).toContain('Skill 已删除，但仓库同步失败，请刷新页面');
    expect(page).toContain('onDeleteSkills={deleteRepositorySkills}');
  });

  it('uses the main page as the only repository scroll owner and styles management controls', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const css = workspaceCss();
    const repositoryRule =
      css.match(/\.skill-repository\s*\{([^}]*)\}/)?.[1] || '';

    expect(page).toContain(
      "workspaceState.activeView === 'repository' ? 'is-repository' : ''",
    );
    expect(repositoryRule).not.toMatch(/(^|;)\s*height:\s*100%/);
    expect(repositoryRule).not.toContain('overflow-y: auto');
    expect(css).toMatch(
      /\.skill-main-stage\.is-repository\s*\{[^}]*overflow-y:\s*auto;/s,
    );
    expect(css).toContain('.skill-repository-tabs');
    expect(css).toContain('.skill-repository-bulkbar');
    expect(css).toContain('.skill-repository-card-menu');
    expect(css).toContain('.skill-repository-pagination');
    expect(css).toContain('.skill-delete-dialog-backdrop');
    expect(css).toContain('.skill-delete-dialog');
  });
});
