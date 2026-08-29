// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillWorkspaceSidebar } from './SkillWorkspaceSidebar';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const skill = {
  key: '7:11',
  packageId: '7',
  skillId: '11',
  name: '函数概念教学',
  description: '函数概念课',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

describe('Skill workspace sidebar actions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('offers Skill rename from the workspace item menu', async () => {
    const onSkillAction = vi.fn();
    await act(async () => {
      root.render(
        <SkillWorkspaceSidebar
          sessions={[]}
          selectedSessionId={null}
          repositoryActive={false}
          selectedCreateMode="conversation"
          collapsed={false}
          search=""
          userName="教师"
          onSearch={vi.fn()}
          onToggle={vi.fn()}
          onRepository={vi.fn()}
          onCreateMode={vi.fn()}
          onSelect={vi.fn()}
          skills={[skill]}
          allRepositorySkills={[skill]}
          activeSkillKey={skill.key}
          activeSkillName={skill.name}
          onSelectSkill={vi.fn()}
          onSkillAction={onSkillAction}
          onRename={vi.fn().mockResolvedValue(undefined)}
          onDelete={vi.fn().mockResolvedValue(undefined)}
          onLogout={vi.fn()}
        />,
      );
    });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(
          '[aria-label="函数概念教学 更多操作"]',
        )
        ?.click();
    });
    const rename = [...container.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.includes('重命名'),
    ) as HTMLButtonElement | undefined;

    expect(rename).toBeDefined();
    await act(async () => rename?.click());
    expect(onSkillAction).toHaveBeenCalledWith(skill, 'rename');
  });
});
