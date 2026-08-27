import { describe, expect, it } from 'vitest';
import type { RepositorySkill } from './SkillRepositoryWorkspace';
import {
  REPOSITORY_PAGE_SIZE,
  clampRepositoryPage,
  filterRepositorySkills,
  intersectSkillSelection,
  repositoryPageItems,
  selectionForFilteredSkills,
  summarizeSkillDeletion,
} from './skill-repository-state';

const skills: RepositorySkill[] = Array.from({ length: 10 }, (_, index) => ({
  key: `1:${index + 1}`,
  packageId: '1',
  skillId: String(index + 1),
  name: index === 8 ? '物理实验' : `Skill ${index + 1}`,
  description: index === 9 ? '函数课程' : '',
  updatedAt: '2026-08-25T00:00:00.000Z',
}));

describe('Skill repository state', () => {
  it('uses eight rows per page', () => {
    expect(REPOSITORY_PAGE_SIZE).toBe(8);
  });

  it('filters by Skill name and description without case sensitivity', () => {
    expect(
      filterRepositorySkills(skills, '物理').map((item) => item.skillId),
    ).toEqual(['9']);
    expect(
      filterRepositorySkills(skills, '函数').map((item) => item.skillId),
    ).toEqual(['10']);
    expect(
      filterRepositorySkills(skills, 'skill 1').map((item) => item.skillId),
    ).toEqual(['1', '10']);
  });

  it('selects every filtered result instead of only the visible page', () => {
    const selected = selectionForFilteredSkills(skills, new Set(['99']));

    expect([...selected]).toEqual([
      '99',
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
    ]);
  });

  it('intersects a selection with the current filtered result', () => {
    expect(
      [...intersectSkillSelection(new Set(['1', '9', '99']), skills.slice(0, 9))],
    ).toEqual(['1', '9']);
  });

  it('clamps an invalid page after rows disappear', () => {
    expect(clampRepositoryPage(2, 7)).toBe(1);
    expect(clampRepositoryPage(0, 10)).toBe(1);
  });

  it('returns only the requested eight-row page', () => {
    expect(repositoryPageItems(skills, 1).map((item) => item.skillId)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
    expect(repositoryPageItems(skills, 2).map((item) => item.skillId)).toEqual([
      '9',
      '10',
    ]);
  });

  it('summarizes at most three selected Skill names', () => {
    expect(summarizeSkillDeletion(skills.slice(0, 5))).toEqual({
      count: 5,
      names: ['Skill 1', 'Skill 2', 'Skill 3'],
      remaining: 2,
    });
  });
});
