import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import { expect, it, vi } from 'vitest';
import { writeArenaRunSnapshot } from './arena-run-sse.js';
import type { ArenaRunSnapshot } from '@educlaw/shared';

it('backpressure pauses the subscription writer until drain without queuing snapshots', async () => {
  const response = new EventEmitter() as EventEmitter & {
    write: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  response.write = vi.fn(() => false);
  response.destroy = vi.fn();
  let finished = false;
  const pending = writeArenaRunSnapshot(
    response as unknown as Response,
    { runId: 'run-1', revision: 1 } as ArenaRunSnapshot,
  ).then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(response.write).toHaveBeenCalledTimes(1);
  response.emit('drain');
  await pending;
  expect(finished).toBe(true);
  expect(response.listenerCount('close')).toBe(0);
});
it('a stalled socket times out and detaches without retaining drain listeners', async () => {
  vi.useFakeTimers();
  try {
    const response = new EventEmitter() as EventEmitter & {
      write: ReturnType<typeof vi.fn>;
      destroy: ReturnType<typeof vi.fn>;
    };
    response.write = vi.fn(() => false);
    response.destroy = vi.fn(() => response.emit('close'));
    const pending = writeArenaRunSnapshot(
      response as unknown as Response,
      {} as ArenaRunSnapshot,
    );
    await vi.advanceTimersByTimeAsync(15_001);
    await pending;
    expect(response.destroy).toHaveBeenCalledOnce();
    expect(response.listenerCount('drain')).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
