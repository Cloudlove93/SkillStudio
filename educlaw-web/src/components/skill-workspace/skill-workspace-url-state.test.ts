import { describe, expect, it } from 'vitest';
import {
  parseSkillWorkspaceSearch,
  writeSkillWorkspaceSearch,
} from './skill-workspace-url-state';

describe('Skill workspace URL state', () => {
  it('parses a shareable Skill surface and repository filter', () => {
    expect(
      parseSkillWorkspaceSearch('?view=arena&skill=12%3A34&q=%E5%87%BD%E6%95%B0'),
    ).toEqual({ view: 'arena', skillKey: '12:34', repositoryQuery: '函数' });
  });

  it('rejects unknown views and malformed Skill identities', () => {
    expect(parseSkillWorkspaceSearch('?view=secret&skill=../../etc')).toEqual({
      view: 'create',
      skillKey: null,
      repositoryQuery: '',
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
