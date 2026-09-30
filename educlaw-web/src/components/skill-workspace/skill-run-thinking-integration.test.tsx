// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ArenaThread, SkillVersionDetail } from '@educlaw/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createArenaThreadMock,
  getArenaThreadDetailMock,
  renameArenaThreadMock,
  sendMessageStreamMock,
} = vi.hoisted(() => ({
  createArenaThreadMock: vi.fn(),
  getArenaThreadDetailMock: vi.fn(),
  renameArenaThreadMock: vi.fn(),
  sendMessageStreamMock: vi.fn(),
}));

vi.mock('../../api/lite-api', () => ({
  liteApi: {
    createArenaThread: createArenaThreadMock,
    getArenaThreadDetail: getArenaThreadDetailMock,
    renameArenaThread: renameArenaThreadMock,
    sendMessageStream: sendMessageStreamMock,
  },
}));

vi.mock('../lite/lite-rendering', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

import { SkillRunWorkspace } from './SkillRunWorkspace';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const version = {
  id: 'version-3',
  skillId: 'skill-1',
  packageId: '7',
  createdInPackageVersionId: '33',
  versionNumber: 3,
  source: 'manual',
  basedOnVersionId: null,
  skill: {
    id: 'skill-1',
    dirName: 'skill-1',
    name: '函数教学',
    description: '',
    skillMd: '# 函数教学',
  },
  contentHash: 'hash',
  status: 'active',
  note: '',
  createdAt: '2026-08-27T00:00:00.000Z',
  discardedAt: null,
  discardedBy: null,
  discardReason: null,
  restoredAt: null,
  restoredBy: null,
} as SkillVersionDetail;

const thread = {
  id: 91,
  packageId: 7,
  title: 'Skill 对话',
  model: 'kimi-k2.5',
  arenaKind: 'skill_arena',
  basePackageVersionId: '33',
  skillArenaConfig: {
    mode: 'skill_arena',
    compositionMode: 'skill_only',
    basePackageVersionId: '33',
    surface: 'run',
  },
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
} as ArenaThread;

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value',
  )?.set;
  setter?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('Skill run thinking integration', () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOptimizeAnswer = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    createArenaThreadMock.mockResolvedValue(thread);
    renameArenaThreadMock.mockResolvedValue(thread);
    getArenaThreadDetailMock.mockResolvedValue({ thread, messages: [] });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  function render(selectedThreadId: string | null = null) {
    return act(async () => {
      root.render(
        <SkillRunWorkspace
          token="token"
          packageId="7"
          version={version}
          currentPackageVersionId="33"
          onOptimizeAnswer={onOptimizeAnswer}
          selectedThreadId={selectedThreadId}
        />,
      );
    });
  }

  it('requests thinking, renders it separately, and optimizes only the final answer', async () => {
    localStorage.setItem('educlaw.skill-chat.thinking.v1', '1');
    sendMessageStreamMock.mockImplementation(
      async (
        _token,
        _threadId,
        _content,
        _model,
        _mode,
        _thinkingEnabled,
        onEvent,
      ) => {
        onEvent({
          event: 'thinking_status',
          data: { requested: true, enabled: true, supported: true },
        });
        onEvent({
          event: 'reasoning_delta',
          data: { side: 'enhanced', delta: '内部分析' },
        });
        onEvent({
          event: 'delta',
          data: { side: 'enhanced', delta: '最终答案' },
        });
        onEvent({
          event: 'side_done',
          data: {
            side: 'enhanced',
            content: '最终答案',
            reasoningContent: '内部分析',
            ok: true,
          },
        });
        onEvent({
          event: 'done',
          data: {
            thread,
            messages: [
              {
                id: 1,
                threadId: 91,
                side: 'shared',
                role: 'user',
                content: '问题',
                createdAt: thread.createdAt,
              },
              {
                id: 2,
                threadId: 91,
                side: 'enhanced',
                role: 'assistant',
                content: '最终答案',
                reasoningContent: '内部分析',
                createdAt: thread.createdAt,
              },
            ],
          },
        });
        onEvent({ event: 'stream_end', data: { ok: true } });
      },
    );

    await render();
    const textarea = container.querySelector('textarea')!;
    await act(async () => setTextareaValue(textarea, '问题'));
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="发送任务"]')?.click();
    });

    expect(sendMessageStreamMock.mock.calls[0]?.[5]).toBe(true);
    expect(container.textContent).toContain('最终答案');
    expect(container.textContent).toContain('已完成思考');
    expect(container.textContent).not.toContain('内部分析');

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.click();
    });
    expect(container.textContent).toContain('内部分析');

    const optimize = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('改进这条回答'),
    );
    await act(async () => optimize?.click());
    expect(onOptimizeAnswer.mock.calls[0]?.[0].answer).toBe('最终答案');
    expect(JSON.stringify(onOptimizeAnswer.mock.calls)).not.toContain(
      '内部分析',
    );
  });

  it('aborts generation without turning a user stop into an error', async () => {
    localStorage.setItem('educlaw.skill-chat.thinking.v1', '1');
    let capturedEvent: ((event: unknown) => void) | undefined;
    let capturedSignal: AbortSignal | undefined;
    sendMessageStreamMock.mockImplementation(
      async (
        _token,
        _threadId,
        _content,
        _model,
        _mode,
        _thinkingEnabled,
        onEvent,
        signal,
      ) => {
        capturedEvent = onEvent;
        capturedSignal = signal;
        return new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      },
    );

    await render();
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, '长任务'),
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="发送任务"]')?.click();
      await Promise.resolve();
    });
    await act(async () => {
      capturedEvent?.({
        event: 'reasoning_delta',
        data: { side: 'enhanced', delta: '已收到分析' },
      });
      container
        .querySelector<HTMLButtonElement>('[aria-label="停止生成"]')
        ?.click();
      await Promise.resolve();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(container.textContent).toContain('已收到分析');
    expect(container.textContent).toContain('已停止生成');
    expect(container.textContent).not.toContain('Skill 执行失败');
  });

  it('restores persisted reasoning when an existing thread is opened', async () => {
    getArenaThreadDetailMock.mockResolvedValue({
      thread,
      messages: [
        {
          id: 1,
          threadId: 91,
          side: 'shared',
          role: 'user',
          content: '历史问题',
          reasoningContent: null,
          createdAt: thread.createdAt,
        },
        {
          id: 2,
          threadId: 91,
          side: 'enhanced',
          role: 'assistant',
          content: '历史答案',
          reasoningContent: '历史分析',
          createdAt: thread.createdAt,
        },
      ],
    });

    await render('91');
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain('历史答案');
    expect(container.textContent).not.toContain('历史分析');
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
        ?.click();
    });
    expect(container.textContent).toContain('历史分析');
  });
});
