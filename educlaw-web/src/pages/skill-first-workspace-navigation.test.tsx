// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listRepositorySkills: vi.fn(),
  listGuidedCreations: vi.fn(),
  listThreadPage: vi.fn(),
  listSkillVersions: vi.fn(),
  recoverArenaRun: vi.fn(),
  getArenaThreadDetail: vi.fn(),
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

it.each(['run', 'test'] as const)(
  'opens a %s conversation from versions without stale synchronization restoring the previous view and inspector',
  async (surface) => {
    threads[1].skillArenaConfig.surface = surface;
    const selectedLabel = `${surface === 'test' ? '测试' : '使用'} Conversation 92`;
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
      expect(params.get('view')).toBe(surface);
      expect(params.get('conversation')).toBe('92');
      expect(params.has('inspector')).toBe(false);
      expect(
        container.querySelector(
          `textarea[aria-label="${surface === 'test' ? '输入测试任务' : '输入 Skill 使用任务'}"]`,
        ),
      ).not.toBeNull();
    });
  },
);
