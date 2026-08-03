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

  it('renders pinned updates as a separate compact component', () => {
    const source = read('./SkillPinnedUpdate.tsx');

    expect(source).toContain('skill-pinned-update');
    expect(source).toContain('onDismiss');
    expect(source).toContain('actionLabel');
  });

  it('expands the desktop context panel inside the grid instead of covering the main stage', () => {
    const css = read('./skill-workspace.css');

    expect(css).toMatch(/\.skill-workspace-root\.is-context-open\s*\{/);
    expect(css).toMatch(/grid-template-columns:\s*var\(--skill-sidebar-current\)\s+minmax\(0,\s*1fr\)\s+var\(--skill-context-width\)/);
    expect(css).toContain('@media (max-width: 620px)');
  });

  it('opens four focused Skill creation actions from the compact menu', () => {
    const source = read('./SkillWorkspaceSidebar.tsx');

    expect(source).toContain('skill-create-menu');
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

    expect(source).toContain('从常用场景开始');
    expect(source).toContain('课堂活动设计');
    expect(source).toContain('作业反馈');
    expect(source).toContain('练习题生成');
    expect(source).not.toContain("props.createMode === 'template'");
    expect(source).not.toContain('skill-template-start');
  });

  it('keeps selected-Skill functions in the left sidebar', () => {
    const source = read('./SkillWorkspaceSidebar.tsx');

    expect(source).toContain("view: 'run'");
    expect(source).toContain("view: 'arena'");
    expect(source).toContain('版本管理');
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
    expect(context).toContain('全屏显示右侧栏');
    expect(sidebar).toContain('skill-user-menu');
  });
});
