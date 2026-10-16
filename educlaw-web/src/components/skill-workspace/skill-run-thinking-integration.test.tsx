// @vitest-environment jsdom
import { act, StrictMode, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ArenaMessage,
  ArenaRunSnapshot,
  ArenaThread,
  SkillVersionDetail,
} from '@educlaw/shared';

const api = vi.hoisted(() => ({
  createArenaThread: vi.fn(),
  renameArenaThread: vi.fn(),
  recoverArenaRun: vi.fn(),
  startArenaRun: vi.fn(),
  getArenaRun: vi.fn(),
  subscribeArenaRun: vi.fn(),
  stopArenaRun: vi.fn(),
}));
vi.mock('../../api/lite-api', () => ({ liteApi: api }));
vi.mock('../lite/lite-rendering', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));
import { SkillRunWorkspace } from './SkillRunWorkspace';
import type { AnswerOptimizationRerunRequest } from './answer-optimization-selection';
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const thread = {
  id: 91,
  title: 'A',
  createdAt: '2026-10-16',
  updatedAt: '2026-10-16',
} as ArenaThread;
const version = {
  id: 'v1',
  skillId: 's1',
  versionNumber: 3,
  createdInPackageVersionId: '33',
} as SkillVersionDetail;
const question = {
  id: 10,
  threadId: 91,
  role: 'user',
  side: 'shared',
  content: 'question',
  createdAt: '2026-10-16',
} as ArenaMessage;
const answer = {
  ...question,
  id: 11,
  role: 'assistant',
  side: 'enhanced',
  content: 'saved-answer',
  reasoningContent: 'saved-reason',
} as ArenaMessage;
function run(extra: Partial<ArenaRunSnapshot> = {}): ArenaRunSnapshot {
  return {
    runId: 'r1',
    threadId: 91,
    requestId: 'q1',
    revision: 1,
    status: 'running',
    content: 'partial-answer',
    reasoningContent: 'partial-reason',
    shared: question,
    messages: [],
    error: null,
    thinkingRequested: true,
    thinkingEnabled: true,
    thinkingSupported: true,
    createdAt: 1,
    updatedAt: 1,
    ...extra,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('resumable Skill run lifecycle', () => {
  it.each(['unavailable', 'missing'])(
    'keeps a %s pending stop recovery from changing the newly selected conversation',
    async (failure) => {
      const start = deferred<ArenaRunSnapshot>();
      api.startArenaRun.mockImplementation(async () => {
        await start.promise;
        throw new Error('old start failed');
      });
      await render();
      await send();
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!
          .click(),
      );
      api.recoverArenaRun.mockResolvedValueOnce({
        detail: {
          thread,
          messages: [{ ...question, id: 22, content: 'B-current-question' }],
        },
        run: null,
      });
      if (failure === 'unavailable')
        api.recoverArenaRun.mockRejectedValue(new Error('old recovery failed'));
      else
        api.recoverArenaRun.mockResolvedValue({
          detail: { thread, messages: [] },
          run: null,
        });
      await render('92');
      await act(async () =>
        start.resolve(run({ status: 'failed', error: 'old failure' })),
      );
      expect(container.textContent).toContain('B-current-question');
      expect(container.textContent).not.toContain('old failure');
      expect(container.textContent).not.toContain('无法确认运行状态');
      expect(api.stopArenaRun).not.toHaveBeenCalled();
    },
  );
  it('honors explicit stop while the accepted start response is still pending', async () => {
    const start = deferred<ArenaRunSnapshot>();
    api.startArenaRun.mockReturnValue(start.promise);
    await render();
    await send();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!
        .click(),
    );
    expect(api.stopArenaRun).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('已停止生成');
    await act(async () => start.resolve(run()));
    expect(api.stopArenaRun).toHaveBeenCalledWith('token', '91', 'r1');
    expect(container.textContent).toContain('已停止生成');
  });
  let root: Root;
  let container: HTMLDivElement;
  let receive: (snapshot: ArenaRunSnapshot) => void;
  const onState = vi.fn();
  const onCreated = vi.fn();
  const onCompleted = vi.fn();
  const onOptimize = vi.fn();
  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [] },
      run: null,
    });
    api.createArenaThread.mockResolvedValue(thread);
    api.renameArenaThread.mockResolvedValue(thread);
    api.startArenaRun.mockResolvedValue(run());
    api.subscribeArenaRun.mockImplementation(
      (_token, _thread, _run, callback, signal: AbortSignal) => {
        receive = callback;
        return new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      },
    );
    api.stopArenaRun.mockResolvedValue(
      run({ status: 'cancelled', revision: 3 }),
    );
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  async function render(
    id: string | null = '91',
    strict = false,
    props: Partial<ComponentProps<typeof SkillRunWorkspace>> = {},
  ) {
    await act(async () => {
      const child = (
        <SkillRunWorkspace
          token="token"
          packageId="7"
          version={version}
          currentPackageVersionId="33"
          selectedThreadId={id}
          onRunStateChange={onState}
          onThreadCreated={onCreated}
          onCompleted={onCompleted}
          onOptimizeAnswer={onOptimize}
          {...props}
        />
      );
      root.render(strict ? <StrictMode>{child}</StrictMode> : child);
    });
  }
  async function send(content = 'question') {
    await act(async () => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(textarea, content);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="发送任务"]')
        ?.click(),
    );
  }
  it('recovers active snapshots without starting another model execution', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run(),
    });
    await render();
    expect(container.textContent).toContain('partial-answer');
    expect(container.textContent).toContain('partial-reason');
    expect(api.startArenaRun).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="停止生成"]')).not.toBeNull();
  });
  it('detaches A, displays B, and restores A without cancelling or resending', async () => {
    api.recoverArenaRun.mockImplementation((_t, id) =>
      Promise.resolve({
        detail: { thread, messages: [] },
        run: id === '91' ? run() : null,
      }),
    );
    await render();
    const signal = api.subscribeArenaRun.mock.calls[0][4];
    await render('92');
    expect(signal.aborted).toBe(true);
    expect(api.stopArenaRun).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalledWith(false, '91');
    await render('91');
    expect(container.textContent).toContain('partial-answer');
    expect(api.startArenaRun).not.toHaveBeenCalled();
  });
  it('StrictMode mount restores the run after effect replay', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run(),
    });
    await render('91', true);
    expect(container.textContent).toContain('partial-answer');
    expect(api.startArenaRun).not.toHaveBeenCalled();
  });
  it('completion racing with history is merged once with provenance', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question, answer] },
      run: run({ status: 'succeeded', messages: [question, answer] }),
    });
    await render();
    expect(container.querySelectorAll('.skill-user-message')).toHaveLength(1);
    expect(container.querySelectorAll('.skill-assistant-block')).toHaveLength(
      1,
    );
    expect(container.textContent).toContain('saved-answer');
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('.skill-reasoning-toggle')!
        .click(),
    );
    expect(container.textContent).toContain('saved-reason');
  });
  it('stops the exact recovered run and waits for actual cancellation', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run(),
    });
    const stop = deferred<ArenaRunSnapshot>();
    api.stopArenaRun.mockReturnValue(stop.promise);
    await render();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!
        .click(),
    );
    expect(api.stopArenaRun).toHaveBeenCalledWith('token', '91', 'r1');
    expect(container.querySelector('[aria-label="停止生成"]')).not.toBeNull();
    await act(async () =>
      stop.resolve(run({ status: 'cancelled', revision: 3 })),
    );
    expect(container.textContent).toContain('已停止生成');
  });
  it('a failed stop preserves active status', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [] },
      run: run(),
    });
    api.stopArenaRun.mockRejectedValue(new Error('stop unavailable'));
    await render();
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="停止生成"]')!
        .click(),
    );
    expect(container.textContent).toContain('stop unavailable');
    expect(container.querySelector('[aria-label="停止生成"]')).not.toBeNull();
    expect(onState).not.toHaveBeenCalledWith(false, '91');
  });
  it('retries a lost start response with the same request identity', async () => {
    api.startArenaRun
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(run());
    await render();
    await send();
    expect(api.startArenaRun).toHaveBeenCalledTimes(2);
    expect(api.startArenaRun.mock.calls[0][2]).toEqual(
      api.startArenaRun.mock.calls[1][2],
    );
  });
  it('ignores stale and repeated snapshot revisions', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run(),
    });
    await render();
    await act(async () => {
      receive(run({ revision: 3, content: 'newest' }));
      receive(run({ revision: 2, content: 'stale' }));
    });
    expect(container.textContent).toContain('newest');
    expect(container.textContent).not.toContain('stale');
  });
  it('does not let a late thread create switch the current conversation back', async () => {
    const creation = deferred<ArenaThread>();
    api.createArenaThread.mockReturnValue(creation.promise);
    await render(null);
    await send();
    await render('92');
    await act(async () => creation.resolve(thread));
    expect(onCreated).not.toHaveBeenCalled();
    expect(api.startArenaRun).not.toHaveBeenCalled();
  });
  it('does not let a late rename emit stale presentation side effects', async () => {
    const rename = deferred<ArenaThread>();
    api.renameArenaThread.mockReturnValue(rename.promise);
    await render(null);
    await send();
    onCreated.mockClear();
    await render('92');
    await act(async () => rename.resolve(thread));
    expect(onCreated).not.toHaveBeenCalled();
  });
  it('blocks sends while recovery is pending', async () => {
    const recovery = deferred<unknown>();
    api.recoverArenaRun.mockReturnValue(recovery.promise);
    await render();
    expect(container.querySelector('textarea')!.disabled).toBe(true);
    expect(api.startArenaRun).not.toHaveBeenCalled();
  });
  it('accepts a subsequent round after confirmed completion without duplicate history', async () => {
    await render();
    await send();
    await act(async () =>
      receive(
        run({ revision: 3, status: 'succeeded', messages: [question, answer] }),
      ),
    );
    await send('second');
    expect(api.startArenaRun).toHaveBeenCalledTimes(2);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
  it('detaches unmount without reporting a terminal state', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [] },
      run: run(),
    });
    await render();
    await act(async () => root.render(null));
    expect(api.stopArenaRun).not.toHaveBeenCalled();
    expect(onState).not.toHaveBeenCalledWith(false, '91');
  });
  it('recovers persisted history after an expired run or process restart without reprompting', async () => {
    vi.useFakeTimers();
    api.recoverArenaRun
      .mockResolvedValueOnce({
        detail: { thread, messages: [question] },
        run: run(),
      })
      .mockResolvedValue({
        detail: { thread, messages: [question, answer] },
        run: null,
      });
    api.subscribeArenaRun.mockResolvedValueOnce(undefined);
    api.getArenaRun.mockRejectedValue(
      Object.assign(new Error('expired'), { status: 404 }),
    );
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.textContent).toContain('saved-answer');
    expect(container.querySelector('[aria-label="停止生成"]')).toBeNull();
    expect(api.startArenaRun).not.toHaveBeenCalled();
  });
  it('honors a completed same-request run after both start responses were lost', async () => {
    api.startArenaRun.mockRejectedValue(new TypeError('Failed to fetch'));
    api.recoverArenaRun
      .mockResolvedValueOnce({ detail: { thread, messages: [] }, run: null })
      .mockImplementation(async () => ({
        detail: { thread, messages: [question, answer] },
        run: run({
          requestId: api.startArenaRun.mock.calls[0][2].requestId,
          status: 'succeeded',
          messages: [question, answer],
        }),
      }));
    await render();
    await send();
    expect(container.textContent).toContain('saved-answer');
    expect(container.textContent).not.toContain('Failed to fetch');
    expect(container.querySelectorAll('.skill-user-message')).toHaveLength(1);
  });
  it('refetches persisted history before accepting an oversized terminal snapshot', async () => {
    api.recoverArenaRun
      .mockResolvedValueOnce({
        detail: { thread, messages: [question] },
        run: run(),
      })
      .mockResolvedValue({
        detail: { thread, messages: [question, answer] },
        run: run({ status: 'succeeded', messages: [] }),
      });
    await render();
    await act(async () =>
      receive(
        run({
          status: 'succeeded',
          revision: 4,
          shared: null,
          messages: [],
          content: '',
          reasoningContent: '',
        }),
      ),
    );
    expect(container.textContent).toContain('saved-answer');
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
  it('detaches old credentials and clears old history when identity changes on the same thread', async () => {
    api.recoverArenaRun.mockResolvedValueOnce({
      detail: { thread, messages: [question] },
      run: run(),
    });
    await render();
    const signal = api.subscribeArenaRun.mock.calls[0][4];
    await render('91', false, { token: 'other-token' });
    expect(signal.aborted).toBe(true);
    expect(api.recoverArenaRun).toHaveBeenLastCalledWith('other-token', '91');
    expect(container.textContent).not.toContain('partial-answer');
  });
  it('stops retrying an unauthorized run and never resends its prompt', async () => {
    vi.useFakeTimers();
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run(),
    });
    api.subscribeArenaRun.mockResolvedValueOnce(undefined);
    api.getArenaRun.mockRejectedValue(
      Object.assign(new Error('forbidden'), { status: 403 }),
    );
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(api.getArenaRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('无权访问');
    expect(api.startArenaRun).not.toHaveBeenCalled();
  });
  it('does not confuse an earlier terminal run with a lost new start response', async () => {
    api.startArenaRun.mockRejectedValue(new TypeError('Failed to fetch'));
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question, answer] },
      run: run({
        requestId: 'old-request',
        status: 'succeeded',
        messages: [question, answer],
      }),
    });
    await render();
    onCompleted.mockClear();
    await send('new-question');
    expect(container.textContent).toContain('Failed to fetch');
    expect(onCompleted).not.toHaveBeenCalled();
  });
  it('suppresses a synchronous double submission', async () => {
    await render();
    await act(async () => {
      const textarea = container.querySelector('textarea')!;
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )!.set!.call(textarea, 'question');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => {
      const button = container.querySelector<HTMLButtonElement>(
        '[aria-label="发送任务"]',
      )!;
      button.click();
      button.click();
    });
    expect(api.startArenaRun).toHaveBeenCalledTimes(1);
  });
  it('a new-thread acknowledgement preserves its existing subscription', async () => {
    await render(null);
    await send();
    const signal = api.subscribeArenaRun.mock.calls[0][4];
    await render('91');
    expect(signal.aborted).toBe(false);
    expect(api.startArenaRun).toHaveBeenCalledTimes(1);
    expect(api.recoverArenaRun).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'admits a rerun once after version and recovery become ready, strict=%s',
    async (strict) => {
      const pending = deferred<unknown>();
      api.recoverArenaRun.mockReturnValue(pending.promise);
      const rerun = {
        requestId: 'rerun-1',
        versionNumber: 3,
        selection: { origin: 'run', question: 'rerun-question' },
      } as AnswerOptimizationRerunRequest;
      await render('91', strict, { version: undefined, rerunRequest: rerun });
      expect(api.startArenaRun).not.toHaveBeenCalled();
      await act(async () =>
        pending.resolve({ detail: { thread, messages: [] }, run: null }),
      );
      await render('91', strict, { rerunRequest: rerun });
      expect(api.startArenaRun).toHaveBeenCalledTimes(1);
      expect(api.startArenaRun.mock.calls[0][2].content).toBe('rerun-question');
      await render('91', strict, { rerunRequest: rerun });
      expect(api.startArenaRun).toHaveBeenCalledTimes(1);
    },
  );
  it('keeps recovered history stable when a stale A recovery resolves on B', async () => {
    const pending = deferred<unknown>();
    api.recoverArenaRun.mockReturnValueOnce(pending.promise).mockResolvedValue({
      detail: {
        thread,
        messages: [{ ...question, id: 20, content: 'B-question' }],
      },
      run: null,
    });
    await render('91');
    await render('92');
    await act(async () =>
      pending.resolve({ detail: { thread, messages: [question] }, run: run() }),
    );
    expect(container.textContent).toContain('B-question');
    expect(container.textContent).not.toContain('partial-answer');
  });
  it('uses persisted answer provenance for optimization and keeps reasoning separate', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question, answer] },
      run: null,
    });
    await render();
    const optimize = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('改进这条回答'),
    );
    await act(async () => optimize!.click());
    expect(onOptimize).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'question',
        answer: 'saved-answer',
        questionMessageId: 10,
        enhancedAnswerMessageId: 11,
      }),
    );
  });
  it.each([undefined, '0', 'invalid'])(
    'blocks answer optimization without a valid current package head (%s)',
    async (head) => {
      api.recoverArenaRun.mockResolvedValue({
        detail: { thread, messages: [question, answer] },
        run: null,
      });
      await render('91', false, { currentPackageVersionId: head });
      const button = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent?.includes('改进这条回答'),
      )!;
      expect(button.disabled).toBe(true);
      await act(async () => button.click());
      expect(onOptimize).not.toHaveBeenCalled();
    },
  );
  it('uses the actual package head for answer optimization instead of the Skill creation package', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question, answer] },
      run: null,
    });
    await render('91', false, { currentPackageVersionId: '99' });
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((b) => b.textContent?.includes('改进这条回答'))!
        .click(),
    );
    expect(onOptimize).toHaveBeenCalledWith(
      expect.objectContaining({ currentPackageVersionId: 99 }),
    );
  });
  it('does not publish partial text as a saved assistant answer before terminal persistence', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run(),
    });
    await render();
    expect(container.textContent).not.toContain('改进这条回答');
    expect(container.textContent).toContain('partial-answer');
    expect(onCompleted).not.toHaveBeenCalled();
  });
  it('permits another round after a recovered failure', async () => {
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run({ status: 'failed', error: 'model failed' }),
    });
    await render();
    expect(container.textContent).toContain('model failed');
    await send('retry-question');
    expect(api.startArenaRun).toHaveBeenCalledTimes(1);
  });
  it('requests thinking and optimizes only the final saved answer', async () => {
    localStorage.setItem('educlaw.skill-chat.thinking.v1', '1');
    api.startArenaRun.mockResolvedValue(
      run({ status: 'succeeded', messages: [question, answer] }),
    );
    await render();
    await send();
    expect(api.startArenaRun.mock.calls[0][2].thinkingEnabled).toBe(true);
    expect(container.textContent).not.toContain('saved-reason');
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('.skill-reasoning-toggle')!
        .click(),
    );
    expect(container.textContent).toContain('saved-reason');
    await act(async () =>
      Array.from(container.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('改进这条回答'))!
        .click(),
    );
    expect(onOptimize.mock.calls[0][0].answer).toBe('saved-answer');
    expect(JSON.stringify(onOptimize.mock.calls)).not.toContain('saved-reason');
  });
  it('retains an active run when SSE ends and reconnects to the same run without prompting', async () => {
    vi.useFakeTimers();
    api.recoverArenaRun.mockResolvedValue({
      detail: { thread, messages: [question] },
      run: run(),
    });
    api.subscribeArenaRun.mockResolvedValueOnce(undefined);
    api.getArenaRun.mockResolvedValue(
      run({ revision: 3, content: 'reconnected-text' }),
    );
    await render();
    expect(container.querySelector('[aria-label="停止生成"]')).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.textContent).toContain('reconnected-text');
    expect(api.subscribeArenaRun).toHaveBeenCalledTimes(2);
    expect(api.startArenaRun).not.toHaveBeenCalled();
  });
  it('blocks duplicate admission after history fails until a fresh recovery confirms state', async () => {
    api.recoverArenaRun.mockRejectedValueOnce(new Error('unavailable'));
    await render();
    expect(container.textContent).toContain('对话加载失败');
    await send();
    expect(api.startArenaRun).not.toHaveBeenCalled();
    await render('92');
    await send();
    expect(api.startArenaRun).toHaveBeenCalledTimes(1);
  });
  it('does not mark completion until a terminal history read includes the committed answer', async () => {
    vi.useFakeTimers();
    api.recoverArenaRun
      .mockResolvedValueOnce({
        detail: { thread, messages: [question] },
        run: run(),
      })
      .mockResolvedValueOnce({
        detail: { thread, messages: [question] },
        run: run({ status: 'succeeded', messages: [] }),
      })
      .mockResolvedValue({
        detail: { thread, messages: [question, answer] },
        run: run({ status: 'succeeded', messages: [] }),
      });
    await render();
    await act(async () =>
      receive(
        run({
          revision: 3,
          status: 'succeeded',
          messages: [],
          shared: null,
          content: '',
          historyRequired: true,
        }),
      ),
    );
    expect(onCompleted).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(container.textContent).toContain('saved-answer');
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });
  it('keeps one question through send, authoritative shared message and compacted terminal history', async () => {
    api.recoverArenaRun
      .mockResolvedValueOnce({ detail: { thread, messages: [] }, run: null })
      .mockResolvedValue({
        detail: { thread, messages: [question, answer] },
        run: run({ status: 'succeeded', historyRequired: true, messages: [] }),
      });
    await render();
    await send();
    await act(async () => receive(run({ revision: 2, shared: question })));
    await act(async () =>
      receive(
        run({
          revision: 3,
          status: 'succeeded',
          shared: null,
          messages: [],
          content: '',
          reasoningContent: '',
          historyRequired: true,
        }),
      ),
    );
    expect(container.querySelectorAll('.skill-user-message')).toHaveLength(1);
    expect(container.textContent).toContain('saved-answer');
  });
  it('subscribes to a newer active run discovered after the old cache expires', async () => {
    vi.useFakeTimers();
    api.recoverArenaRun
      .mockResolvedValueOnce({
        detail: { thread, messages: [question] },
        run: run(),
      })
      .mockResolvedValue({
        detail: { thread, messages: [question] },
        run: run({ runId: 'r2', revision: 1, content: 'new-run' }),
      });
    api.subscribeArenaRun.mockResolvedValueOnce(undefined);
    api.getArenaRun.mockRejectedValue(
      Object.assign(new Error('expired'), { status: 404 }),
    );
    await render();
    await act(async () => vi.advanceTimersByTimeAsync(750));
    expect(api.subscribeArenaRun).toHaveBeenLastCalledWith(
      'token',
      '91',
      'r2',
      expect.any(Function),
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain('new-run');
  });
});
