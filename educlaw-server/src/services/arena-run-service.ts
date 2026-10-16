import { randomUUID } from 'node:crypto';
import type {
  ArenaRunRecovery,
  ArenaRunSnapshot,
  ArenaRunStartRequest,
  ArenaThreadDetail,
} from '@educlaw/shared';
import type { ArenaChatStreamEvent } from './arena-service.js';
import {
  isSkillRunTestThread,
  reserveArenaThread,
} from './arena-thread-lifecycle.js';

type StartInput = ArenaRunStartRequest & { userId: string; threadId: number };
type Detail = Omit<ArenaThreadDetail, 'answerOptimizations'> & {
  answerOptimizations?: ArenaThreadDetail['answerOptimizations'];
};
interface Dependencies {
  getDetail(userId: string, threadId: number): Promise<Detail>;
  stream(
    input: StartInput,
    signal: AbortSignal,
  ): AsyncGenerator<ArenaChatStreamEvent>;
  now?: () => number;
  maxConcurrent?: number;
  getMaxConcurrent?: () => Promise<number>;
  maxRecords?: number;
  terminalTtlMs?: number;
  timeoutMs?: number;
  maxSnapshotBytes?: number;
}
interface RecordState {
  input: StartInput;
  fingerprint: string;
  snapshot: ArenaRunSnapshot;
  controller: AbortController;
  listeners: Set<() => void>;
  release: () => void;
  timer?: ReturnType<typeof setTimeout>;
  settled: boolean;
  timeout: boolean;
  failureReason?: string;
}
const terminal = (s: ArenaRunSnapshot) =>
  s.status !== 'running' && s.status !== 'stopping';
function failure(message: string, status: number, code: string) {
  return Object.assign(new Error(message), { status, code });
}

/** Owns execution, while subscriptions retain only the latest revision. */
export class ArenaRunService {
  private readonly records = new Map<string, RecordState>();
  private readonly now: () => number;
  private readonly maxBytes: number;
  private readonly cleanupTimer: ReturnType<typeof setInterval>;
  constructor(private readonly deps: Dependencies) {
    this.now = deps.now ?? Date.now;
    this.maxBytes = deps.maxSnapshotBytes ?? 1024 * 1024;
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  private cleanup() {
    for (const [id, record] of this.records)
      if (
        record.settled &&
        this.now() - record.snapshot.updatedAt >=
          (this.deps.terminalTtlMs ?? 15 * 60_000)
      )
        this.records.delete(id);
  }
  private copy(record: RecordState): ArenaRunSnapshot {
    return structuredClone(record.snapshot);
  }
  private publish(record: RecordState, changes: Partial<ArenaRunSnapshot>) {
    const next = {
      ...record.snapshot,
      ...changes,
      revision: record.snapshot.revision + 1,
      updatedAt: this.now(),
    };
    // Reserve room for terminal status/error even when text fills the cache.
    const limit =
      next.status !== 'running'
        ? this.maxBytes
        : this.maxBytes - Math.min(512, this.maxBytes / 4);
    if (Buffer.byteLength(JSON.stringify(next)) > limit) {
      if (terminal(next)) {
        // Persistence may complete with an unusually large final-only result.
        // Preserve the authoritative terminal state; recovery reads its full DB history.
        next.content = '';
        next.reasoningContent = '';
        next.messages = [];
        next.shared = null;
        next.historyRequired = true;
      } else throw new Error('Run recovery snapshot exceeded size limit');
    }
    record.snapshot = next;
    for (const notify of record.listeners) notify();
  }
  async start(raw: StartInput): Promise<ArenaRunSnapshot> {
    if (
      !raw.userId ||
      !Number.isSafeInteger(raw.threadId) ||
      raw.threadId <= 0 ||
      typeof raw.requestId !== 'string' ||
      !raw.requestId.trim() ||
      raw.requestId.length > 128 ||
      typeof raw.content !== 'string' ||
      !raw.content.trim() ||
      Buffer.byteLength(raw.content) > 64 * 1024 ||
      (raw.model !== undefined &&
        (typeof raw.model !== 'string' || raw.model.length > 256)) ||
      raw.mode !== 'agent'
    )
      throw failure('Invalid run request', 422, 'INVALID_ARGUMENT');
    const input: StartInput & { thinkingEnabled: boolean } = {
      userId: raw.userId,
      threadId: raw.threadId,
      requestId: raw.requestId,
      content: raw.content.trim(),
      model: raw.model,
      mode: raw.mode,
      thinkingEnabled: raw.thinkingEnabled === true,
    };
    const detail = await this.deps.getDetail(input.userId, input.threadId);
    const maxConcurrent = this.deps.getMaxConcurrent
      ? await this.deps.getMaxConcurrent()
      : (this.deps.maxConcurrent ?? 4);
    if (!isSkillRunTestThread(detail.thread))
      throw failure(
        'Resumable runs require a Skill Run/Test conversation',
        422,
        'INVALID_ARGUMENT',
      );
    this.cleanup();
    const fingerprint = JSON.stringify([
      input.content,
      input.model ?? null,
      input.mode,
      input.thinkingEnabled,
    ]);
    const existing = [...this.records.values()].find(
      (r) =>
        r.input.userId === input.userId &&
        r.input.threadId === input.threadId &&
        r.input.requestId === input.requestId,
    );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw failure(
          'requestId was already used with different parameters',
          409,
          'REQUEST_CONFLICT',
        );
      return this.copy(existing);
    }
    const active = [...this.records.values()].filter((r) => !r.settled);
    if (
      active.some(
        (r) =>
          r.input.threadId === input.threadId &&
          r.input.userId === input.userId,
      ) ||
      active.length >= maxConcurrent
    )
      throw failure('Run capacity is busy', 409, 'RUN_BUSY');
    if (this.records.size >= (this.deps.maxRecords ?? 128))
      throw failure(
        'Run recovery cache is full; retry after expiry',
        429,
        'RUN_CACHE_FULL',
      );
    const release = reserveArenaThread(input.userId, input.threadId);
    const time = this.now();
    const record: RecordState = {
      input,
      fingerprint,
      controller: new AbortController(),
      listeners: new Set(),
      release,
      settled: false,
      timeout: false,
      snapshot: {
        runId: randomUUID(),
        threadId: input.threadId,
        requestId: input.requestId,
        revision: 0,
        status: 'running',
        content: '',
        reasoningContent: '',
        thinkingRequested: input.thinkingEnabled,
        thinkingEnabled: false,
        thinkingSupported: null,
        shared: null,
        messages: [],
        error: null,
        createdAt: time,
        updatedAt: time,
      },
    };
    this.records.set(record.snapshot.runId, record);
    record.timer = setTimeout(() => {
      if (terminal(record.snapshot)) return;
      record.timeout = true;
      this.publish(record, { status: 'stopping', error: 'Run timed out' });
      record.controller.abort();
    }, this.deps.timeoutMs ?? 180_000);
    record.timer.unref?.();
    void this.execute(record);
    return this.copy(record);
  }
  private async execute(record: RecordState) {
    try {
      for await (const event of this.deps.stream(
        record.input,
        record.controller.signal,
      )) {
        if (record.failureReason && event.event !== 'done') continue;
        try {
          if (event.event === 'shared')
            this.publish(record, { shared: event.data.message });
          if (event.event === 'thinking_status')
            this.publish(record, {
              thinkingEnabled: event.data.enabled,
              thinkingSupported: event.data.supported,
            });
          if (event.event === 'delta' && event.data.side === 'enhanced')
            this.publish(record, {
              content: record.snapshot.content + event.data.delta,
            });
          if (
            event.event === 'reasoning_delta' &&
            event.data.side === 'enhanced'
          )
            this.publish(record, {
              reasoningContent:
                record.snapshot.reasoningContent + event.data.delta,
            });
          if (event.event === 'done') {
            const answer = event.data.messages.find(
              (m) => m.side === 'enhanced' && m.role === 'assistant',
            );
            this.publish(record, {
              status: 'succeeded',
              messages: event.data.messages,
              content: answer?.content ?? record.snapshot.content,
              reasoningContent:
                answer?.reasoningContent ?? record.snapshot.reasoningContent,
              error: null,
            });
          }
        } catch (error) {
          record.failureReason =
            error instanceof Error ? error.message.slice(0, 256) : 'Run failed';
          this.publish(record, { status: 'stopping' });
          record.controller.abort();
          // Continue consuming until the real producer settles; do not release a
          // reservation while arena-service's side worker is still unwinding.
        }
      }
      if (!terminal(record.snapshot))
        this.publish(record, {
          status:
            record.timeout || record.failureReason
              ? 'failed'
              : record.controller.signal.aborted
                ? 'cancelled'
                : 'failed',
          error:
            record.failureReason ??
            (record.timeout
              ? 'Run timed out'
              : record.controller.signal.aborted
                ? null
                : 'Run ended without persisted completion'),
        });
    } catch (error) {
      if (!terminal(record.snapshot))
        this.publish(record, {
          status:
            record.timeout || record.failureReason
              ? 'failed'
              : record.controller.signal.aborted
                ? 'cancelled'
                : 'failed',
          error:
            record.failureReason ??
            (record.timeout
              ? 'Run timed out'
              : record.controller.signal.aborted
                ? null
                : error instanceof Error
                  ? error.message.slice(0, 256)
                  : 'Run failed'),
        });
    } finally {
      clearTimeout(record.timer);
      record.settled = true;
      record.release();
      for (const notify of record.listeners) notify();
      record.listeners.clear();
    }
  }
  private async authorize(userId: string, threadId: number, runId: string) {
    await this.deps.getDetail(userId, threadId);
    this.cleanup();
    const record = this.records.get(runId);
    if (
      !record ||
      record.input.userId !== userId ||
      record.input.threadId !== threadId
    )
      throw failure('Run not found', 404, 'RUN_NOT_FOUND');
    return record;
  }
  async get(userId: string, threadId: number, runId: string) {
    return this.copy(await this.authorize(userId, threadId, runId));
  }
  async recover(userId: string, threadId: number): Promise<ArenaRunRecovery> {
    let detail = await this.deps.getDetail(userId, threadId);
    this.cleanup();
    const record = [...this.records.values()]
      .filter((r) => r.input.userId === userId && r.input.threadId === threadId)
      .at(-1);
    const run = record ? this.copy(record) : null;
    if (run?.historyRequired)
      detail = await this.deps.getDetail(userId, threadId);
    const messages = new Map(
      detail.messages.map((message) => [String(message.id), message]),
    );
    if (run?.shared)
      messages.set(String(run.shared.id), {
        ...run.shared,
        id: Number(run.shared.id),
      });
    for (const message of run?.messages ?? [])
      messages.set(String(message.id), { ...message, id: Number(message.id) });
    return {
      detail: {
        ...detail,
        messages: [...messages.values()],
        answerOptimizations: detail.answerOptimizations ?? [],
      },
      run,
    };
  }
  async stop(userId: string, threadId: number, runId: string) {
    const record = await this.authorize(userId, threadId, runId);
    if (!terminal(record.snapshot) && record.snapshot.status !== 'stopping') {
      this.publish(record, { status: 'stopping' });
      record.controller.abort();
    }
    return this.copy(record);
  }
  async subscribe(
    userId: string,
    threadId: number,
    runId: string,
  ): Promise<AsyncIterableIterator<ArenaRunSnapshot>> {
    const record = await this.authorize(userId, threadId, runId);
    if (record.listeners.size >= 32)
      throw failure('Too many run subscriptions', 429, 'RUN_SUBSCRIBERS_FULL');
    let revision = -1;
    let closed = false;
    let wake: (() => void) | undefined;
    const notify = () => {
      wake?.();
      wake = undefined;
    };
    if (!terminal(record.snapshot)) record.listeners.add(notify);
    const finish = () => {
      closed = true;
      record.listeners.delete(notify);
      notify();
    };
    const iterator: AsyncIterableIterator<ArenaRunSnapshot> = {
      [Symbol.asyncIterator]: () => iterator,
      next: async () => {
        while (!closed) {
          if (record.snapshot.revision > revision) {
            revision = record.snapshot.revision;
            return { done: false, value: this.copy(record) };
          }
          if (terminal(record.snapshot)) {
            finish();
            break;
          }
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
        return { done: true, value: undefined };
      },
      return: async () => {
        finish();
        return { done: true, value: undefined };
      },
    };
    return iterator;
  }
  dispose() {
    clearInterval(this.cleanupTimer);
    for (const record of this.records.values()) {
      clearTimeout(record.timer);
      record.controller.abort();
      record.release();
    }
  }
}

export const arenaRunService = new ArenaRunService({
  getMaxConcurrent: async () =>
    (await import('../config.js')).config.piHarnessMaxConcurrentRuns,
  getDetail: async (userId, threadId) =>
    (await import('./arena-service.js')).getThreadDetail(
      userId,
      threadId,
      true,
    ),
  stream: async function* (input, signal) {
    yield* (await import('./arena-service.js')).streamMessage(
      input.userId,
      input.threadId,
      input.content,
      input.model,
      input.mode,
      input.thinkingEnabled,
      signal,
      { managedLifecycle: true },
    );
  },
});
