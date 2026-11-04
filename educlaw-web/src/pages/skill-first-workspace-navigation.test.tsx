// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listRepositorySkills: vi.fn(),
  listGuidedCreations: vi.fn(),
  getGuidedCreationDetail: vi.fn(),
  listThreadPage: vi.fn(),
  listSkillVersions: vi.fn(),
  recoverArenaRun: vi.fn(),
  getArenaThreadDetail: vi.fn(),
  rollbackSkillVersion: vi.fn(),
  discardSkillVersion: vi.fn(),
  undiscardSkillVersion: vi.fn(),
  createArenaThread: vi.fn(),
  diagnosePackage: vi.fn(),
  renameArenaThread: vi.fn(),
  chatOptimize: vi.fn(),
  applyInteractiveChanges: vi.fn(),
}));
vi.mock('../api/lite-api', () => ({ liteApi: api }));
vi.mock('../stores/auth', () => ({
  useAuthStore: (select: (state: object) => unknown) =>
    select({
      token: 'test-token',
      user: { username: 'owner' },
      logout: () => {},
    }),
}));
import SkillFirstWorkspace from './SkillFirstWorkspace';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const threads = [91, 92].map((id) => ({
  id,
  packageId: 7,
  title: `Conversation ${id}`,
  arenaKind: 'skill_arena',
  createdAt: '2026-10-16T00:00:00Z',
  updatedAt: '2026-10-16T00:00:00Z',
  skillArenaConfig: {
    surface: 'run',
    left: { skillId: '11', skillVersionId: '1' },
    right: { skillId: '11', skillVersionId: '1' },
  },
}));
const version = {
  id: '1',
  skillId: '11',
  packageId: '7',
  versionNumber: 1,
  createdInPackageVersionId: '10',
  status: 'active',
  source: 'manual',
  skill: {
    id: 's',
    dirName: 's',
    name: 'Fixture',
    description: '',
    skillMd: 'Fixture',
  },
  createdAt: '2026-10-16T00:00:00Z',
};
const unfinishedGuidedDraft = {
  id: 'guided-draft-1',
  display_name: '课堂教学设计',
  deleted_at: null,
  status: 'ready_for_confirmation',
  model: null,
  documents: [],
  draft: {},
  field_states: {},
  education_draft: {
    educational_goal: {
      content: '创建课堂教学设计 Skill',
      evidence: [{ source: 'user_explicit' }],
    },
  },
  flow_version: 3,
  confirmed_stages: [],
  next_stage: null,
  completed_steps: ['intent_context'],
  current_step: 'teacher_experience',
  confirmation: {
    title: '确认内容',
    sections: [
      {
        key: 'educational_goal',
        title: '教育目标',
        content: '创建课堂教学设计 Skill',
      },
    ],
  },
  revision_no: 3,
  package_id: null,
  skill_id: null,
  skill_version_id: null,
  error: null,
  created_at: '2026-10-16T00:00:00Z',
  updated_at: '2026-10-16T00:00:00Z',
  completed_at: null,
  messages: [],
};
let root: Root;
let container: HTMLDivElement;
function RouteEvidence() {
  return <output data-route>{useLocation().search}</output>;
}
function button(label: string) {
  return [...container.querySelectorAll('button')].find(
    (item) =>
      item.textContent?.replace(/\s+/g, '') === label.replace(/\s+/g, ''),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem('educlaw:workspace-skills', JSON.stringify(['7:11']));
  api.listRepositorySkills.mockResolvedValue({
    items: [
      {
        id: '11',
        packageId: '7',
        name: 'Fixture',
        description: '',
        updatedAt: '2026-10-16T00:00:00Z',
      },
    ],
    nextCursor: null,
  });
  api.listGuidedCreations.mockResolvedValue({ items: [] });
  api.getGuidedCreationDetail.mockResolvedValue(unfinishedGuidedDraft);
  api.listThreadPage.mockResolvedValue({ items: threads, nextCursor: null });
  api.listSkillVersions.mockResolvedValue({
    items: [version],
    currentVersionId: '1',
    currentPackageVersionId: '99',
    nextCursor: null,
  });
  api.getArenaThreadDetail.mockImplementation(
    async (_token, _packageId, id) => ({
      thread: threads.find((t) => String(t.id) === id),
      messages: [],
      answerOptimizations: [],
    }),
  );
  api.recoverArenaRun.mockImplementation(async (_token, id) => ({
    run: null,
    detail: {
      thread: threads.find((t) => String(t.id) === id),
      messages: [],
      answerOptimizations: [],
    },
  }));
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function draftButton() {
  return container.querySelector<HTMLButtonElement>('.skill-session-item');
}

async function configureUnfinishedDraft() {
  api.listGuidedCreations.mockResolvedValue({
    items: [unfinishedGuidedDraft],
  });
  api.getGuidedCreationDetail.mockResolvedValue(unfinishedGuidedDraft);
  await Promise.all([
    import('../components/skill-workspace/GuidedSkillCreationPanel'),
    import('../components/skill-workspace/SkillInspectorContent'),
  ]);
}

it.each(['/?view=create', '/?view=run&skill=7%3A11&conversation=91'])(
  'resumes an unfinished guided draft with one click from %s',
  async (initialEntry) => {
    await configureUnfinishedDraft();
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={[initialEntry]}>
          <SkillFirstWorkspace />
          <RouteEvidence />
        </MemoryRouter>,
      ),
    );

    await vi.waitFor(async () => {
      await act(async () => {});
      expect(draftButton()).not.toBeNull();
    });

    await act(async () => draftButton()!.click());

    await vi.waitFor(async () => {
      await act(async () => {});
      expect(api.getGuidedCreationDetail).toHaveBeenCalledWith('test-token', {
        session_id: unfinishedGuidedDraft.id,
      });
      expect(container.textContent).toContain('确认这个 Skill 的工作方式');
      const params = new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      );
      expect(params.get('view')).toBe('create');
    });
  },
);

it('resumes an unfinished guided draft after switching to another Skill conversation', async () => {
  await configureUnfinishedDraft();
  await Promise.all([
    import('../components/skill-workspace/SkillDetailWorkspace'),
    import('../components/skill-workspace/SkillVersionWorkspace'),
    import('../components/skill-workspace/SkillRunWorkspace'),
  ]);
  await act(async () =>
    root.render(
      <MemoryRouter
        initialEntries={['/?view=run&skill=7%3A11&conversation=91']}
      >
        <SkillFirstWorkspace />
        <RouteEvidence />
      </MemoryRouter>,
    ),
  );

  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button('使用 Conversation 92')).toBeDefined();
    expect(draftButton()).not.toBeNull();
  });

  await act(async () => button('使用 Conversation 92')!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      ).get('conversation'),
    ).toBe('92');
  });

  await act(async () => draftButton()!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('确认这个 Skill 的工作方式');
    expect(
      new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      ).get('view'),
    ).toBe('create');
  });
});

it('resumes an unfinished guided draft after entering a Skill conversation from the home view', async () => {
  await configureUnfinishedDraft();
  await Promise.all([
    import('../components/skill-workspace/SkillDetailWorkspace'),
    import('../components/skill-workspace/SkillVersionWorkspace'),
    import('../components/skill-workspace/SkillRunWorkspace'),
  ]);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/?view=create']}>
        <SkillFirstWorkspace />
        <RouteEvidence />
      </MemoryRouter>,
    ),
  );

  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button('Fixture')).toBeDefined();
    expect(draftButton()).not.toBeNull();
  });

  await act(async () => button('Fixture')!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      ).get('view'),
    ).toBe('run');
    expect(button('使用 Conversation 92')).toBeDefined();
  });
  await act(async () => button('使用 Conversation 92')!.click());

  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      ).get('conversation'),
    ).toBe('92');
  });

  await act(async () => draftButton()!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('确认这个 Skill 的工作方式');
    expect(
      new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      ).get('view'),
    ).toBe('create');
  });
});

it('resumes an unfinished guided draft after opening the Skill repository', async () => {
  await configureUnfinishedDraft();
  await import('../components/skill-workspace/SkillRepositoryWorkspace');
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/?view=create']}>
        <SkillFirstWorkspace />
        <RouteEvidence />
      </MemoryRouter>,
    ),
  );

  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button('技能库')).toBeDefined();
  });
  await act(async () => button('技能库')!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      ).get('view'),
    ).toBe('my-skills');
    expect(draftButton()).not.toBeNull();
  });

  await act(async () => draftButton()!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('确认这个 Skill 的工作方式');
    expect(
      new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      ).get('view'),
    ).toBe('create');
  });
});

it.each(['run', 'test'] as const)(
  'opens a %s conversation from versions without stale synchronization restoring the previous view and inspector',
  async (surface) => {
    threads[1].skillArenaConfig.surface = surface;
    const selectedLabel = `使用 Conversation 92`;
    await Promise.all([
      import('../components/skill-workspace/SkillDetailWorkspace'),
      import('../components/skill-workspace/SkillVersionWorkspace'),
      import('../components/skill-workspace/SkillRunWorkspace'),
    ]);
    await act(async () =>
      root.render(
        <MemoryRouter
          initialEntries={[
            '/?view=versions&skill=7%3A11&conversation=91&inspector=guided%3Asummary',
          ]}
        >
          <SkillFirstWorkspace />
          <RouteEvidence />
        </MemoryRouter>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(button(selectedLabel)).toBeDefined();
    });
    await act(async () => button(selectedLabel)!.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      const params = new URLSearchParams(
        container.querySelector('[data-route]')!.textContent!,
      );
      expect(params.get('view')).toBe('run');
      expect(params.get('conversation')).toBe('92');
      expect(params.has('inspector')).toBe(false);
      expect(
        container.querySelector('textarea[aria-label="输入 Skill 使用任务"]'),
      ).not.toBeNull();
    });
  },
);

it('refreshes the repository summary after saving through the actual optimization workspace', async () => {
  let head = 1;
  api.listRepositorySkills.mockImplementation(async () => ({
    items: [
      {
        id: '11',
        packageId: '7',
        name: 'Fixture',
        updatedAt: version.createdAt,
        latestVersionId: String(head),
        latestVersionNumber: head,
      },
    ],
    nextCursor: null,
  }));
  api.listSkillVersions.mockImplementation(async () => ({
    items: [{ ...version, id: String(head), versionNumber: head }],
    currentVersionId: String(head),
    currentPackageVersionId: '99',
    nextCursor: null,
  }));
  api.createArenaThread.mockResolvedValue({ id: 93 });
  api.diagnosePackage.mockResolvedValue({
    issues: [],
    session: { id: 'session-1' },
  });
  api.renameArenaThread.mockResolvedValue({ id: 93 });
  api.chatOptimize.mockResolvedValue({
    reply: '',
    newAdoptions: [
      {
        id: 'change',
        target: 'skill',
        targetId: 's',
        targetName: 'Fixture',
        original: 'Fixture',
        modified: 'Updated',
        reason: '补充可执行的处理步骤',
      },
    ],
  });
  api.applyInteractiveChanges.mockImplementation(async () => {
    head = 2;
    return { versionNumber: 2 };
  });
  await Promise.all([
    import('../components/skill-workspace/SkillOptimizeWorkspace'),
    import('../components/skill-workspace/SkillRepositoryWorkspace'),
  ]);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/?view=optimize&skill=7%3A11']}>
        <SkillFirstWorkspace />
      </MemoryRouter>,
    ),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('我已读取当前 v1');
  });
  const input = container.querySelector<HTMLTextAreaElement>(
    '.skill-optimize-workspace textarea',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!.call(input, '更新示例');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>(
        '.skill-optimize-workspace .skill-test-composer button',
      )!
      .click(),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button('查看本次改动')).not.toBeUndefined();
    expect(container.textContent).toContain('修改草稿已生成');
    expect(
      [...container.querySelectorAll('.skill-assistant-message')].some(
        (message) => !message.textContent?.trim(),
      ),
    ).toBe(false);
  });
  await act(async () => button('查看本次改动')!.click());
  expect(container.textContent).toContain('本次修改内容');
  expect(container.textContent).toContain('原始版本 v1');
  expect(container.textContent).toContain('待保存草稿 · 尚无正式版本号');
  expect(container.textContent).toContain('补充可执行的处理步骤');
  expect(container.textContent).toContain('Updated');
  expect(api.applyInteractiveChanges).not.toHaveBeenCalled();
  await act(async () => button('保存为新版本')!.click());
  expect(api.applyInteractiveChanges.mock.calls[0]?.[3]?.[0]?.modified).toBe(
    'Updated',
  );
  await act(async () => button('技能库')!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      container.querySelector('.skill-repository-card-version')?.textContent,
    ).toBe('最新版本 v2');
  });
}, 20000);

it('leaves the optimize loading state after failure and can retry safely', async () => {
  api.createArenaThread.mockResolvedValue({ id: 93 });
  api.diagnosePackage
    .mockRejectedValueOnce(new Error('分析服务暂时不可用'))
    .mockResolvedValueOnce({
      issues: [],
      session: { id: 'session-1' },
    });
  await import('../components/skill-workspace/SkillOptimizeWorkspace');

  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/?view=optimize&skill=7%3A11']}>
        <SkillFirstWorkspace />
      </MemoryRouter>,
    ),
  );

  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('分析服务暂时不可用');
    expect(container.textContent).not.toContain('正在分析这个 Skill');
    expect(button('重新分析')).not.toBeUndefined();
  });

  await act(async () => button('重新分析')!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(container.textContent).toContain('我已读取当前 v1');
  });
  expect(api.createArenaThread).toHaveBeenCalledTimes(1);
  expect(api.diagnosePackage).toHaveBeenCalledTimes(2);
  expect(api.createArenaThread.mock.calls[0]?.[3]).toBeInstanceOf(AbortSignal);
  expect(api.diagnosePackage.mock.calls[0]?.[5]).toBeInstanceOf(AbortSignal);
});

it('keeps the newest repository summary when refresh responses arrive out of order', async () => {
  const item = (n: number) => ({
    id: '11',
    packageId: '7',
    name: 'Fixture',
    updatedAt: version.createdAt,
    latestVersionId: String(n),
    latestVersionNumber: n,
  });
  let finishOld!: (value: unknown) => void;
  api.listRepositorySkills
    .mockResolvedValueOnce({ items: [item(1)], nextCursor: null })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue({ items: [item(3)], nextCursor: null });
  await Promise.all([
    import('../components/skill-workspace/SkillVersionWorkspace'),
    import('../components/skill-workspace/SkillRepositoryWorkspace'),
  ]);
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={['/?view=versions&skill=7%3A11']}>
        <SkillFirstWorkspace />
      </MemoryRouter>,
    ),
  );
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(button('刷新版本')).toBeDefined();
  });
  await act(async () => button('刷新版本')!.click());
  await act(async () => button('刷新版本')!.click());
  await act(async () => button('技能库')!.click());
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(
      container.querySelector('.skill-repository-card-version')?.textContent,
    ).toBe('最新版本 v3');
  });
  await act(async () => finishOld({ items: [item(2)], nextCursor: null }));
  expect(
    container.querySelector('.skill-repository-card-version')?.textContent,
  ).toBe('最新版本 v3');
}, 20000);

it.each(['rollback', 'discard', 'restore'] as const)(
  'refreshes the actual repository card after %s without a browser reload',
  async (action) => {
    let latest = action === 'restore' ? 2 : 3;
    let discarded = action === 'restore';
    let current = action === 'rollback' ? 3 : 2;
    const repositoryItem = () => ({
      id: '11',
      packageId: '7',
      name: 'Fixture',
      description: '',
      updatedAt: '2026-10-16T00:00:00Z',
      latestVersionId: String(latest),
      latestVersionNumber: latest,
      currentVersionId: String(current),
      currentVersionNumber: current,
    });
    api.listRepositorySkills.mockImplementation(async () => ({
      items: [repositoryItem()],
      nextCursor: null,
    }));
    api.listSkillVersions.mockImplementation(async () => ({
      items: [3, 2, 1].map((n) => ({
        ...version,
        id: String(n),
        versionNumber: n,
        status: n === 3 && discarded ? 'discarded' : 'active',
      })),
      currentVersionId: String(current),
      currentPackageVersionId: '99',
      nextCursor: null,
    }));
    api.rollbackSkillVersion.mockImplementation(async () => {
      latest = 4;
      current = 4;
      return {};
    });
    api.discardSkillVersion.mockImplementation(async () => {
      discarded = true;
      latest = 2;
      return {};
    });
    api.undiscardSkillVersion.mockImplementation(async () => {
      discarded = false;
      latest = 3;
      return {};
    });
    await Promise.all([
      import('../components/skill-workspace/SkillDetailWorkspace'),
      import('../components/skill-workspace/SkillVersionWorkspace'),
      import('../components/skill-workspace/SkillRepositoryWorkspace'),
    ]);
    await act(async () =>
      root.render(
        <MemoryRouter initialEntries={['/?view=versions&skill=7%3A11']}>
          <SkillFirstWorkspace />
        </MemoryRouter>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(
        container.querySelectorAll('.skill-version-row').length,
      ).toBeGreaterThan(0);
    });
    if (action === 'restore')
      await act(async () =>
        container
          .querySelector<HTMLInputElement>(
            '[name="include-discarded-versions"]',
          )!
          .click(),
      );
    const target = [...container.querySelectorAll('.skill-version-row')].find(
      (row) =>
        row.querySelector('.skill-version-identity > span')?.textContent ===
        (action === 'rollback' ? 'v1' : 'v3'),
    )!;
    const label =
      action === 'rollback' ? '回退' : action === 'discard' ? '废弃' : '恢复';
    await act(async () =>
      [...target.querySelectorAll('button')]
        .find((b) => b.textContent?.trim() === label)!
        .click(),
    );
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>(
          '.skill-version-confirm .skill-primary-button',
        )!
        .click(),
    );
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(container.querySelector('.skill-version-confirm')).toBeNull();
    });
    await act(async () => button('技能库')!.click());
    await vi.waitFor(async () => {
      await act(async () => {});
      expect(
        container.querySelector('.skill-repository-card-version')?.textContent,
      ).toBe(`最新版本 v${latest}`);
    });
  },
  20000,
);
