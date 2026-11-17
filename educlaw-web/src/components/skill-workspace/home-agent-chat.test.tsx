// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AgentWorkspace, ArenaThread } from '@educlaw/shared';
import { HomeAgentChat } from './HomeAgentChat';

vi.mock('../agent-workspace/AgentConversation', () => ({
  AgentConversation: ({ thread }: { thread: ArenaThread }) => (
    <output data-thread>{thread.id}</output>
  ),
}));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const agent = {
  id: '9',
  name: '课程设计助手',
  description: '把教学目标拆成可执行的任务',
  instructions: '',
  model: '',
  skills: [],
  createdAt: '2026-11-15T00:00:00Z',
  updatedAt: '2026-11-15T00:00:00Z',
} as AgentWorkspace;
const thread = {
  id: 91,
  packageId: 7,
  title: '新对话',
  createdAt: '2026-11-15T00:00:00Z',
  updatedAt: '2026-11-15T00:00:00Z',
  skillArenaConfig: { surface: 'run', left: null, right: null },
} as ArenaThread;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(overrides: Partial<Parameters<typeof HomeAgentChat>[0]> = {}) {
  const onNewConversation = vi.fn();
  const onRetry = vi.fn();
  await act(async () =>
    root.render(
      <MemoryRouter>
        <HomeAgentChat
          token="test-token"
          agent={agent}
          thread={thread}
          loading={false}
          creating={false}
          error=""
          onNewConversation={onNewConversation}
          onRetry={onRetry}
          {...overrides}
        />
      </MemoryRouter>,
    ),
  );
  return { onNewConversation, onRetry };
}

it('shows only the Agent identity, actions and the conversation', async () => {
  const { onNewConversation } = await render();
  expect(container.querySelector('.home-agent-chat-identity h1')?.textContent).toBe(
    '课程设计助手',
  );
  expect(container.querySelector('[data-thread]')?.textContent).toBe('91');
  const assembly = [...container.querySelectorAll('a')].find(
    (link) => link.textContent?.includes('装配'),
  );
  expect(assembly?.getAttribute('href')).toBe('/agents?tab=agents&agentId=9');
  const newChat = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('新对话'),
  )!;
  await act(async () => newChat.click());
  expect(onNewConversation).toHaveBeenCalledOnce();
});

it('shows a loading state before the first conversation exists', async () => {
  await render({ thread: null });
  expect(container.textContent).toContain('正在准备对话…');
  expect(container.querySelector('[data-thread]')).toBeNull();
});

it('shows the failure with a retry action', async () => {
  const { onRetry } = await render({
    thread: null,
    error: 'Agent 服务暂时不可用',
  });
  expect(container.textContent).toContain('Agent 服务暂时不可用');
  const retry = [...container.querySelectorAll('button')].find(
    (button) => button.textContent?.includes('重新加载'),
  )!;
  await act(async () => retry.click());
  expect(onRetry).toHaveBeenCalledOnce();
});
