import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('Skill-first workspace UI contract', () => {
  it('uses the Skill workspace as the authenticated default and keeps a legacy fallback', () => {
    const source = read('../../App.tsx');

    expect(source).toContain('path="/" element={<RequireAuth><SkillFirstWorkspace /></RequireAuth>}');
    expect(source).toContain('path="/legacy" element={<RequireAuth><Workspace /></RequireAuth>}');
  });

  it('provides separate information and version controls on the compact right rail', () => {
    const source = read('./SkillContextPanel.tsx');

    expect(source).toContain('skill-context-rail');
    expect(source).toContain('aria-label="当前信息"');
    expect(source).toContain('aria-label="版本管理"');
  });

  it('keeps both sidebars mounted while their columns animate', () => {
    const context = read('./SkillContextPanel.tsx');
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const css = read('./skill-workspace.css');

    expect(context).toContain("props.open ? 'is-open' : 'is-collapsed'");
    expect(context).toContain('skill-context-panel-body');
    expect(context).not.toContain('if (!props.open)');
    expect(sidebar).not.toContain('!collapsed && <span>');
    expect(css).toContain('transition: grid-template-columns 240ms cubic-bezier(.2, .8, .2, 1);');
    expect(css).toContain('.skill-context-panel-body');
    expect(css).not.toContain('transition: width 220ms ease, opacity 180ms ease, transform 220ms ease;');
  });

  it('does not explain the center and right panel layout inside runtime information', () => {
    const context = read('./SkillContextPanel.tsx');

    expect(context).not.toContain('中间区域用于任务和结果');
    expect(context).not.toContain('不挤占主要交互空间');
  });

  it('renders status updates as auto-closing overlays without shifting the center layout', () => {
    const source = read('./SkillPinnedUpdate.tsx');
    const css = read('./skill-workspace.css');

    expect(source).toContain('skill-transient-notification');
    expect(source).toContain('getSkillNotificationDuration');
    expect(source).toContain('onMouseEnter');
    expect(source).toContain('onDismiss');
    expect(source).toContain('actionLabel');
    expect(css).toContain('.skill-transient-notification { position: absolute');
  });

  it('expands the desktop context panel inside the grid instead of covering the main stage', () => {
    const css = read('./skill-workspace.css');

    expect(css).toMatch(/\.skill-workspace-root\.is-context-open\s*\{/);
    expect(css).toMatch(/grid-template-columns:\s*var\(--skill-sidebar-current\)\s+minmax\(0,\s*1fr\)\s+var\(--skill-context-width\)/);
    expect(css).toContain('@media (max-width: 620px)');
  });

  it('opens four focused Skill creation actions from the compact menu', () => {
    const source = read('./SkillWorkspaceSidebar.tsx');
    const css = read('./skill-workspace.css');

    expect(source).toContain('skill-create-menu');
    expect(css).toMatch(/\.skill-sidebar\s*\{\s*overflow:\s*visible;/);
    expect(css).toMatch(/\.skill-sidebar\s*\{\s*overflow:\s*visible;\s*z-index:\s*20;/);
    expect(source).toContain('对话共创');
    expect(source).toContain('文档生成');
    expect(source).toContain('完整填写');
    expect(source).toContain('导入 Skill');
    expect(source).not.toContain("mode: 'template'");
    expect(source).not.toContain('自然对话创建');
    expect(source).not.toContain('从模板创建');
    expect(source).not.toContain('skill-sidebar-subnav" aria-label="新建 Skill 的方式');
  });

  it('uses education scenarios as conversation starters instead of a template page', () => {
    const source = read('./GuidedSkillCreationPanel.tsx');
    const scenarios = read('./education-scenarios.ts');

    expect(source).toContain('从一个教学目标开始');
    expect(source).toContain('描述你的教学目标，我会协助梳理需求并生成可运行的 Skill。');
    expect(source).toContain('精选教学场景');
    expect(source).not.toContain('先简单描述目标，我会通过对话帮你逐步补全。');
    expect(source).toContain("import { educationScenarios } from './education-scenarios'");
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
    const css = read('./skill-workspace.css');

    expect(source).toContain('skill-guided-progress');
    expect(source).toContain('提炼你的做法');
    expect(source).toContain('教师经验');
    expect(source).toContain('教育策略');
    expect(source).toContain('行动调整');
    expect(source).toContain('效果复核');
    expect(source).toContain('props.session.flow_version >= 3');
    expect(source).toContain('props.session.completed_steps?.length');
    expect(source).toContain('props.session.confirmed_stages.length + 1');
    expect(source).toContain("total: 5");
    expect(css).toMatch(/\.skill-guided-progress\s*\{[^}]*display:\s*flex;/s);
    expect(css).not.toContain('.skill-guided-stage-card');
  });

  it('renders a guided user message immediately while the assistant is responding', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const panel = read('./GuidedSkillCreationPanel.tsx');

    expect(page).toContain('setPendingGuidedMessage(createPendingGuidedMessage(');
    expect(page).toContain('pendingMessage={visiblePendingGuidedMessage}');
    expect(panel).toContain('shouldDisplayPendingGuidedMessage(');
    expect(panel).toContain('props.pendingMessage.content');
  });

  it('uses Codex accent colors only on the education scenario icons', () => {
    const source = read('./GuidedSkillCreationPanel.tsx');
    const css = read('./skill-workspace.css');

    expect(source).toContain("scenario.tone === 'codex-orange'");
    expect(source).toContain('<ScenarioIcon size={20} />');
    expect(css).toMatch(/\.skill-starter-card\.is-codex-orange\s*\{[^}]*--starter-accent:\s*#e25507;/s);
    expect(css).toMatch(/\.skill-starter-card\.is-codex-green\s*\{[^}]*--starter-accent:\s*#00a240;/s);
    expect(css).toMatch(/\.skill-starter-card-icon\s*\{[^}]*background:\s*transparent;/s);
    expect(css).toMatch(/\.skill-starter-card:hover\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--muted\)/s);
    expect(css).not.toMatch(/\.skill-starter-card:hover\s*\{[^}]*var\(--starter-accent\)/s);
  });

  it('uses centered, action-oriented empty states across Skill workspaces', () => {
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');
    const optimize = read('./SkillOptimizeWorkspace.tsx');
    const css = read('./skill-workspace.css');

    expect(run).toContain("purpose === 'test' ? '试一试当前 Skill' : '开始使用这个 Skill'");
    expect(run).toContain("purpose === 'test' ? '用真实任务检查回答是否符合你的预期。' : '输入一个教学任务，看看它如何完成。'");
    expect(arena).toContain('看看哪个版本表现更好');
    expect(arena).toContain('输入同一个教学任务，直观比较两个版本的回答。');
    expect(optimize).toContain('正在分析这个 Skill');
    expect(optimize).toContain('马上为你整理值得改进的地方。');
    expect(run).not.toContain('系统会固定使用');
    expect(arena).not.toContain('保存在服务端');
    expect(css).toMatch(/\.skill-flat-empty\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*flex-direction:\s*column;/s);
    expect(css).toMatch(/\.skill-flat-empty p\s*\{[^}]*max-width:/s);
    expect(css).toMatch(/@media \(max-width: 620px\)[\s\S]*\.skill-starter-chips\s*\{\s*grid-template-columns:\s*1fr;/);
  });

  it('keeps the left sidebar focused on Skills and conversations', () => {
    const source = read('./SkillWorkspaceSidebar.tsx');

    expect(source).toContain('skill-repository-link');
    expect(source).toContain('skill-skill-conversations');
    expect(source).toContain('我的 Skills');
    expect(source).not.toContain('skill-sidebar-subnav');
  });

  it('provides rename and delete actions for recent sessions', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const css = read('./skill-workspace.css');

    expect(sidebar).toContain('aria-label="会话操作"');
    expect(sidebar).toContain('重命名');
    expect(sidebar).toContain('删除');
    expect(sidebar).toContain('session.display_name ||');
    expect(page).toContain('liteApi.renameGuidedCreation');
    expect(page).toContain('liteApi.deleteGuidedCreation');
    expect(css).toContain('.skill-session-actions');
  });

  it('expands the right workspace without covering the left sidebar', () => {
    const context = read('./SkillContextPanel.tsx');
    const css = read('./skill-workspace.css');

    expect(css).toMatch(
      /\.skill-context\.is-fullscreen\s*\{[^}]*left:\s*calc\(12px \+ var\(--skill-sidebar-current\)\)/s,
    );
    expect(css).not.toMatch(
      /\.skill-context\.is-fullscreen\s*\{[^}]*inset:\s*12px;/s,
    );
    expect(context).toContain("fullscreen ? '退出展开' : '展开工作区'");
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

    expect(form).toContain('<form className="skill-structured-form');
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
    const css = read('./skill-workspace.css');

    expect(css).toContain('.skill-starter-section');
    expect(css).toContain('.skill-structured-form');
    expect(css).toContain('.skill-import-dialog-backdrop');
    expect(css).toContain('.skill-import-dialog-dropzone');
    expect(css).not.toContain('.skill-template-start');
    expect(css).not.toContain('.skill-import-dropzone');
    expect(css).not.toContain('.skill-composer.is-import-mode');
  });

  it('loads the Skill repository from package Skill identities, not only creation sessions', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');

    expect(page).toContain('liteApi.listPackages');
    expect(page).toContain('liteApi.listPackageSkills');
    expect(page).toContain('repositorySkills');
  });

  it('keeps the center top bar minimal and puts panel controls on the right', () => {
    const detail = read('./SkillDetailWorkspace.tsx');
    const context = read('./SkillContextPanel.tsx');
    const sidebar = read('./SkillWorkspaceSidebar.tsx');

    expect(detail).not.toContain('skill-topbar-actions');
    expect(context).toContain('is-fullscreen');
    expect(context).toContain('展开工作区');
    expect(sidebar).toContain('skill-user-menu');
    expect(sidebar).toContain('skill-skill-conversations');
    expect(sidebar).toContain('我的 Skills');
    expect(sidebar).toContain('activeSkillKey');
    expect(sidebar).toContain('未完成草稿');
  });

  it('uses theme-aware clickable turn navigation instead of a native chat scrollbar', () => {
    const guided = read('./GuidedSkillCreationPanel.tsx');
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');
    const optimize = read('./SkillOptimizeWorkspace.tsx');
    const navigation = read('./ConversationTurnNavigation.tsx');
    const css = read('./skill-workspace.css');

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
    expect(page).toContain('listThreads');
    expect(page).toContain('selectedConversationId');
  });

  it('starts answer optimization in the right panel only after explicit feedback', () => {
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');
    const panel = read('./SkillAnswerOptimizationPanel.tsx');

    expect(run).not.toContain('skill-inline-optimization');
    expect(run).not.toContain('setOptimizingMessageId(answer.id)');
    expect(arena).not.toContain('skill-inline-optimization');
    expect(run).toContain("feedback: ''");
    expect(arena).toContain("feedback: ''");
    expect(panel).toContain('skill-answer-optimization-composer');
    expect(panel).toContain('feedbackDraft');
    expect(panel).toContain('开始改进');
  });
});
