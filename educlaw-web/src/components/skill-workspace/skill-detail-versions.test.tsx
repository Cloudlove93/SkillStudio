// @vitest-environment jsdom
import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({
  getArenaThreadDetail: vi.fn(),
  getSkillVersionDetail: vi.fn(),
}));
vi.mock('../../api/lite-api', () => ({ liteApi: api }));
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
it('only detaches from an existing conversation on the explicit new-conversation action', async () => {
  const p = props();
  await render(p);
  await act(async () => {
    const select = container.querySelector('select')!;
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  expect(p.onNewConversation).not.toHaveBeenCalled();
  expect(container.querySelector('output')?.textContent).toBe('91:1');
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === '用所选版本新建对话',
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(p.onNewConversation).toHaveBeenCalledOnce();
});
it('does not use a discarded selection for a new conversation', async () => {
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
  expect(container.querySelector('output')?.textContent).toBe(':2');
});
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
