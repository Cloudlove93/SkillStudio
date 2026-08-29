import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');

describe('workspace accessibility contract', () => {
  it('has a keyboard-visible skip link and a stable main target', () => {
    const app = read('../../App.tsx');
    const workspace = read('../../pages/SkillFirstWorkspace.tsx');
    const css = read('../../index.css');

    expect(app).toContain('href="#main-content"');
    expect(app).toContain('跳到主要内容');
    expect(workspace).toContain('id="main-content"');
    expect(css).toContain('.skip-link:focus');
    expect(app).toContain('页面不存在');
    expect(app).toContain('<NotFoundPage />');
  });

  it('uses an accessible product dialog instead of native confirm for dirty inspector content', () => {
    const inspector = read('./WorkspaceInspector.tsx');
    const dialog = read('./DiscardInspectorChangesDialog.tsx');

    expect(inspector).not.toContain('window.confirm');
    expect(inspector).toContain('<DiscardInspectorChangesDialog');
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain("event.key === 'Escape'");
    expect(dialog).toContain("event.key !== 'Tab'");
  });

  it('labels the main conversation composers for assistive technology', () => {
    const guided = read('./GuidedSkillCreationPanel.tsx');
    const run = read('./SkillRunWorkspace.tsx');
    const arena = read('./SkillArenaWorkspace.tsx');

    expect(guided).toContain('aria-label="共创建议与补充说明"');
    expect(run).toContain('aria-label={');
    expect(run).toContain("'输入测试任务'");
    expect(run).toContain("'输入 Skill 使用任务'");
    expect(arena).toContain('aria-label="输入对比测试任务"');
  });
});
