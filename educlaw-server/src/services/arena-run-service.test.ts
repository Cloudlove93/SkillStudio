import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ArenaMessage, ArenaThreadDetail } from '@educlaw/shared';
import type { ArenaChatStreamEvent } from './arena-service.js';
import { ArenaRunService } from './arena-run-service.js';
import { reserveArenaThread } from './arena-thread-lifecycle.js';

const message = (
  id: number,
  role: 'user' | 'assistant',
  content: string,
): ArenaMessage => ({
  id,
  threadId: 91,
  role,
  side: role === 'user' ? 'shared' : 'enhanced',
  content,
  createdAt: 'now',
});
const detail = {
  thread: {
    id: 91,
    arenaKind: 'skill_arena',
    skillArenaConfig: { surface: 'run' },
  },
  messages: [],
  answerOptimizations: [],
} as unknown as ArenaThreadDetail;
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const input = {
  userId: 'owner',
  threadId: 91,
  requestId: 'request-1',
  content: 'question',
  mode: 'agent' as const,
};
const services: ArenaRunService[] = [];
it('drains accepted work through producer cleanup and rejects starts after asynchronous admission', async () => {
  const admitted=barrier(), finish=barrier();
  const service=new ArenaRunService({getDetail:async()=>{await admitted.promise;return structuredClone(detail);},stream:async function*(){await finish.promise;yield {event:'delta',data:{side:'enhanced',delta:'unused'}};}});
  services.push(service);
  const pending=service.start(input);
  service.beginDrain();admitted.release();
  await expect(pending).rejects.toMatchObject({status:503,code:'SERVER_DRAINING'});
  await service.waitForIdle();
  await expect(service.start(input)).rejects.toMatchObject({code:'SERVER_DRAINING'});
});
it('waits for the real producer after abort while recovery and explicit stop remain available', async () => {
  const finish=barrier();let signal:AbortSignal|undefined;
  const service=new ArenaRunService({getDetail:async()=>structuredClone(detail),stream:async function*(_input,s){signal=s;yield {event:'delta',data:{side:'enhanced',delta:'partial'}};await finish.promise;}});
  services.push(service);const started=await service.start(input);
  service.beginDrain();let idle=false;const waiting=service.waitForIdle().then(()=>{idle=true;});
  service.abortActive();await tick();expect(idle).toBe(false);expect(signal?.aborted).toBe(true);
  expect(()=>reserveArenaThread('owner',91)).toThrow('active operation');
  expect((await service.recover('owner',91)).run?.runId).toBe(started.runId);
  await service.stop('owner',91,started.runId);
  finish.release();await waiting;expect(idle).toBe(true);
  reserveArenaThread('owner',91)();
});
it('lets accepted work persist completion during drain without aborting it',async()=>{
  const finish=barrier();let signal:AbortSignal|undefined;
  const service=new ArenaRunService({getDetail:async()=>structuredClone(detail),stream:async function*(_input,s){signal=s;await finish.promise;yield {event:'done',data:{thread:detail.thread,messages:[]}};}});
  services.push(service);const started=await service.start(input);service.beginDrain();
  const idle=service.waitForIdle();expect(signal?.aborted).toBe(false);finish.release();await idle;
  expect((await service.get('owner',91,started.runId)).status).toBe('succeeded');
  expect(signal?.aborted).toBe(false);
});
function setup(
  stream: (signal: AbortSignal) => AsyncGenerator<ArenaChatStreamEvent>,
  options = {},
) {
  let executions = 0;
  const service = new ArenaRunService({
    getDetail: async (user) => {
      if (user !== 'owner')
        throw Object.assign(new Error('not found'), { status: 404 });
      return structuredClone(detail);
    },
    stream: (_input, signal) => {
      executions++;
      return stream(signal);
    },
    ...options,
  });
  services.push(service);
  return { service, executions: () => executions };
}
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
  vi.useRealTimers();
});

describe('resumable arena runs', () => {
  it('accepts legacy same-version Skill Run threads without widening the Pi gate', async () => {
    const legacy = structuredClone(detail);
    legacy.thread.skillArenaConfig = {
      ...legacy.thread.skillArenaConfig!,
      surface: undefined,
      left: { skillId: 's', skillVersionId: 'v' },
      right: { skillId: 's', skillVersionId: 'v' },
    };
    const { service } = setup(
      async function* () {
        yield* [];
      },
      { getDetail: async () => legacy },
    );
    await expect(service.start(input)).resolves.toMatchObject({ threadId: 91 });
  });
  it('publishes cumulative text revisions before completion and survives detach', async () => {
    const hold = barrier();
    const finish = barrier();
    const { service, executions } = setup(async function* () {
      yield {
        event: 'shared',
        data: { message: message(1, 'user', 'question') },
      };
      yield { event: 'delta', data: { side: 'enhanced', delta: 'first' } };
      await hold.promise;
      yield { event: 'delta', data: { side: 'enhanced', delta: ' second' } };
      await finish.promise;
      yield {
        event: 'done',
        data: {
          thread: detail.thread,
          messages: [
            message(1, 'user', 'question'),
            message(2, 'assistant', 'first second'),
          ],
        },
      };
    });
    const start = await service.start(input);
    await tick();
    const subscription = await service.subscribe('owner', 91, start.runId);
    const first = (await subscription.next()).value;
    expect(first.content).toBe('first');
    expect(first.status).toBe('running');
    await subscription.return();
    hold.release();
    await tick();
    const second = await service.get('owner', 91, start.runId);
    expect(second).toMatchObject({
      status: 'running',
      content: 'first second',
    });
    expect(second.revision).toBeGreaterThan(first.revision);
    finish.release();
    await tick();
    const recovered = await service.get('owner', 91, start.runId);
    expect(recovered).toMatchObject({
      status: 'succeeded',
      content: 'first second',
    });
    expect(executions()).toBe(1);
    await expect(
      (await service.subscribe('owner', 91, start.runId)).next(),
    ).resolves.toMatchObject({ value: { status: 'succeeded' } });
  });
  it('deduplicates concurrent start retries and rejects changed parameters and thread overlap', async () => {
    const hold = barrier();
    const { service, executions } = setup(async function* () {
      yield* [];
      await hold.promise;
    });
    const [a, b] = await Promise.all([
      service.start(input),
      service.start(input),
    ]);
    expect(a.runId).toBe(b.runId);
    expect(executions()).toBe(1);
    await expect(
      service.start({ ...input, content: 'changed' }),
    ).rejects.toMatchObject({ code: 'REQUEST_CONFLICT', status: 409 });
    await expect(
      service.start({ ...input, requestId: 'second' }),
    ).rejects.toMatchObject({ code: 'RUN_BUSY' });
    hold.release();
  });
  it('checks ownership on all operations and never cancels a newer run with an old id', async () => {
    const hold = barrier();
    let signal!: AbortSignal;
    const { service } = setup(async function* (s) {
      yield* [];
      signal = s;
      await hold.promise;
    });
    const a = await service.start(input);
    for (const op of [
      () => service.get('other', 91, a.runId),
      () => service.recover('other', 91),
      () => service.subscribe('other', 91, a.runId),
      () => service.stop('other', 91, a.runId),
    ])
      await expect(op()).rejects.toMatchObject({ status: 404 });
    expect(signal.aborted).toBe(false);
    expect((await service.stop('owner', 91, a.runId)).status).toBe('stopping');
    await expect(
      service.start({ ...input, requestId: 'b' }),
    ).rejects.toMatchObject({ code: 'RUN_BUSY' });
    hold.release();
    await tick();
    expect((await service.get('owner', 91, a.runId)).status).toBe('cancelled');
    const b = await service.start({ ...input, requestId: 'b' });
    await service.stop('owner', 91, a.runId);
    expect(signal.aborted).toBe(false);
    expect((await service.get('owner', 91, b.runId)).status).not.toBe(
      'stopping',
    );
  });
  it('coalesces slow subscribers, reports persistence truth when stop races completion', async () => {
    const hold = barrier();
    const { service } = setup(async function* () {
      await hold.promise;
      for (let n = 0; n < 50; n++)
        yield { event: 'delta', data: { side: 'enhanced', delta: 'a' } };
      yield {
        event: 'done',
        data: {
          thread: detail.thread,
          messages: [message(2, 'assistant', 'saved')],
        },
      };
    });
    const a = await service.start(input);
    const sub = await service.subscribe('owner', 91, a.runId);
    await sub.next();
    await service.stop('owner', 91, a.runId);
    hold.release();
    await tick();
    const last = await sub.next();
    expect(last.value.status).toBe('succeeded');
    expect(last.value.content).toBe('saved');
    expect((await sub.next()).done).toBe(true);
  });
  it('expires terminal cache but refuses early eviction and releases failed capacity', async () => {
    let now = 0;
    const { service } = setup(
      async function* () {
        yield* [];
        throw new Error('provider failed');
      },
      { now: () => now, maxRecords: 1, terminalTtlMs: 10 },
    );
    const a = await service.start(input);
    await tick();
    expect((await service.get('owner', 91, a.runId)).status).toBe('failed');
    await expect(
      service.start({ ...input, requestId: 'b' }),
    ).rejects.toMatchObject({ code: 'RUN_CACHE_FULL' });
    now = 11;
    expect((await service.recover('owner', 91)).run).toBeNull();
    expect((await service.start({ ...input, requestId: 'b' })).runId).not.toBe(
      a.runId,
    );
  });
  it('times out actual execution and keeps capacity reserved until it settles', async () => {
    vi.useFakeTimers();
    const hold = barrier();
    let signal!: AbortSignal;
    const { service } = setup(
      async function* (s) {
        yield* [];
        signal = s;
        await hold.promise;
      },
      { timeoutMs: 20 },
    );
    const a = await service.start(input);
    await vi.advanceTimersByTimeAsync(21);
    expect(signal.aborted).toBe(true);
    await expect(
      service.start({ ...input, requestId: 'b' }),
    ).rejects.toMatchObject({ code: 'RUN_BUSY' });
    hold.release();
    await Promise.resolve();
    await Promise.resolve();
    expect(await service.get('owner', 91, a.runId)).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('timed out'),
    });
  });
  it('bounds input and cumulative snapshot memory', async () => {
    const { service } = setup(
      async function* () {
        yield {
          event: 'delta',
          data: { side: 'enhanced', delta: 'x'.repeat(2000) },
        };
      },
      { maxSnapshotBytes: 1024 },
    );
    await expect(
      service.start({ ...input, requestId: 'x'.repeat(129) }),
    ).rejects.toMatchObject({ status: 422 });
    const a = await service.start(input);
    await tick();
    expect((await service.get('owner', 91, a.runId)).status).toBe('failed');
    expect(
      JSON.stringify(await service.get('owner', 91, a.runId)).length,
    ).toBeLessThan(1024);
  });
  it('merges persisted completion into a history read that began before commit', async () => {
    const hold = barrier();
    const reading = barrier();
    let reads = 0;
    const { service } = setup(
      async function* () {
        await hold.promise;
        yield {
          event: 'done',
          data: {
            thread: detail.thread,
            messages: [
              message(1, 'user', 'question'),
              message(2, 'assistant', 'saved'),
            ],
          },
        };
      },
      {
        getDetail: async () => {
          reads++;
          const stale = structuredClone(detail);
          if (reads === 2) await reading.promise;
          return stale;
        },
      },
    );
    const a = await service.start(input);
    const recovery = service.recover('owner', 91);
    hold.release();
    await tick();
    reading.release();
    const result = await recovery;
    expect(result.run?.runId).toBe(a.runId);
    expect(result.detail.messages.map((m) => m.id)).toEqual([1, 2]);
  });
  it('aborts on output overflow and holds the slot until the producer actually settles', async () => {
    const hold = barrier();
    let signal!: AbortSignal;
    const { service } = setup(
      async function* (s) {
        signal = s;
        yield {
          event: 'delta',
          data: { side: 'enhanced', delta: 'x'.repeat(2000) },
        };
        await hold.promise;
      },
      { maxSnapshotBytes: 1024 },
    );
    const a = await service.start(input);
    await tick();
    expect(signal.aborted).toBe(true);
    await expect(
      service.start({ ...input, requestId: 'b' }),
    ).rejects.toMatchObject({ code: 'RUN_BUSY' });
    await service.stop('owner', 91, a.runId);
    hold.release();
    await tick();
    const final = await service.get('owner', 91, a.runId);
    expect(final.status).toBe('failed');
    expect(Buffer.byteLength(JSON.stringify(final))).toBeLessThanOrEqual(1024);
  });
  it('canonicalizes PostgreSQL bigint identities when reconciling saved history', async () => {
    const hold = barrier();
    const saved = message(1, 'user', 'question');
    const { service } = setup(
      async function* () {
        yield {
          event: 'shared',
          data: { message: { ...saved, id: '1' as unknown as number } },
        };
        await hold.promise;
      },
      { getDetail: async () => ({ ...detail, messages: [saved] }) },
    );
    await service.start(input);
    await tick();
    expect((await service.recover('owner', 91)).detail.messages).toHaveLength(
      1,
    );
    hold.release();
  });
  it('reserves stopping metadata after the streaming text approaches its limit', async () => {
    vi.useFakeTimers();
    const hold = barrier();
    let signal!: AbortSignal;
    const { service } = setup(
      async function* (s) {
        signal = s;
        yield {
          event: 'delta',
          data: { side: 'enhanced', delta: 'a'.repeat(2070) },
        };
        await hold.promise;
      },
      { maxSnapshotBytes: 3000, timeoutMs: 20 },
    );
    const a = await service.start(input);
    await vi.advanceTimersByTimeAsync(0);
    expect((await service.get('owner', 91, a.runId)).content).toHaveLength(
      2070,
    );
    await vi.advanceTimersByTimeAsync(21);
    expect(signal.aborted).toBe(true);
    expect((await service.get('owner', 91, a.runId)).status).toBe('stopping');
    hold.release();
  });
  it('bounds subscriptions while allowing explicit stop and replacement after detach', async () => {
    const hold = barrier();
    const { service } = setup(async function* () {
      yield* [];
      await hold.promise;
    });
    const a = await service.start(input);
    const subscriptions = await Promise.all(
      Array.from({ length: 32 }, () => service.subscribe('owner', 91, a.runId)),
    );
    await expect(service.subscribe('owner', 91, a.runId)).rejects.toMatchObject(
      { code: 'RUN_SUBSCRIBERS_FULL', status: 429 },
    );
    await subscriptions[0].return?.();
    const replacement = await service.subscribe('owner', 91, a.runId);
    expect((await service.stop('owner', 91, a.runId)).status).toBe('stopping');
    await replacement.return?.();
    await Promise.all(subscriptions.map((s) => s.return?.()));
    hold.release();
  });
  it('releases global capacity only after a failed producer settles', async () => {
    const hold = barrier();
    const { service } = setup(
      async function* () {
        yield* [];
        await hold.promise;
        throw new Error('failed');
      },
      { maxConcurrent: 1 },
    );
    await service.start(input);
    await expect(
      service.start({ ...input, threadId: 92 }),
    ).rejects.toMatchObject({ code: 'RUN_BUSY' });
    hold.release();
    await tick();
    await expect(
      service.start({ ...input, threadId: 92 }),
    ).resolves.toMatchObject({ threadId: 92 });
  });
  it('preserves committed success when a final-only answer exceeds the snapshot bound', async () => {
    const hold = barrier();
    const reading = barrier();
    let reads = 0;
    let committed = false;
    const saved = [
      message(1, 'user', 'question'),
      message(2, 'assistant', 'x'.repeat(2000)),
    ];
    const { service } = setup(
      async function* () {
        await hold.promise;
        committed = true;
        yield {
          event: 'done',
          data: { thread: detail.thread, messages: saved },
        };
      },
      {
        maxSnapshotBytes: 1024,
        getDetail: async () => {
          reads++;
          const result = { ...detail, messages: committed ? saved : [] };
          if (reads === 2) await reading.promise;
          return result;
        },
      },
    );
    await service.start(input);
    const recovery = service.recover('owner', 91);
    hold.release();
    await tick();
    reading.release();
    const result = await recovery;
    expect(result.run).toMatchObject({
      status: 'succeeded',
      historyRequired: true,
    });
    expect(Buffer.byteLength(JSON.stringify(result.run))).toBeLessThanOrEqual(
      1024,
    );
    expect(result.detail.messages.map((m) => m.id)).toEqual([1, 2]);
    expect(result.detail.messages[1].content).toHaveLength(2000);
  });
});
