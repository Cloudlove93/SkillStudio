// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  listSkillVersions: vi.fn(),
  getSkillVersionDetail: vi.fn(),
}));
vi.mock('../../api/lite-api', () => ({ liteApi: api }));
import { useSkillVersions } from './use-skill-versions';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root,
  container: HTMLDivElement,
  result: ReturnType<typeof useSkillVersions>;
function Probe({ skillId }: { skillId: string }) {
  const value = useSkillVersions('token', '7', skillId);
  useEffect(() => {
    result = value;
  }, [value]);
  return <span>{value.versions.map((v) => v.id).join(',')}</span>;
}
function page(ids: string[], cursor: string | null = null, current = ids[0]) {
  return {
    items: ids.map((id) => ({
      id,
      skillId: '11',
      packageId: '7',
      status: 'active',
    })),
    nextCursor: cursor,
    currentVersionId: current,
    currentPackageVersionId: '99',
  };
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(skillId = '11') {
  await act(async () => root.render(<Probe skillId={skillId} />));
}
it('ignores an old Skill response after switching to another Skill', async () => {
  const old = deferred<ReturnType<typeof page>>();
  api.listSkillVersions
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(page(['B']));
  await render();
  await render('12');
  await act(async () => old.resolve(page(['A'])));
  expect(container.textContent).toBe('B');
  expect(result.loading).toBe(false);
});
it('ignores a retained reload callback from the previous Skill without invalidating the new request', async () => {
  const next = deferred<ReturnType<typeof page>>();
  api.listSkillVersions
    .mockResolvedValueOnce(page(['A']))
    .mockReturnValueOnce(next.promise)
    .mockResolvedValueOnce(page(['A']));
  await render();
  const staleReload = result.reload;
  await render('12');
  await act(async () => staleReload());
  await act(async () => next.resolve(page(['B'])));
  expect(container.textContent).toBe('B');
  expect(result.loading).toBe(false);
});
it('loads additional history and separately resolves a current version outside the page', async () => {
  api.listSkillVersions
    .mockResolvedValueOnce(page(['103', '102'], '102', '1'))
    .mockResolvedValueOnce(page(['101'], null, '1'));
  api.getSkillVersionDetail.mockResolvedValue({
    id: '1',
    skillId: '11',
    packageId: '7',
    status: 'active',
  });
  await render();
  expect(result.versions.map((v) => v.id)).toContain('1');
  await act(async () => result.loadMore());
  expect(result.versions.map((v) => v.id)).toEqual(['103', '102', '1', '101']);
  expect(api.listSkillVersions).toHaveBeenLastCalledWith(
    'token',
    '7',
    '11',
    expect.objectContaining({ cursor: '102' }),
  );
  expect(result.currentPackageVersionId).toBe('99');
  expect(result.hasMore).toBe(false);
});
it('does not merge an old pagination response into a reloaded list', async () => {
  const old = deferred<ReturnType<typeof page>>();
  api.listSkillVersions
    .mockResolvedValueOnce(page(['3'], '3'))
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(page(['4']));
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.loadMore();
  });
  await act(async () => result.reload());
  await act(async () => {
    old.resolve(page(['2']));
    await pending;
  });
  expect(result.versions.map((v) => v.id)).toEqual(['4']);
});
