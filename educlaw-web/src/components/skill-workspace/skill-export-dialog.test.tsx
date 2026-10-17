// @vitest-environment jsdom

import { act } from 'react';
import type { SkillVersionDetail } from '@educlaw/shared';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liteApi } from '../../api/lite-api';
import { SkillExportDialog } from './SkillExportDialog';
import type { RepositorySkill } from './SkillRepositoryWorkspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
});
