import { describe, expect, it } from 'vitest';
import {
  legacySkillsDestination,
  readAssetListState,
  selectAssetPage,
} from './asset-center-state';

describe('asset routes and list state', () => {
  it.each([
    ['', '/agents?tab=skills'],
    [
      '?agentId=4&conversation=6&autochat=1',
      '/agents?agentId=4&conversation=6&autochat=1',
    ],
    ['?skillId=2&autochat=1', '/agents?skillId=2&autochat=1'],
    [
      '?view=run&skill=1%3A2&conversation=4',
      '/?view=run&skill=1%3A2&conversation=4',
    ],
    ['?view=versions&skill=1%3A2', '/?view=versions&skill=1%3A2'],
    ['?resultSession=5', '/?resultSession=5'],
    ['?view=my-skills&q=lesson', '/agents?skillsQuery=lesson&tab=skills'],
    [
      '?view=repository&skill=8%3A21',
      '/agents?previewPackage=8&previewSkill=21&tab=skills',
    ],
    ['?view=my-skills&session=5', '/agents?session=5&tab=skills'],
  ])('keeps legacy links reachable: %s', (search, expected) => {
    expect(legacySkillsDestination(search)).toBe(expected);
  });
  it('preserves independent Agent and Skill filters', () => {
    const params = new URLSearchParams(
      'agentsQuery=lesson&agentsFilter=ready&agentsSort=name&agentsPage=2&skillsQuery=review&skillsFilter=attention',
    );
    expect(readAssetListState(params, 'agents')).toEqual({
      query: 'lesson',
      filter: 'ready',
      sort: 'name',
      page: 2,
    });
    expect(readAssetListState(params, 'skills')).toEqual({
      query: 'review',
      filter: 'attention',
      sort: 'updated',
      page: 1,
    });
  });
  it('normalizes invalid URL options and clamps pages after filtering', () => {
    const state = readAssetListState(
      new URLSearchParams(
        'agentsPage=-2&agentsFilter=invalid&agentsSort=invalid',
      ),
      'agents',
    );
    expect(state).toEqual({
      query: '',
      filter: 'all',
      sort: 'updated',
      page: 1,
    });
    expect(selectAssetPage([], { ...state, page: 99 })).toMatchObject({
      items: [],
      page: 1,
      pageCount: 1,
      total: 0,
    });
  });
  it('filters and sorts before pagination without changing source order', () => {
    const items = Array.from({ length: 26 }, (_, index) => ({
      id: String(index),
      name: `lesson ${index}`,
      description: '',
      updatedAt: new Date(2026, 0, index + 1).toISOString(),
      ready: index % 2 === 0,
    }));
    const state = {
      query: 'lesson',
      filter: 'ready' as const,
      sort: 'updated' as const,
      page: 1,
    };
    const first = selectAssetPage(items, state);
    const last = selectAssetPage(items, { ...state, page: 2 });
    expect(first.items).toHaveLength(12);
    expect(last.items).toHaveLength(1);
    expect(
      new Set([...first.items, ...last.items].map((item) => item.id)).size,
    ).toBe(13);
    expect(first.items[0].id).toBe('24');
    expect(items[0].id).toBe('0');
  });
});
