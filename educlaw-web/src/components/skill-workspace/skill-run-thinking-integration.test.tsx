// @vitest-environment jsdom

import { act, useState } from 'react';
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function clickSend(container: HTMLDivElement) {
  container
    .querySelector<HTMLButtonElement>('.skill-composer-input-row > button')
    ?.click();
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

  it('keeps a new-thread send alive when the parent echoes the created thread id', async () => {
    const rename = deferred<ArenaThread>();
    renameArenaThreadMock.mockReturnValue(rename.promise);
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
          event: 'side_done',
          data: {
            side: 'enhanced',
            content: 'new-thread-answer',
            reasoningContent: null,
            ok: true,
          },
        });
        onEvent({
          event: 'done',
          data: {
            thread,
            messages: [
              {
                id: 10,
                threadId: 91,
                side: 'shared',
                role: 'user',
                content: 'new-thread-question',
                createdAt: thread.createdAt,
              },
              {
                id: 11,
                threadId: 91,
                side: 'enhanced',
                role: 'assistant',
                content: 'new-thread-answer',
                createdAt: thread.createdAt,
              },
            ],
          },
        });
        onEvent({ event: 'stream_end', data: { ok: true } });
      },
    );

    function Harness() {
      const [selectedThreadId, setSelectedThreadId] = useState<string | null>(
        null,
      );
      return (
        <SkillRunWorkspace
          token="token"
          packageId="7"
          version={version}
          currentPackageVersionId="33"
          onOptimizeAnswer={onOptimizeAnswer}
          selectedThreadId={selectedThreadId}
          onThreadCreated={(nextThread) =>
            setSelectedThreadId(String(nextThread.id))
          }
        />
      );
    }

    await act(async () => root.render(<Harness />));
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'new-thread-question'),
    );
    await act(async () => {
      clickSend(container);
      await Promise.resolve();
    });
    await act(async () => rename.resolve(thread));

    expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('new-thread-answer');
  });

  it('exits loading with an error when the SSE stream ends without a terminal event', async () => {
    sendMessageStreamMock.mockResolvedValue(undefined);

    await render('91');
    await act(async () => Promise.resolve());
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'abrupt-eof'),
    );
    await act(async () => clickSend(container));

    expect(container.querySelector('.skill-composer-stop')).toBeNull();
    expect(container.textContent).toContain('连接提前结束');
  });

  it('does not publish an assistant answer before the persisted done event', async () => {
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
          event: 'side_done',
          data: {
            side: 'enhanced',
            content: 'not-persisted-answer',
            reasoningContent: null,
            ok: true,
          },
        });
        onEvent({ event: 'stream_end', data: { ok: true } });
      },
    );

    await render('91');
    await act(async () => Promise.resolve());
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'persist-me'),
    );
    await act(async () => clickSend(container));

    expect(container.textContent).not.toContain('not-persisted-answer');
    expect(container.textContent).toContain('连接提前结束');
  });

  it('suppresses a synchronous double submit', async () => {
    const stream = deferred<void>();
    sendMessageStreamMock.mockReturnValue(stream.promise);

    await render('91');
    await act(async () => Promise.resolve());
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'double-submit'),
    );
    await act(async () => {
      clickSend(container);
      clickSend(container);
      await Promise.resolve();
    });

    expect(sendMessageStreamMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('.skill-composer-stop')
        ?.click();
    });
  });

  it('allows another send after a successful persisted response', async () => {
    let nextMessageId = 40;
    sendMessageStreamMock.mockImplementation(
      async (
        _token,
        _threadId,
        content,
        _model,
        _mode,
        _thinkingEnabled,
        onEvent,
      ) => {
        const questionId = nextMessageId++;
        const answerId = nextMessageId++;
        onEvent({
          event: 'side_done',
          data: {
            side: 'enhanced',
            content: `${content}-answer`,
            reasoningContent: null,
            ok: true,
          },
        });
        onEvent({
          event: 'done',
          data: {
            thread,
            messages: [
              {
                id: questionId,
                threadId: 91,
                side: 'shared',
                role: 'user',
                content,
                createdAt: thread.createdAt,
              },
              {
                id: answerId,
                threadId: 91,
                side: 'enhanced',
                role: 'assistant',
                content: `${content}-answer`,
                createdAt: thread.createdAt,
              },
            ],
          },
        });
        onEvent({ event: 'stream_end', data: { ok: true } });
      },
    );

    await render('91');
    await act(async () => Promise.resolve());
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'first-question'),
    );
    await act(async () => clickSend(container));
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'second-question'),
    );
    await act(async () => clickSend(container));

    expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('first-question-answer');
    expect(container.textContent).toContain('second-question-answer');
  });

  it('can send again after cancelling the previous request', async () => {
    sendMessageStreamMock
      .mockImplementationOnce(
        async (
          _token,
          _threadId,
          _content,
          _model,
          _mode,
          _thinkingEnabled,
          _onEvent,
          signal,
        ) =>
          new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () =>
              reject(new DOMException('Aborted', 'AbortError')),
            );
          }),
      )
      .mockImplementationOnce(
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
            event: 'side_done',
            data: {
              side: 'enhanced',
              content: 'retry-answer',
              reasoningContent: null,
              ok: true,
            },
          });
          onEvent({
            event: 'done',
            data: {
              thread,
              messages: [
                {
                  id: 30,
                  threadId: 91,
                  side: 'shared',
                  role: 'user',
                  content: 'retry-question',
                  createdAt: thread.createdAt,
                },
                {
                  id: 31,
                  threadId: 91,
                  side: 'enhanced',
                  role: 'assistant',
                  content: 'retry-answer',
                  createdAt: thread.createdAt,
                },
              ],
            },
          });
          onEvent({ event: 'stream_end', data: { ok: true } });
        },
      );

    await render('91');
    await act(async () => Promise.resolve());
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'cancel-first'),
    );
    await act(async () => {
      clickSend(container);
      await Promise.resolve();
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('.skill-composer-stop')
        ?.click();
      await Promise.resolve();
    });
    await act(async () =>
      setTextareaValue(container.querySelector('textarea')!, 'retry-question'),
    );
    await act(async () => clickSend(container));

    expect(sendMessageStreamMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('retry-answer');
  });

  it('shows history loading and ignores a stale thread response after a rapid switch', async () => {
    const first = deferred<{
      thread: ArenaThread;
      messages: Array<Record<string, unknown>>;
    }>();
    const second = deferred<{
      thread: ArenaThread;
      messages: Array<Record<string, unknown>>;
    }>();
    getArenaThreadDetailMock.mockImplementation(
      (_token, _packageId, selectedThreadId) =>
        selectedThreadId === '91' ? first.promise : second.promise,
    );

    await render('91');
    expect(container.textContent).toContain('正在加载历史对话');
    await render('92');
    await act(async () =>
      second.resolve({
        thread: { ...thread, id: 92 },
        messages: [
          {
            id: 20,
            threadId: 92,
            side: 'shared',
            role: 'user',
            content: 'thread-b-question',
            createdAt: thread.createdAt,
          },
          {
            id: 21,
            threadId: 92,
            side: 'enhanced',
            role: 'assistant',
            content: 'thread-b-answer',
            createdAt: thread.createdAt,
          },
        ],
      }),
    );
    await act(async () =>
      first.resolve({
        thread,
        messages: [
          {
            id: 1,
            threadId: 91,
            side: 'shared',
            role: 'user',
            content: 'stale-thread-a-question',
            createdAt: thread.createdAt,
          },
        ],
      }),
    );

    expect(container.textContent).toContain('thread-b-answer');
    expect(container.textContent).not.toContain('stale-thread-a-question');
  });
});
