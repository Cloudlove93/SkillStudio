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

  it('keeps creation and selected-Skill functions in the left sidebar', () => {
    const source = read('./SkillWorkspaceSidebar.tsx');

    expect(source).toContain('自然对话创建');
    expect(source).toContain('模板创建');
    expect(source).toContain('导入 Skill');
    expect(source).toContain("view: 'run'");
    expect(source).toContain("view: 'arena'");
    expect(source).toContain('版本管理');
  });

  it('keeps creation focused and makes teaching-material upload obvious', () => {
    const source = read('./GuidedSkillCreationPanel.tsx');

    expect(source).not.toContain('skill-conversation-header');
    expect(source).toContain('添加教学材料');
    expect(source).toContain('DOCX、Markdown、TXT');
    expect(source).toContain('onDrop');
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
