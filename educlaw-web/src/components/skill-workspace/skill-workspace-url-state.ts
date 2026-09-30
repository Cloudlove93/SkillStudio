import type { SkillWorkspaceView } from './skill-workspace-state';

const VIEWS = new Set<SkillWorkspaceView>([
  'create',
  'repository',
  'overview',
  'run',
  'test',
  'arena',
  'optimize',
  'versions',
  'report',
]);
const SKILL_KEY_PATTERN = /^[1-9]\d*:[1-9]\d*$/;

export interface SkillWorkspaceUrlState {
  view: SkillWorkspaceView;
  skillKey: string | null;
  repositoryQuery: string;
}

export function parseSkillWorkspaceSearch(search: string): SkillWorkspaceUrlState {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  const rawView = params.get('view');
  const view = rawView && VIEWS.has(rawView as SkillWorkspaceView)
    ? rawView as SkillWorkspaceView
    : 'create';
  const rawSkillKey = params.get('skill')?.trim() ?? '';
  const repositoryQuery = (params.get('q') ?? '').trim().slice(0, 120);
  return {
    view,
    skillKey: SKILL_KEY_PATTERN.test(rawSkillKey) ? rawSkillKey : null,
    repositoryQuery,
  };
}

export function writeSkillWorkspaceSearch(
  search: string,
  state: SkillWorkspaceUrlState,
) {
  const params = new URLSearchParams(
    search.startsWith('?') ? search.slice(1) : search,
  );
  params.set('view', state.view);
  if (state.skillKey) params.set('skill', state.skillKey);
  else params.delete('skill');
  if (state.repositoryQuery) params.set('q', state.repositoryQuery.slice(0, 120));
  else params.delete('q');
  const next = params.toString();
  return next ? `?${next}` : '';
}
