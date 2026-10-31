// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SkillVersionDetail } from '@educlaw/shared';
const api = vi.hoisted(() => ({
  rollbackSkillVersion: vi.fn(),
  createManualSkillVersion: vi.fn(),
  getSkillVersionDetail: vi.fn(),
}));
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
    onBackToRepository: vi.fn(),
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
    Array.from(document.body.querySelectorAll('button'))
      .find((b) => b.textContent?.trim() === text)!
      .click(),
  );
}
function validSkillMd(marker: string) {
  return `---\nname: s\ndescription: 用于课堂教学任务的规则\n---\n# Skill\n## Instructions\n${marker} ${'具体规则。'.repeat(30)}\n## Workflow\n1. 分析\n2. 回答\n## Output Format\n给出结构化答案。\n## Examples\n示例回答。\n## Common Issues\n避免遗漏。`;
}

function buttonInVersionRow(versionNumber: number, label: string) {
  const row = Array.from(container.querySelectorAll('article')).find((item) =>
    item.textContent?.includes(`v${versionNumber}`),
  );
  return Array.from(row?.querySelectorAll('button') ?? []).find(
    (button) => button.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

it('lets every version become the fixed comparison base', async () => {
  await render();

  expect(buttonInVersionRow(2, '对比')).toBeDefined();
  expect(buttonInVersionRow(1, '对比')).toBeDefined();

  await act(async () => buttonInVersionRow(2, '对比')?.click());
  expect(
    container.querySelector('.skill-version-compare-picker > strong')?.textContent,
  ).toBe('v2');
  expect(container.querySelector('select')?.value).toBe('1');
  expect(container.querySelector('option[value="2"]')).toBeNull();
});

it('switches the comparison target without changing the selected base', async () => {
  const third = {
    ...versions[0],
    id: '3',
    versionNumber: 3,
    skill: { ...versions[0].skill, skillMd: 'v3 target content' },
  };
  await render({ versions: [third, ...versions] });
  await act(async () => buttonInVersionRow(2, '对比')?.click());

  const select = container.querySelector<HTMLSelectElement>(
    'select[aria-label="选择对比版本"]',
  )!;
  expect(select.value).toBe('1');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set;
    setter?.call(select, '3');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(
    container.querySelector('.skill-version-compare-picker > strong')?.textContent,
  ).toBe('v2');
  expect(select.value).toBe('3');
  expect(container.textContent).toContain('v3');
  expect(container.textContent).toContain('target content');
});

it('disables comparison when only one valid version exists', async () => {
  await render({ versions: [versions[0]] });
  const compareButton = buttonInVersionRow(2, '对比');
  expect(compareButton?.disabled).toBe(true);
  expect(compareButton?.title).toContain('至少需要两个版本');
});

it('returns directly to the Skill repository without relying on browser history', async () => {
  const onBackToRepository = vi.fn();
  await render({ onBackToRepository });
  await click('返回 Skill 仓库');
  expect(onBackToRepository).toHaveBeenCalledOnce();
});
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

it('opens the fixed SKILL.md snapshot and saves edits as a new version', async () => {
  const base = {
    ...versions[0],
    skill: { ...versions[0].skill, skillMd: validSkillMd('原版本') },
  };
  const created = {
    ...base,
    id: '3',
    versionNumber: 3,
    basedOnVersionId: '2',
    skill: { ...base.skill, skillMd: validSkillMd('新版本') },
  };
  api.createManualSkillVersion.mockResolvedValueOnce({
    packageId: '7',
    packageVersionId: '100',
    packageVersionNumber: 100,
    skillVersionId: '3',
    skillVersionNumber: 3,
    basedOnVersionId: '2',
  });
  api.getSkillVersionDetail.mockResolvedValueOnce(created);
  const reload = vi.fn().mockResolvedValue(undefined);
  const changed = vi.fn();
  await render({
    versions: [base, versions[1]],
    onReload: reload,
    onVersionChanged: changed,
  });
  await click('预览');

  const dialog = document.body.querySelector('[role="dialog"]');
  expect(dialog?.parentElement).toBe(document.body);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(dialog?.textContent).toContain('Skill · v2');
  expect(dialog?.textContent).toContain('当前只展示此固定版本真实保存的 SKILL.md');
  await click('编辑 SKILL.md');
  const editor = document.body.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="SKILL.md 源码"]',
  )!;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(editor, validSkillMd('新版本'));
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('保存为新版本');
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(api.createManualSkillVersion).toHaveBeenCalledWith(
    't',
    '7',
    expect.objectContaining({
      skillId: '11',
      baseVersionId: '2',
      expectedPackageVersionId: '99',
      skillMd: validSkillMd('新版本'),
    }),
  );
  expect(reload).toHaveBeenCalledOnce();
  expect(changed).toHaveBeenCalledWith(expect.stringContaining('v3'));
  expect(base.skill.skillMd).toBe(validSkillMd('原版本'));
  expect(document.body.textContent).toContain('Skill · v3');
});

it('keeps the edited draft visible when creating a new version fails', async () => {
  const base = {
    ...versions[0],
    skill: { ...versions[0].skill, skillMd: validSkillMd('原版本') },
  };
  api.createManualSkillVersion.mockRejectedValueOnce(
    new Error('Package has changed. Refresh before retrying.'),
  );
  await render({ versions: [base, versions[1]] });
  await click('预览');
  await click('编辑 SKILL.md');
  const editor = document.body.querySelector<HTMLTextAreaElement>(
    'textarea[aria-label="SKILL.md 源码"]',
  )!;
  const next = validSkillMd('保留草稿');
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  await act(async () => {
    setter?.call(editor, next);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click('保存为新版本');
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
    'Package has changed',
  );
  expect(editor.value).toBe(next);
});
