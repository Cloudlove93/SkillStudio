// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  AgentWorkspace,
  ArenaThread,
  SkillVersionDetail,
} from '@educlaw/shared';
const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listConversations: vi.fn(),
  createConversation: vi.fn(),
}));
const lite = vi.hoisted(() => ({
  listRepositorySkills: vi.fn(),
  listSkillVersions: vi.fn(),
  getSkillVersionDetail: vi.fn(),
}));
vi.mock('../../api/agents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/agents')>()),
  agentsApi: api,
}));
vi.mock('../../api/lite-api', () => ({ liteApi: lite }));
vi.mock('../skill-workspace/SkillRunWorkspace', () => ({
  SkillRunWorkspace: (p: {
    selectedThreadId: string;
    version: SkillVersionDetail;
    purpose: string;
    showAnswerOptimization: boolean;
    packageId: string;
  }) => (
    <output
      data-chat
      data-purpose={p.purpose}
      data-optimize={String(p.showAnswerOptimization)}
    >
      {p.selectedThreadId}:{p.packageId}:{p.version.id}
    </output>
  ),
}));
import { AgentWorkspacePanel } from './AgentWorkspacePanel';
import { AgentWorkspaceApiError } from '../../api/agents';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const skill = {
  id: '11',
  packageId: '7',
  skillUid: 'lesson',
  dirName: 'lesson',
  name: '教学设计',
  description: '设计课程',
  updatedAt: '',
  packageName: '课程',
  packageDescription: '',
  latestVersionId: '102',
  latestVersionNumber: 2,
  currentVersionId: '102',
  currentVersionNumber: 2,
};
const second = {
  ...skill,
  id: '12',
  packageId: '8',
  name: '课程评价',
  currentVersionId: '202',
  latestVersionId: '202',
};
function agent(extra: Partial<AgentWorkspace> = {}): AgentWorkspace {
  return {
    id: '1',
    name: '课程助手',
    description: '备课',
    instructions: '先设计再评价',
    model: 'pinned-model',
    skills: [
      {
        skillId: '11',
        skillVersionId: '102',
        packageId: '7',
        name: '教学设计',
        description: '设计课程',
        versionNumber: 2,
        available: true,
        enabled: true,
      },
    ],
    createdAt: '2026-11-03T00:00:00Z',
    updatedAt: '2026-11-03T01:00:00Z',
    ...extra,
  };
}
function thread(purpose: 'run' | 'test' = 'run'): ArenaThread {
  return {
    id: 91,
    packageId: 7,
    title: '历史任务',
    model: 'old-model',
    arenaKind: 'skill_arena',
    basePackageVersionId: '70',
    createdAt: '',
    updatedAt: '2026-11-03T01:00:00Z',
    skillArenaConfig: {
      mode: 'skill_arena',
      compositionMode: 'skill_only',
      surface: purpose,
      basePackageVersionId: '70',
      left: null,
      right: {
        side: 'right',
        skillId: '11',
        skillVersionId: '101',
        skillUid: 'lesson',
        skillName: '旧设计',
        versionNumber: 1,
      },
      agentExecution: {
        agentId: '1',
        name: '旧助手',
        instructions: '旧指令',
        model: 'old-model',
        skills: [
          {
            ...agent().skills[0],
            skillVersionId: '101',
            versionNumber: 1,
            packageVersionId: '70',
            skillUid: 'lesson',
            skillMd: '# Lesson',
          },
          {
            ...agent().skills[0],
            skillId: '12',
            skillVersionId: '201',
            packageId: '8',
            name: '旧评价',
            versionNumber: 1,
            packageVersionId: '80',
            skillUid: 'review',
            skillMd: '# Review',
          },
        ],
      },
    },
  };
}
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, '', '/agents');
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  api.list.mockResolvedValue([agent()]);
  api.get.mockImplementation(async () => agent());
  api.listConversations.mockResolvedValue([]);
  api.create.mockImplementation(async (_token, input) =>
    agent({
      ...input,
      skills: input.skills.map(
        (s: { skillId: string; skillVersionId: string; enabled: boolean }) => ({
          ...s,
          packageId: s.skillId === '12' ? '8' : '7',
          name: s.skillId === '12' ? '课程评价' : '教学设计',
          description: '',
          versionNumber: 2,
          available: true,
        }),
      ),
    }),
  );
  api.update.mockImplementation(async (_token, _id, input) =>
    agent({
      ...input,
      updatedAt: '2026-11-03T02:00:00Z',
      skills: input.skills.map(
        (s: { skillId: string; skillVersionId: string; enabled: boolean }) => ({
          ...s,
          packageId: s.skillId === '12' ? '8' : '7',
          name: s.skillId === '12' ? '课程评价' : '教学设计',
          description: '',
          versionNumber: 2,
          available: true,
        }),
      ),
    }),
  );
  api.createConversation.mockResolvedValue(thread());
  lite.listRepositorySkills.mockResolvedValue({
    items: [skill, second],
    nextCursor: null,
  });
  lite.listSkillVersions.mockImplementation(
    async (_token, _packageId, skillId) => ({
      items: [
        {
          id: skillId === '12' ? '202' : '102',
          skillId,
          versionNumber: 2,
          status: 'active',
        },
        {
          id: skillId === '12' ? '201' : '101',
          skillId,
          versionNumber: 1,
          status: 'active',
        },
      ],
      currentVersionId: skillId === '12' ? '202' : '102',
      currentPackageVersionId: '70',
      nextCursor: null,
    }),
  );
  lite.getSkillVersionDetail.mockResolvedValue({
    id: '101',
    skillId: '11',
    packageId: '7',
    versionNumber: 1,
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(
  extra: Partial<ComponentProps<typeof AgentWorkspacePanel>> = {},
  strict = false,
) {
  await act(async () =>
    root.render(
      strict ? (
        <StrictMode>
          <AgentWorkspacePanel token="explicit-token" {...extra} />
        </StrictMode>
      ) : (
        <AgentWorkspacePanel token="explicit-token" {...extra} />
      ),
    ),
  );
}
function button(text: string) {
  const found =
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === text,
    ) ??
    [...container.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.getAttribute('aria-label') === text,
    );
  expect(found, text).toBeDefined();
  return found!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
function field(label: string) {
  const found = [...container.querySelectorAll('label')]
    .find((l) => l.firstChild?.textContent === label)
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea');
  expect(found, label).toBeDefined();
  return found!;
}
async function change(label: string, value: string) {
  await act(async () => {
    const input = field(label);
    const prototype =
      input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(
      input,
      value,
    );
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
it('creates an Agent without skills under StrictMode and retains the saved selection', async () => {
  api.list.mockResolvedValue([]);
  await render({}, true);
  await change('Agent 名称', '新助手');
  await click('创建 Agent');
  expect(api.create).toHaveBeenCalledWith('explicit-token', {
    name: '新助手',
    description: '',
    instructions: '',
    model: '',
    skills: [],
  });
  expect(field('Agent 名称').value).toBe('新助手');
  expect(window.location.search).toContain('agentId=1');
  expect(button('新建运行对话').disabled).toBe(true);
});
it('edits with CAS, multiple skills, explicit versions and disabled bindings', async () => {
  await render();
  await change('Agent 指令', '新的协作规则');
  const add = [
    ...container.querySelectorAll<HTMLButtonElement>(
      '.agent-skill-result button',
    ),
  ][0];
  await act(async () => add.click());
  await act(async () => {
    const select = container.querySelector<HTMLSelectElement>('select')!;
    select.value = '101';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () =>
    container
      .querySelector<HTMLInputElement>(
        '.agent-attached-skill input[type=checkbox]',
      )!
      .click(),
  );
  expect(button('新建运行对话').disabled).toBe(true);
  await click('保存配置');
  expect(api.update).toHaveBeenCalledWith(
    'explicit-token',
    '1',
    expect.objectContaining({
      instructions: '新的协作规则',
      expectedUpdatedAt: agent().updatedAt,
      skills: [
        { skillId: '11', skillVersionId: '101', enabled: false },
        { skillId: '12', skillVersionId: '202', enabled: true },
      ],
    }),
  );
});
it('creates an explicit test conversation using its historical anchor and all bound skills', async () => {
  const onOpenSkill = vi.fn();
  api.createConversation.mockResolvedValue(thread('test'));
  await render({ onOpenSkill });
  await click('新建测试对话');
  expect(api.createConversation).toHaveBeenCalledWith('explicit-token', '1', {
    purpose: 'test',
    requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(lite.getSkillVersionDetail).toHaveBeenCalledWith(
    'explicit-token',
    '7',
    '101',
  );
  expect(container.querySelector('output')?.textContent).toBe('91:7:101');
  expect(container.querySelector('output')?.getAttribute('data-purpose')).toBe(
    'test',
  );
  expect(container.querySelector('output')?.getAttribute('data-optimize')).toBe(
    'false',
  );
  expect(container.textContent).toContain('old-model');
  await click('旧评价 · v1 ↗');
  expect(onOpenSkill).toHaveBeenCalledWith({
    packageId: '8',
    skillId: '12',
    name: '旧评价',
    description: '设计课程',
  });
});
it('restores agent and conversation from the URL without using current skill versions', async () => {
  window.history.replaceState({}, '', '/agents?agentId=1&conversation=91');
  api.listConversations.mockResolvedValue([thread('test')]);
  await render();
  expect(api.get).toHaveBeenCalledWith('explicit-token', '1');
  expect(container.querySelector('output')?.textContent).toBe('91:7:101');
  expect(container.textContent).toContain('旧指令');
});
it('preselects a generated query skill then creates and starts in one click', async () => {
  window.history.replaceState({}, '', '/agents?skillId=12');
  await render({}, true);
  expect(container.querySelectorAll('.agent-attached-skill')).toHaveLength(1);
  await change('Agent 名称', '新评价助手');
  await click('创建并使用');
  expect(api.create).toHaveBeenCalledWith(
    'explicit-token',
    expect.objectContaining({
      skills: [{ skillId: '12', skillVersionId: '202', enabled: true }],
    }),
  );
  expect(api.createConversation).toHaveBeenCalledWith(
    'explicit-token',
    '1',
    expect.objectContaining({ purpose: 'run' }),
  );
  expect(window.location.search).toContain('conversation=91');
});
it('keeps the saved Agent and reuses the conversation key after save-and-run transport failure', async () => {
  api.list.mockResolvedValue([]);
  api.createConversation
    .mockRejectedValueOnce(new TypeError('connection lost'))
    .mockResolvedValueOnce(thread());
  window.history.replaceState({}, '', '/agents?skillId=11');
  await render({}, true);
  await change('Agent 名称', '新助手');
  await click('创建并使用');
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(window.location.search).toContain('agentId=1');
  expect(container.textContent).toContain('connection lost');
  await click('保存并使用');
  expect(api.create).toHaveBeenCalledTimes(1);
  expect(api.update).not.toHaveBeenCalled();
  expect(api.createConversation.mock.calls[0][2]).toEqual(
    api.createConversation.mock.calls[1][2],
  );
  expect(container.querySelector('output')?.textContent).toBe('91:7:101');
});
it('attaches generated skill to an existing Agent, then reselects it in a new draft', async () => {
  window.history.replaceState({}, '', '/agents?skillId=12');
  await render();
  await click('课程助手备课1 个启用的 Skills');
  await click('放弃并继续');
  await click('添加待绑定 Skill');
  await click('保存配置');
  expect(api.update).toHaveBeenCalledWith(
    'explicit-token',
    '1',
    expect.objectContaining({
      skills: [
        { skillId: '11', skillVersionId: '102', enabled: true },
        { skillId: '12', skillVersionId: '202', enabled: true },
      ],
    }),
  );
  await click('新建 Agent');
  expect(container.querySelectorAll('.agent-attached-skill')).toHaveLength(1);
  expect(
    container.querySelector('.agent-attached-skill')?.textContent,
  ).toContain('课程评价');
});
it('retains unsaved edits after a CAS conflict and offers deliberate reload', async () => {
  api.update.mockRejectedValue(new AgentWorkspaceApiError('配置冲突', 409));
  await render();
  await change('Agent 名称', '未保存');
  await click('保存配置');
  expect(field('Agent 名称').value).toBe('未保存');
  expect(container.textContent).toContain('配置冲突');
  await click('重新加载配置');
  expect(container.querySelector('[role=alertdialog]')).not.toBeNull();
  await click('继续编辑');
  expect(field('Agent 名称').value).toBe('未保存');
});
it('refuses to render chat when the fetched anchor belongs to a different Skill', async () => {
  lite.getSkillVersionDetail.mockResolvedValue({
    id: '101',
    skillId: '99',
    packageId: '7',
  });
  window.history.replaceState({}, '', '/agents?agentId=1&conversation=91');
  api.listConversations.mockResolvedValue([thread()]);
  await render();
  expect(container.querySelector('output')).toBeNull();
  expect(container.textContent).toContain(
    '对话绑定版本与返回的 Skill 版本不一致',
  );
});
