// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SkillVersionDetail } from '@educlaw/shared';
const api = vi.hoisted(() => ({ rollbackSkillVersion: vi.fn() }));
vi.mock('../../api/lite-api', () => ({ liteApi: api }));
import { SkillVersionWorkspace } from './SkillVersionWorkspace';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
const versions = [2, 1].map((n) => ({
  id: String(n),
  skillId: '11',
  packageId: '7',
  versionNumber: n,
  createdInPackageVersionId: String(n * 10),
  status: 'active',
  source: 'manual',
  skill: {
    id: 's',
    name: 'Skill',
    dirName: 's',
    description: '',
    skillMd: `v${n}`,
  },
  contentHash: `hash${n}`,
  note: '',
  basedOnVersionId: null,
  createdAt: '2026-10-16T00:00:00Z',
  discardedAt: null,
  discardedBy: null,
  discardReason: null,
  restoredAt: null,
  restoredBy: null,
})) as SkillVersionDetail[];
beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(extra: Record<string, unknown> = {}) {
  const props = {
    token: 't',
    packageId: '7',
    versions,
    currentVersionId: '2',
    currentPackageVersionId: '99',
    loading: false,
    onReload: vi.fn(),
    onVersionChanged: vi.fn(),
    ...extra,
  };
  await act(async () =>
    root.render(
      <SkillVersionWorkspace
        {...(props as ComponentProps<typeof SkillVersionWorkspace>)}
      />,
    ),
  );
}
async function click(text: string) {
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === text)!
      .click(),
  );
}
it('rolls back against the package head, not the Skill creation package', async () => {
  await render();
  await click('回退');
  await click('创建新版本并回退');
  expect(api.rollbackSkillVersion).toHaveBeenCalledWith(
    't',
    '7',
    expect.objectContaining({ expectedPackageVersionId: '99', versionId: '1' }),
  );
});
it('offers pagination even if all loaded versions are hidden as discarded', async () => {
  const load = vi.fn();
  await render({
    versions: versions.map((v) => ({ ...v, status: 'discarded' })),
    hasMore: true,
    onLoadMore: load,
  });
  expect(container.textContent).toContain('加载更多版本');
  await click('加载更多版本');
  expect(load).toHaveBeenCalledTimes(1);
});
it('retries an uncertain rollback with the same request identity', async () => {
  api.rollbackSkillVersion
    .mockRejectedValueOnce(new Error('connection lost'))
    .mockResolvedValueOnce({});
  await render();
  await click('回退');
  await click('创建新版本并回退');
  await click('创建新版本并回退');
  expect(api.rollbackSkillVersion.mock.calls[1][2]).toEqual(
    api.rollbackSkillVersion.mock.calls[0][2],
  );
});
it('provides an explicit refresh after a failed list request', async () => {
  const reload = vi.fn();
  await render({ versions: [], onReload: reload });
  expect(container.textContent).toContain('刷新版本');
  await click('刷新版本');
  expect(reload).toHaveBeenCalledOnce();
});
it('does not publish a late rollback completion into another Skill after unmount', async () => {
  let resolve!: (value: object) => void;
  const saved = new Promise<object>((r) => {
    resolve = r;
  });
  api.rollbackSkillVersion.mockReturnValueOnce(saved);
  const changed = vi.fn(),
    reload = vi.fn();
  await render({ onVersionChanged: changed, onReload: reload });
  await click('回退');
  await click('创建新版本并回退');
  await act(async () => root.render(null));
  await act(async () => resolve({}));
  expect(changed).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});
