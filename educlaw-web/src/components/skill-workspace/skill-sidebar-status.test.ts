import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8');
const sidebarCss = () => read('./styles/workspace-shell.css');

describe('Skill sidebar run status contract', () => {
  it('keeps Skill symbols on the left and conversation state on the right', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const conversation = read('./SkillConversationList.tsx');
    const css = sidebarCss();

    expect(sidebar).toContain('skill-skill-symbol');
    expect(sidebar).not.toContain(
      '<span className="skill-status-dot status-completed" />',
    );
    expect(conversation).toContain('running');
    expect(conversation).toContain('skill-conversation-status');
    expect(css).toContain('.skill-conversation-status');
    expect(css).toContain('margin-left: auto');
  });

  it('allows the active Skill to collapse and reopen its conversations', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');

    expect(sidebar).toContain('expandedSkillKey');
    expect(sidebar).toContain('setExpandedSkillKey');
    expect(sidebar).toContain('expandedSkillKey === skill.key');
  });

  it('uses hidden hover actions and shared right-click menus for Skill rows and conversations', () => {
    const sidebar = read('./SkillWorkspaceSidebar.tsx');
    const conversation = read('./SkillConversationList.tsx');
    const css = sidebarCss();

    expect(sidebar).toContain('onSkillAction');
    expect(sidebar).toContain('onContextMenu');
    expect(sidebar).toContain('SkillContextMenu');
    expect(conversation).toContain('onContextMenu');
    expect(conversation).toContain('SkillContextMenu');
    expect(css).toContain('.skill-skill-more');
    expect(css).toContain('opacity: 0');
  });

  it('binds status indicators to run state instead of the selected conversation', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const conversation = read('./SkillConversationList.tsx');

    expect(page).toContain('completedConversationIds');
    expect(page).toContain('setCompletedConversationIds');
    expect(conversation).toContain('runningConversationId');
    expect(conversation).toContain('completedConversationIds');
    expect(conversation).toContain('skill-conversation-status-slot');
    expect(conversation).not.toContain('{selected ? (');
  });

  it('surfaces conversation deletion failures instead of leaving the row unchanged silently', () => {
    const page = read('../../pages/SkillFirstWorkspace.tsx');
    const start = page.indexOf('const deleteConversation =');
    const end = page.indexOf('const openRepositorySkill =', start);
    const deleteFlow = page.slice(start, end);

    expect(deleteFlow).toContain('try {');
    expect(deleteFlow).toContain('toast.error(');
  });
});
