// @vitest-environment jsdom

import { act } from 'react';
import type { GuidedCreationSession } from '@educlaw/shared';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillRepositoryWorkspace, type RepositorySkill } from './SkillRepositoryWorkspace';
import { WorkspaceInspectorProvider } from './WorkspaceInspectorProvider';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const skills: RepositorySkill[] = [
  {
    key: 'package-1:skill-1',
    packageId: 'package-1',
    skillId: 'skill-1',
    name: '函数概念教学',
    description: '用定义、辨析和示例组织高等数学函数概念课。',
    updatedAt: '2026-08-26T08:00:00.000Z',
  },
  {
    key: 'package-1:skill-2',
    packageId: 'package-1',
    skillId: 'skill-2',
    name: '分段函数分析',
    description: '围绕区间、边界与图像建立分段函数分析框架。',
    updatedAt: '2026-08-25T08:00:00.000Z',
  },
];

const draftSession: GuidedCreationSession = {
  id: 'draft-1',
  display_name: '函数课程教学设计',
  deleted_at: null,
  status: 'collecting',
  model: null,
  documents: [],
  draft: { goal: '组织一节函数概念课' },
  field_states: {
    roles: 'missing',
    goal: 'explicit',
    usage_scenario: 'missing',
    input_contract: 'missing',
    output_contract: 'missing',
    core_capabilities: 'missing',
    workflow: 'missing',
    knowledge_evidence: 'missing',
    boundaries_permissions: 'missing',
    exception_recovery: 'missing',
    completion_evidence: 'missing',
  },
  flow_version: 1,
  confirmed_stages: [],
  next_stage: 'positioning',
  confirmation: null,
  revision_no: 1,
  package_id: null,
  skill_id: null,
  skill_version_id: null,
  error: null,
  created_at: '2026-08-25T08:00:00.000Z',
  updated_at: '2026-08-26T08:00:00.000Z',
  completed_at: null,
};

describe('Skill repository cards', () => {
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

  async function renderRepository({
    onSelectSkill = vi.fn(),
    sessions = [],
    onSelectDraft = vi.fn(),
    onRenameSkill = vi.fn().mockResolvedValue(undefined),
  }: {
    onSelectSkill?: ReturnType<typeof vi.fn>;
    sessions?: GuidedCreationSession[];
    onSelectDraft?: ReturnType<typeof vi.fn>;
    onRenameSkill?: ReturnType<typeof vi.fn>;
  } = {}) {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={['/skills']}>
          <WorkspaceInspectorProvider>
            <SkillRepositoryWorkspace
              skills={skills}
              sessions={sessions}
              search=""
              onSearch={vi.fn()}
              onSelectSkill={onSelectSkill}
              onSelectDraft={onSelectDraft}
              onDeleteSkills={vi.fn().mockResolvedValue(undefined)}
              onNew={vi.fn()}
              {...({ onRenameSkill } as Record<string, unknown>)}
            />
          </WorkspaceInspectorProvider>
        </MemoryRouter>,
      );
    });
    return { onSelectSkill, onSelectDraft, onRenameSkill };
  }

  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('presents created Skills as a semantic card collection', async () => {
    await renderRepository();

    const collection = container.querySelector(
      '[role="list"][aria-label="已创建的 Skill"]',
    );
    const cards = collection?.querySelectorAll('article');

    expect(collection).not.toBeNull();
    expect(cards).toHaveLength(2);
    expect(cards?.[0].textContent).toContain('函数概念教学');
    expect(cards?.[0].textContent).toContain(
      '用定义、辨析和示例组织高等数学函数概念课。',
    );
  });

  it('opens a Skill from its card action', async () => {
    const { onSelectSkill } = await renderRepository();
    const openButton = [...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === '打开函数概念教学',
    );

    expect(openButton).toBeDefined();
    await act(async () => openButton?.click());
    expect(onSelectSkill).toHaveBeenCalledWith(skills[0]);
  });

  it('renames a Skill from its card menu and closes after saving', async () => {
    const onRenameSkill = vi.fn().mockResolvedValue(undefined);
    await renderRepository({ onRenameSkill });

    const menuButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="函数概念教学操作"]',
    );
    await act(async () => menuButton?.click());
    const renameButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('重命名 Skill'),
    );
    await act(async () => renameButton?.click());

    const dialog = container.querySelector('[role="dialog"][aria-label="重命名 Skill"]');
    const input = dialog?.querySelector<HTMLInputElement>(
      'input[name="skill-display-name"]',
    );
    expect(dialog).not.toBeNull();
    expect(input?.value).toBe('函数概念教学');

    await act(async () => setInputValue(input!, '函数概念辨析'));
    const saveButton = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (button) => button.textContent?.includes('保存名称'),
    );
    await act(async () => saveButton?.click());

    expect(onRenameSkill).toHaveBeenCalledWith(
      skills[0],
      '函数概念辨析',
    );
    expect(
      container.querySelector('[role="dialog"][aria-label="重命名 Skill"]'),
    ).toBeNull();
  });

  it('keeps the rename dialog open and explains a save failure', async () => {
    const onRenameSkill = vi
      .fn()
      .mockRejectedValue(new Error('名称保存失败，请稍后重试'));
    await renderRepository({ onRenameSkill });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="函数概念教学操作"]')
        ?.click();
    });
    const renameButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('重命名 Skill'),
    );
    await act(async () => renameButton?.click());
    const input = container.querySelector<HTMLInputElement>(
      'input[name="skill-display-name"]',
    );
    await act(async () => setInputValue(input!, '函数名称修订'));
    const saveButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('保存名称'),
    );
    await act(async () => saveButton?.click());

    expect(
      container.querySelector('[role="dialog"][aria-label="重命名 Skill"]'),
    ).not.toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      '名称保存失败，请稍后重试',
    );
  });

  it('prevents duplicate rename requests while a save is pending', async () => {
    let releaseSave!: () => void;
    const savePending = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const onRenameSkill = vi.fn().mockReturnValue(savePending);
    await renderRepository({ onRenameSkill });

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="函数概念教学操作"]')
        ?.click();
    });
    const renameButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('重命名 Skill'),
    );
    await act(async () => renameButton?.click());
    const input = container.querySelector<HTMLInputElement>(
      'input[name="skill-display-name"]',
    );
    await act(async () => setInputValue(input!, '函数概念辨析'));
    const form = container.querySelector<HTMLFormElement>(
      '[role="dialog"][aria-label="重命名 Skill"]',
    );

    await act(async () => {
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });

    expect(onRenameSkill).toHaveBeenCalledTimes(1);
    expect(form?.textContent).toContain('正在保存…');

    await act(async () => releaseSave());
    expect(
      container.querySelector('[role="dialog"][aria-label="重命名 Skill"]'),
    ).toBeNull();
  });

  it('selects cards directly while batch management is active', async () => {
    await renderRepository();
    const manageButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.includes('批量管理'),
    );

    await act(async () => manageButton?.click());
    const selectionButton = [...container.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === '选择函数概念教学',
    );
    const checkbox = container.querySelector<HTMLInputElement>(
      'input[value="skill-1"]',
    );

    expect(selectionButton).toBeDefined();
    expect(checkbox?.checked).toBe(false);
    expect(selectionButton?.textContent).toContain('选择');
    expect(selectionButton?.textContent).not.toContain('打开');
    await act(async () => selectionButton?.click());
    expect(checkbox?.checked).toBe(true);
    expect(selectionButton?.textContent).toContain('已选择');
  });

  it('presents unfinished sessions as cards that resume editing', async () => {
    const onSelectDraft = vi.fn();
    await renderRepository({ sessions: [draftSession], onSelectDraft });
    const draftsTab = [...container.querySelectorAll('[role="tab"]')].find(
      (tab) => tab.textContent?.includes('未完成草稿'),
    ) as HTMLButtonElement | undefined;

    await act(async () => draftsTab?.click());
    const collection = container.querySelector(
      '[role="list"][aria-label="未完成草稿"]',
    );
    const resumeButton = [...container.querySelectorAll('button')].find(
      (button) =>
        button.getAttribute('aria-label') === '继续编辑函数课程教学设计',
    );

    expect(collection?.querySelectorAll('article')).toHaveLength(1);
    expect(resumeButton).toBeDefined();
    await act(async () => resumeButton?.click());
    expect(onSelectDraft).toHaveBeenCalledWith(draftSession);
  });
});
