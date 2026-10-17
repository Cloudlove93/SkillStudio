// @vitest-environment jsdom

import { act } from 'react';
import type {
  SkillVersionDetail,
  SkillVersionListResult,
} from '@educlaw/shared';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liteApi } from '../../api/lite-api';
import { SkillExportDialog } from './SkillExportDialog';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const skill: RepositorySkill = {
  key: '3:12',
  packageId: '3',
  skillId: '12',
  name: '函数教学',
  description: '描述',
  updatedAt: '2026-10-16T00:00:00.000Z',
  latestVersionId: '82',
  latestVersionNumber: 2,
  currentVersionId: '82',
  currentVersionNumber: 2,
};

function version(id: string, versionNumber: number): SkillVersionDetail {
  return {
    id,
    skillId: '12',
    packageId: '3',
    createdInPackageVersionId: String(60 + versionNumber),
    versionNumber,
    source: versionNumber === 1 ? 'generated' : 'interactive',
    basedOnVersionId: versionNumber === 1 ? null : '81',
    skill: {
      id: 'stable-skill',
      dirName: 'math-skill',
      name: '函数教学',
      description: '描述',
      skillMd: `# Version ${versionNumber}`,
    },
    contentHash: `hash-${versionNumber}`,
    status: 'active',
    note: `版本 ${versionNumber}`,
    createdAt: '2026-10-16T00:00:00.000Z',
    discardedAt: null,
    discardedBy: null,
    discardReason: null,
    restoredAt: null,
    restoredBy: null,
  };
}

describe('Skill export dialog', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
  });

  it('isolates a reopened dialog from a previous pending export and prevents duplicate clicks', async () => {
    vi.spyOn(liteApi, 'listSkillVersions').mockResolvedValue({
      items: [version('82', 2)],
      nextCursor: null,
      currentVersionId: '82',
      currentPackageVersionId: '62',
    });
    let resolveExport!: (value: string) => void;
    const download = vi.spyOn(liteApi, 'exportSkillVersion').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const onClose = vi.fn();
    const render = async (value: RepositorySkill | null) =>
      act(async () =>
        root.render(
          <SkillExportDialog token="token" skill={value} onClose={onClose} />,
        ),
      );
    await render(skill);
    const exportButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('导出所选版本'),
    )!;
    await act(async () => {
      exportButton.click();
      exportButton.click();
    });
    expect(download).toHaveBeenCalledTimes(1);
    await render(null);
    await render(skill);
    expect(container.textContent).not.toContain('正在导出…');
    await act(async () => resolveExport('old.zip'));
    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('does not describe active versions as published and excludes discarded versions', async () => {
    const active = { ...version('81', 1), note: '' };
    vi.spyOn(liteApi, 'listSkillVersions').mockResolvedValue({
      items: [{ ...version('82', 2), status: 'discarded' }, active],
      nextCursor: null,
      currentVersionId: '81',
      currentPackageVersionId: '62',
    });
    await act(async () =>
      root.render(
        <SkillExportDialog token="token" skill={skill} onClose={() => {}} />,
      ),
    );
    expect(container.querySelectorAll('input[type="radio"]')).toHaveLength(1);
    expect(container.textContent).not.toContain('已发布');
    expect(container.textContent).toContain('正常版本');
  });

  it('defaults to the latest version and can export an explicitly selected v1', async () => {
    vi.spyOn(liteApi, 'listSkillVersions').mockResolvedValue({
      items: [version('82', 2), version('81', 1)],
      nextCursor: null,
      currentVersionId: '82',
      currentPackageVersionId: '62',
    });
    const exportVersion = vi
      .spyOn(liteApi, 'exportSkillVersion')
      .mockResolvedValue('math-skill-v1.zip');
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <SkillExportDialog token="token" skill={skill} onClose={onClose} />,
      );
    });
    await act(async () => Promise.resolve());

    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[name="skill-export-version"]',
    );
    expect(radios).toHaveLength(2);
    expect(radios[0]?.value).toBe('82');
    expect(radios[0]?.checked).toBe(true);

    await act(async () => radios[1]?.click());
    const exportButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('导出所选版本'),
    );
    await act(async () => exportButton?.click());

    expect(exportVersion).toHaveBeenCalledWith(
      'token',
      '3',
      '12',
      '81',
      'skill-v1.zip',
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open with a useful error when download fails', async () => {
    vi.spyOn(liteApi, 'listSkillVersions').mockResolvedValue({
      items: [version('82', 2)],
      nextCursor: null,
      currentVersionId: '82',
      currentPackageVersionId: '62',
    });
    vi.spyOn(liteApi, 'exportSkillVersion').mockRejectedValue(
      new Error('没有权限导出该版本'),
    );
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <SkillExportDialog token="token" skill={skill} onClose={onClose} />,
      );
    });
    await act(async () => Promise.resolve());
    const exportButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('导出所选版本'),
    );
    await act(async () => exportButton?.click());

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '没有权限导出该版本',
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('disables export while loading and retries a failed download without a stale error', async () => {
    let finishList!: (value: SkillVersionListResult) => void;
    vi.spyOn(liteApi, 'listSkillVersions').mockImplementation(
      () =>
        new Promise<SkillVersionListResult>((resolve) => {
          finishList = resolve;
        }) as ReturnType<typeof liteApi.listSkillVersions>,
    );
    vi.spyOn(liteApi, 'exportSkillVersion')
      .mockRejectedValueOnce(new Error('该版本已废弃，请先恢复再导出'))
      .mockResolvedValueOnce('s-v2.zip');
    const onClose = vi.fn();
    await act(async () =>
      root.render(
        <SkillExportDialog token="token" skill={skill} onClose={onClose} />,
      ),
    );
    const exportButton = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('导出所选版本'),
    )!;
    expect(exportButton.disabled).toBe(true);
    await act(async () =>
      finishList({
        items: [version('82', 2)],
        nextCursor: null,
        currentVersionId: '82',
        currentPackageVersionId: '62',
      }),
    );
    await act(async () => exportButton.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '先恢复再导出',
    );
    expect(exportButton.disabled).toBe(false);
    await act(async () => exportButton.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores a closed session list response after another Skill is opened', async () => {
    let finishOld!: (value: SkillVersionListResult) => void;
    vi.spyOn(liteApi, 'listSkillVersions')
      .mockImplementationOnce(
        () =>
          new Promise<SkillVersionListResult>((resolve) => {
            finishOld = resolve;
          }) as ReturnType<typeof liteApi.listSkillVersions>,
      )
      .mockResolvedValueOnce({
        items: [version('91', 9)],
        nextCursor: null,
        currentVersionId: '91',
        currentPackageVersionId: '69',
      });
    const render = async (value: RepositorySkill | null) =>
      act(async () =>
        root.render(
          <SkillExportDialog token="token" skill={value} onClose={() => {}} />,
        ),
      );
    await render(skill);
    await render(null);
    await render({ ...skill, key: '4:13', packageId: '4', skillId: '13' });
    await act(async () =>
      finishOld({
        items: [version('81', 1)],
        nextCursor: null,
        currentVersionId: '81',
        currentPackageVersionId: '61',
      }),
    );
    expect(
      container.querySelector<HTMLInputElement>('input[type="radio"]')?.value,
    ).toBe('91');
  });

  it('loads a fresh version list after closing a failed list request', async () => {
    vi.spyOn(liteApi, 'listSkillVersions')
      .mockRejectedValueOnce(new Error('版本列表暂时不可用'))
      .mockResolvedValueOnce({
        items: [version('82', 2)],
        currentVersionId: '82',
        currentPackageVersionId: '62',
        nextCursor: null,
      });
    const render = async (value: RepositorySkill | null) =>
      act(async () =>
        root.render(
          <SkillExportDialog token="token" skill={value} onClose={() => {}} />,
        ),
      );
    await render(skill);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '版本列表暂时不可用',
    );
    await render(null);
    await render(skill);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[type="radio"]')?.checked,
    ).toBe(true);
  });

  it('focuses the modal, traps Tab, supports Escape and restores the opener focus', async () => {
    vi.spyOn(liteApi, 'listSkillVersions').mockResolvedValue({
      items: [version('82', 2)],
      nextCursor: null,
      currentVersionId: '82',
      currentPackageVersionId: '62',
    });
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const close = vi.fn();
    await act(async () =>
      root.render(
        <SkillExportDialog token="token" skill={skill} onClose={close} />,
      ),
    );
    const dialog = container.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(document.activeElement).toBe(dialog);
    const last = [...dialog.querySelectorAll('button')].at(-1)!;
    last.focus();
    await act(async () =>
      last.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(dialog.querySelector('input'));
    await act(async () =>
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      ),
    );
    expect(close).toHaveBeenCalledTimes(1);
    await act(async () =>
      root.render(
        <SkillExportDialog token="token" skill={null} onClose={close} />,
      ),
    );
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });
});
