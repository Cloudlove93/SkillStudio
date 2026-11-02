import { describe, expect, it } from 'vitest';
import {
  parseSkillWorkspaceSearch,
  writeSkillWorkspaceSearch,
  readSkillConversationId,
  writeSkillConversationSearch,
} from './skill-workspace-url-state';

describe('Skill workspace URL state', () => {
  it('restores only a conversation identity and preserves all other URL state', () => {
    expect(readSkillConversationId('?view=run&conversation=91')).toBe('91');
    expect(readSkillConversationId('?conversation=../secret')).toBeNull();
    expect(
      writeSkillConversationSearch(
        '?view=test&skill=12%3A34&inspector=versions',
        '91',
      ),
    ).toBe('?view=test&skill=12%3A34&inspector=versions&conversation=91');
    expect(
      writeSkillConversationSearch('?view=run&conversation=91', null),
    ).toBe('?view=run');
  });
  it('parses a shareable Skill surface and repository filter', () => {
    expect(
      parseSkillWorkspaceSearch(
        '?view=arena&skill=12%3A34&q=%E5%87%BD%E6%95%B0',
      ),
    ).toEqual({ view: 'arena', skillKey: '12:34', repositoryQuery: '函数' });
  });

  it('rejects unknown views and malformed Skill identities', () => {
    expect(parseSkillWorkspaceSearch('?view=secret&skill=../../etc')).toEqual({
      view: 'home',
      skillKey: null,
      repositoryQuery: '',
    });
  });

  it('restores the InnoSkill portal pages', () => {
    expect(parseSkillWorkspaceSearch('?view=workbench').view).toBe('workbench');
    expect(
      parseSkillWorkspaceSearch('?view=square&q=%E6%95%99%E5%AD%A6'),
    ).toEqual({
      view: 'square',
      skillKey: null,
      repositoryQuery: '教学',
    });
  });

  it('updates workspace state without dropping inspector state', () => {
    expect(
      writeSkillWorkspaceSearch('?inspector=skill%3Aversions', {
        view: 'run',
        skillKey: '12:34',
        repositoryQuery: '',
      }),
    ).toBe('?inspector=skill%3Aversions&view=run&skill=12%3A34');
  });
});
