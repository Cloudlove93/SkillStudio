// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ list: vi.fn(), listConversations: vi.fn() }));
const lite = vi.hoisted(() => ({
  listRepositorySkills: vi.fn(),
  listPackageSkills: vi.fn(),
  listSkillVersions: vi.fn(),
  getSkillVersionDetail: vi.fn(),
  batchDeleteSkills: vi.fn(),
}));
vi.mock('../../api/agents', () => ({ agentsApi: api }));
vi.mock('../../api/lite-api', () => ({ liteApi: lite }));
vi.mock('../theme-toggle', () => ({ ThemeToggle: () => null }));
vi.mock('../agent-workspace/AgentWorkspacePanel', () => ({
  AgentWorkspacePanel: () => <div data-agent-panel />,
}));
vi.mock('../skill-workspace/SkillExportDialog', () => ({
  SkillExportDialog: () => null,
}));
import { AssetCenter } from './AssetCenter';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const skill = {
  id: '21',
  packageId: '8',
  name: '阅读方法',
  description: '分层阅读',
  packageName: '阅读助手',
  updatedAt: '2026-11-01T00:00:00Z',
  currentVersionId: '210',
  currentVersionNumber: 1,
  latestVersionId: '210',
  latestVersionNumber: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/agents');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  api.list.mockResolvedValue([
    {
      id: '1',
      name: '教学助手',
      description: '备课',
      instructions: '先问目标',
      model: 'model-one',
      currentVersion: '10',
      updatedAt: '2026-11-01T00:00:00Z',
      skills: [{ enabled: true, available: true }],
    },
  ]);
  api.listConversations.mockResolvedValue([]);
  lite.listRepositorySkills.mockResolvedValue({
    items: [skill],
    nextCursor: null,
  });
  lite.listSkillVersions.mockResolvedValue({
    items: [],
    currentVersionId: '210',
    currentPackageVersionId: '80',
    nextCursor: null,
  });
  lite.getSkillVersionDetail.mockResolvedValue({
    id: '210',
    skillId: '21',
    versionNumber: 1,
    skill: { skillMd: '# 教学方法' },
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
async function render() {
  await act(async () =>
    root.render(
      <BrowserRouter>
        <AssetCenter token="test-token" />
      </BrowserRouter>,
    ),
  );
}
async function click(text: string) {
  const button = [...container.querySelectorAll('button')].find(
    (item) =>
      item.textContent === text || item.getAttribute('aria-label') === text,
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
async function search(value: string) {
  const input =
    container.querySelector<HTMLInputElement>('input[type=search]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('uses shared cards and preserves each tab query across switching and reload', async () => {
  await render();
  expect(container.querySelectorAll('.asset-card')).toHaveLength(1);
  expect(container.textContent).toContain('model-one');
  await search('教学');
  await click('Skill');
  await search('阅读');
  await click('Agent');
  expect(
    container.querySelector<HTMLInputElement>('input[type=search]')!.value,
  ).toBe('教学');
  await click('Skill');
  expect(
    container.querySelector<HTMLInputElement>('input[type=search]')!.value,
  ).toBe('阅读');
  await act(async () => root.unmount());
  root = createRoot(container);
  await render();
  expect(
    container.querySelector<HTMLInputElement>('input[type=search]')!.value,
  ).toBe('阅读');
});
it('loads all repository pages before applying the shared search', async () => {
  lite.listRepositorySkills
    .mockResolvedValueOnce({ items: [], nextCursor: 'next' })
    .mockResolvedValueOnce({ items: [skill], nextCursor: null });
  window.history.replaceState({}, '', '/agents?tab=skills');
  await render();
  await search('阅读');
  expect(container.textContent).toContain('阅读方法');
  expect(lite.listRepositorySkills).toHaveBeenLastCalledWith('test-token', {
    limit: 100,
    cursor: 'next',
  });
});
it('allows keyboard tab switching and retains focus', async () => {
  await render();
  const tab = container.querySelector<HTMLButtonElement>('#assets-agents-tab')!;
  tab.focus();
  await act(async () =>
    tab.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    ),
  );
  expect(
    container
      .querySelector('#assets-skills-tab')
      ?.getAttribute('aria-selected'),
  ).toBe('true');
  expect(document.activeElement?.id).toBe('assets-skills-tab');
});

it('merges rapid search and filter changes without overwriting pending URL state', async () => {
  await render();
  await act(async () => {
    const input =
      container.querySelector<HTMLInputElement>('input[type=search]')!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, '教学');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const status = container.querySelector<HTMLSelectElement>(
      '[aria-label="资产状态"]',
    )!;
    status.value = 'ready';
    status.dispatchEvent(new Event('change', { bubbles: true }));
    const sort = container.querySelector<HTMLSelectElement>(
      '[aria-label="排序方式"]',
    )!;
    sort.value = 'name';
    sort.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const query = new URLSearchParams(window.location.search);
  expect(query.get('agentsQuery')).toBe('教学');
  expect(query.get('agentsFilter')).toBe('ready');
  expect(query.get('agentsSort')).toBe('name');
});
it('opens existing agent links without rendering a duplicate list', async () => {
  window.history.replaceState({}, '', '/agents?agentId=1&conversation=91');
  await render();
  expect(container.querySelector('[data-agent-panel]')).not.toBeNull();
  expect(container.querySelector('[aria-label="资产类型"]')).toBeNull();
  await click('返回资产中心');
  expect(container.querySelector('[data-agent-panel]')).toBeNull();
  expect(container.textContent).toContain('教学助手');
});
it('opens a copied Skill by its package even when repository deduplication hides it', async () => {
  window.history.replaceState(
    {},
    '',
    '/agents?tab=skills&previewSkill=99&previewPackage=9&skillVersion=991',
  );
  lite.listPackageSkills.mockResolvedValue([
    { ...skill, id: '99', packageId: '9', name: '关联副本' },
  ]);
  lite.getSkillVersionDetail.mockResolvedValue({
    id: '991',
    skillId: '99',
    versionNumber: 2,
    skill: { skillMd: '# 固定副本内容' },
  });
  await render();
  expect(container.textContent).toContain('关联副本');
  expect(container.textContent).toContain('# 固定副本内容');
  expect(lite.getSkillVersionDetail).toHaveBeenCalledWith(
    'test-token',
    '9',
    '991',
  );
});
it('shows fetch failures and supports retry without inventing an empty repository', async () => {
  api.list
    .mockRejectedValueOnce(new Error('暂时无法读取'))
    .mockResolvedValueOnce([]);
  await render();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    '暂时无法读取',
  );
  await click('重新加载');
  expect(container.textContent).toContain('暂无资产');
});

it('rejects a version belonging to a different Skill', async () => {
  window.history.replaceState(
    {},
    '',
    '/agents?tab=skills&previewSkill=21&skillVersion=999',
  );
  lite.getSkillVersionDetail.mockResolvedValue({
    skillId: '99',
    skill: { skillMd: 'other skill' },
  });
  await render();
  expect(container.querySelector('[role=alert]')?.textContent).toContain(
    '此版本不属于当前 Skill',
  );
  expect(container.textContent).not.toContain('other skill');
});

it('keeps a failed batch selection for retry and refreshes after deletion', async () => {
  window.history.replaceState({}, '', '/agents?tab=skills');
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  lite.batchDeleteSkills
    .mockRejectedValueOnce(new Error('暂时删除失败'))
    .mockResolvedValueOnce({ deletedCount: 1 });
  await render();
  await click('批量管理');
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.click(),
  );
  await click('删除所选');
  expect(container.textContent).toContain('暂时删除失败');
  expect(
    container.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked,
  ).toBe(true);
  lite.listRepositorySkills.mockResolvedValue({ items: [], nextCursor: null });
  await click('删除所选');
  expect(lite.batchDeleteSkills).toHaveBeenLastCalledWith('test-token', ['21']);
  expect(container.textContent).toContain('暂无资产');
});
