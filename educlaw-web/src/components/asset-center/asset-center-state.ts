import type { AgentSummary } from '@educlaw/shared';
import type { RepositorySkillRecord } from '../../api/lite-api';

export type AssetTab = 'agents' | 'skills';
export type AssetFilter = 'all' | 'ready' | 'attention';
export type AssetSort = 'updated' | 'name' | 'oldest';
export interface AssetListState {
  query: string;
  filter: AssetFilter;
  sort: AssetSort;
  page: number;
}
export interface AssetEntry {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  ready: boolean;
}
export const ASSET_PAGE_SIZE = 12;

export function readAssetListState(
  params: URLSearchParams,
  tab: AssetTab,
): AssetListState {
  const filter = params.get(`${tab}Filter`);
  const sort = params.get(`${tab}Sort`);
  const page = Number(params.get(`${tab}Page`) || 1);
  return {
    query: params.get(`${tab}Query`) || '',
    filter: filter === 'ready' || filter === 'attention' ? filter : 'all',
    sort: sort === 'name' || sort === 'oldest' ? sort : 'updated',
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
  };
}

export function selectAssetPage<T extends AssetEntry>(
  items: T[],
  state: AssetListState,
) {
  const query = state.query.trim().toLocaleLowerCase();
  const filtered = items.filter(
    (item) =>
      `${item.name} ${item.description}`.toLocaleLowerCase().includes(query) &&
      (state.filter === 'all' || item.ready === (state.filter === 'ready')),
  );
  filtered.sort((left, right) => {
    const order =
      state.sort === 'name'
        ? left.name.localeCompare(right.name, 'zh-CN')
        : (Date.parse(right.updatedAt) || 0) -
          (Date.parse(left.updatedAt) || 0);
    return (
      (state.sort === 'oldest' ? -order : order) ||
      left.id.localeCompare(right.id)
    );
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / ASSET_PAGE_SIZE));
  const page = Math.min(state.page, pageCount);
  return {
    items: filtered.slice((page - 1) * ASSET_PAGE_SIZE, page * ASSET_PAGE_SIZE),
    page,
    pageCount,
    total: filtered.length,
  };
}

export function agentIsReady(agent: AgentSummary) {
  const enabled = agent.skills.filter((skill) => skill.enabled);
  return enabled.length > 0 && enabled.every((skill) => skill.available);
}
export const skillIsReady = (skill: RepositorySkillRecord) =>
  Boolean(skill.currentVersionId ?? skill.latestVersionId);

export function legacySkillsDestination(search: string, hash = '') {
  const params = new URLSearchParams(search);
  if (params.has('agentId') || params.has('skillId'))
    return `/agents?${params}${hash}`;
  const view = params.get('view');
  const listView = view === 'repository' || view === 'my-skills';
  if (
    !listView &&
    (params.has('skill') ||
      params.has('session') ||
      params.has('resultSession') ||
      (view && view !== 'home'))
  ) {
    return `/${search}${hash}`;
  }
  params.delete('view');
  const selectedSkill = params.get('skill')?.split(':');
  if (selectedSkill?.length === 2 && selectedSkill.every(Boolean)) {
    params.set('previewPackage', selectedSkill[0]);
    params.set('previewSkill', selectedSkill[1]);
  }
  params.delete('skill');
  if (params.has('q')) {
    params.set('skillsQuery', params.get('q') || '');
    params.delete('q');
  }
  params.set('tab', 'skills');
  return `/agents?${params}${hash}`;
}
