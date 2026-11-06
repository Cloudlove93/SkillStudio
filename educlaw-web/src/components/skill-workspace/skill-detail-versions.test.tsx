// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getArenaThreadDetail: vi.fn(),
  getSkillVersionDetail: vi.fn(),
}));
vi.mock('../../api/lite-api', () => ({ liteApi: api }));
vi.mock('../lite/lite-rendering', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
// Isolate the version controller from model execution; inspect its execution boundary.
vi.mock('./SkillRunWorkspace', () => ({
  SkillRunWorkspace: (p: {
    version?: { id: string };
    selectedThreadId?: string;
  }) => (
    <output>
      {p.selectedThreadId}:{p.version?.id}
    </output>
  ),
}));
import { SkillDetailWorkspace } from './SkillDetailWorkspace';
type Props = ComponentProps<typeof SkillDetailWorkspace>;
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, container: HTMLDivElement;
function props(extra: Partial<Props> = {}): Props {
  return {
    token: 't',
    skill: { packageId: '7', skillId: '11', name: 'S', description: '' },
    view: 'run',
    versions: [2, 1].map((n) => ({
      id: String(n),
      skillId: '11',
      versionNumber: n,
      status: 'active',
    })) as Props['versions'],
    currentVersionId: '2',
    currentPackageVersionId: '99',
    versionsLoading: false,
    onPublishUpdate: vi.fn(),
    onReloadVersions: vi.fn(),
    onNavigate: vi.fn(),
    onBackToRepository: vi.fn(),
    onOptimizeAnswer: vi.fn(),
    conversations: [
      {
        id: 91,
        skillArenaConfig: { right: { skillVersionId: '1', versionNumber: 1 } },
      },
    ] as Props['conversations'],
    selectedConversationId: '91',
    onConversationCreated: vi.fn(),
    onConversationUpdated: vi.fn(),
    onNewConversation: vi.fn(),
    ...extra,
  } as Props;
}
beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function render(p: Props) {
  await act(async () => root.render(<SkillDetailWorkspace {...p} />));
}
it('displays and passes the conversation binding, not the repository current version', async () => {
  await render(props());
  expect(container.textContent).toContain('本对话版本：v1');
  expect(container.querySelector('output')?.textContent).toBe('91:1');
});
it('offers the Agent entry while retaining the pinned historical conversation', async () => {
  const p = props({ onAttachToAgent: vi.fn() });
  await render(p);
  expect(container.querySelector('select')).toBeNull();
  expect(p.onNewConversation).not.toHaveBeenCalled();
  expect(container.querySelector('output')?.textContent).toBe('91:1');
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === '进入 Agent 工作区',
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(p.onAttachToAgent).toHaveBeenCalledOnce();
  expect(p.onNewConversation).not.toHaveBeenCalled();
  expect(container.querySelector('output')?.textContent).toBe('91:1');
});
it('offers only a read-only preview and skips discarded versions for new Skill entry', async () => {
  const p = props({ selectedConversationId: null });
  await render(p);
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await render({
    ...p,
    versions: p.versions.map((v) =>
      v.id === '1' ? { ...v, status: 'discarded' } : v,
    ),
  });
  expect(container.querySelector('select')?.value).toBe('2');
  expect(container.querySelector('output')).toBeNull();
  expect(container.textContent).toContain('Skill 只读预览');
  expect(container.querySelector('a')?.getAttribute('href')).toBe(
    '/agents?skillId=11&autochat=1',
  );
});
it('does not mount the single Skill arena from the legacy test entry', async () => {
  await render(props({ view: 'arena', selectedConversationId: null }));
  expect(container.querySelector('output, textarea')).toBeNull();
  expect(container.textContent).toContain('Skill 只读预览');
  expect(container.querySelector('a')?.getAttribute('href')).toContain(
    '/agents?skillId=11',
  );
});
it('opens both sides of a legacy Arena history with its pinned versions and no new composer', async () => {
  await import('./LegacyArenaHistory');
  const historical = {
    id: 91,
    packageId: 7,
    arenaKind: 'skill_arena',
    model: 'old-model',
    title: '旧版本对比',
    skillArenaConfig: {
      surface: 'arena',
      left: {
        skillId: '11',
        skillVersionId: '1',
        skillName: '旧设计',
        versionNumber: 1,
      },
      right: {
        skillId: '11',
        skillVersionId: '2',
        skillName: '旧设计',
        versionNumber: 2,
      },
    },
  };
  api.getArenaThreadDetail.mockResolvedValue({
    thread: historical,
    messages: [
      { id: 1, role: 'user', side: 'shared', content: '旧任务' },
      { id: 2, role: 'assistant', side: 'baseline', content: '旧A回答' },
      { id: 3, role: 'assistant', side: 'enhanced', content: '旧B回答' },
    ],
  });
  await render(
    props({ conversations: [historical] as Props['conversations'] }),
  );
  expect(container.textContent).toContain('旧A回答');
  expect(container.textContent).toContain('旧B回答');
  expect(container.textContent).toContain('v1（版本 ID：1）');
  expect(container.textContent).toContain('v2（版本 ID：2）');
  expect(container.querySelector('textarea, output')).toBeNull();
  expect(api.getSkillVersionDetail).not.toHaveBeenCalled();
});
it('keeps legacy Arena history closed on load failure and retries the same thread', async () => {
  await import('./LegacyArenaHistory');
  const historical = {
    id: 91,
    packageId: 7,
    arenaKind: 'skill_arena',
    model: 'old-model',
    title: '旧对比',
    skillArenaConfig: {
      surface: 'arena',
      left: null,
      right: {
        skillId: '11',
        skillVersionId: '1',
        skillName: '旧设计',
        versionNumber: 1,
      },
    },
  };
  api.getArenaThreadDetail
    .mockRejectedValueOnce(new Error('历史读取失败'))
    .mockResolvedValueOnce({
      thread: historical,
      messages: [
        { id: 2, role: 'assistant', side: 'enhanced', content: '恢复的B回答' },
      ],
    });
  await render(
    props({ conversations: [historical] as Props['conversations'] }),
  );
  expect(container.textContent).toContain('历史读取失败');
  expect(container.querySelector('textarea, output')).toBeNull();
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === '重试历史对话')!
      .click(),
  );
  expect(api.getArenaThreadDetail).toHaveBeenNthCalledWith(2, 't', '7', '91');
  expect(container.textContent).toContain('恢复的B回答');
  expect(container.textContent).toContain('A：未使用 Skill');
});
it.each(['run', 'test'])(
  'reads a left-only legacy %s history without treating its baseline as an enhanced conversation',
  async (surface) => {
    await import('./LegacyArenaHistory');
    const historical = {
      id: 91,
      packageId: 7,
      arenaKind: 'skill_arena',
      title: '旧单侧对话',
      skillArenaConfig: {
        surface,
        left: {
          skillId: '11',
          skillVersionId: '1',
          skillName: '旧设计',
          versionNumber: 1,
        },
        right: null,
      },
    };
    api.getArenaThreadDetail.mockResolvedValue({
      thread: historical,
      messages: [
        {
          id: 2,
          role: 'assistant',
          side: 'baseline',
          content: '原baseline回答',
        },
      ],
    });
    await render(
      props({ conversations: [historical] as Props['conversations'] }),
    );
    expect(container.textContent).toContain('原baseline回答');
    expect(container.textContent).toContain('A 回答');
    expect(container.textContent).toContain('v1（版本 ID：1）');
    expect(container.textContent).toContain('B：未使用 Skill');
    expect(container.querySelector('textarea, output')).toBeNull();
    expect(api.getSkillVersionDetail).not.toHaveBeenCalled();
  },
);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
it('loads a conversation binding outside the first page and retries metadata failure', async () => {
  api.getSkillVersionDetail
    .mockRejectedValueOnce(new Error('metadata unavailable'))
    .mockResolvedValueOnce({
      id: '1',
      skillId: '11',
      versionNumber: 1,
      status: 'active',
    });
  const p = props();
  p.versions = p.versions.filter((v) => v.id !== '1');
  await render(p);
  expect(container.textContent).toContain('metadata unavailable');
  expect(container.querySelector('output')?.textContent).toBe('91:');
  await act(async () =>
    Array.from(container.querySelectorAll('button'))
      .find((b) => b.textContent === '重试')!
      .click(),
  );
  expect(container.textContent).toContain('本对话版本：v1');
  expect(container.querySelector('output')?.textContent).toBe('91:1');
});
it('ignores late binding metadata after a conversation switch', async () => {
  const old = deferred<unknown>();
  api.getSkillVersionDetail.mockReturnValueOnce(old.promise);
  const p = props();
  await render({ ...p, versions: p.versions.filter((v) => v.id !== '1') });
  await render({
    ...p,
    selectedConversationId: '92',
    conversations: [
      { id: 92, skillArenaConfig: { right: { skillVersionId: '2' } } },
    ] as Props['conversations'],
  });
  await act(async () =>
    old.resolve({ id: '1', skillId: '11', versionNumber: 1, status: 'active' }),
  );
  expect(container.querySelector('output')?.textContent).toBe('92:2');
  expect(container.textContent).not.toContain('本对话版本：v1');
});
