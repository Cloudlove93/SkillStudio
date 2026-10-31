import express from 'express';
import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { ArenaRunService } from '../services/arena-run-service.js';
import type { ArenaThreadDetail } from '@educlaw/shared';

const detail = {
  thread: {
    id: 91,
    arenaKind: 'skill_arena',
    skillArenaConfig: { surface: 'run' },
  },
  messages: [],
  answerOptimizations: [],
} as unknown as ArenaThreadDetail;
let executions = 0;
let signal: AbortSignal;
let release: () => void;
const manager = new ArenaRunService({
  getDetail: async (user) => {
    if (user !== 'owner')
      throw Object.assign(new Error('not found'), { status: 404 });
    return detail;
  },
  stream: async function* (_input, s) {
    executions++;
    signal = s;
    yield { event: 'delta', data: { side: 'enhanced', delta: 'partial' } };
    await new Promise<void>((resolve) => {
      release = resolve;
    });
  },
});
const servers: Server[] = [];
async function app() {
  vi.resetModules();
  vi.doMock('../services/arena-run-service.js', () => ({
    arenaRunService: manager,
  }));
  vi.doMock('../services/arena-service.js', () => ({}));
  vi.doMock('../services/answer-skill-optimization-service.js', () => ({}));
  const router = (await import('./arena.js')).default;
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
afterEach(async () => {
  release?.();
  manager.dispose();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  vi.doUnmock('../services/arena-run-service.js');
  vi.doUnmock('../services/arena-service.js');
  vi.doUnmock('../services/answer-skill-optimization-service.js');
  vi.unstubAllEnvs();
});

it('authenticates every endpoint, detaches SSE without abort, and stops the exact run', async () => {
  vi.stubEnv('ARENA_RUN_STREAM_HEARTBEAT_MS', '5');
  const url = await app();
  const path = `${url}/arena/threads/91/runs`;
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'x-user-id': 'owner', 'content-type': 'application/json' },
    body: JSON.stringify({
      requestId: 'id',
      content: 'question',
      mode: 'agent',
    }),
  });
  expect(response.status).toBe(200);
  const run = (await response.json()) as { runId: string };
  for (const [method, suffix] of [
    ['POST', ''],
    ['GET', ''],
    ['GET', `/${run.runId}`],
    ['GET', `/${run.runId}/events`],
    ['POST', `/${run.runId}/stop`],
  ]) {
    expect((await fetch(path + suffix, { method })).status).toBe(401);
    expect(
      (
        await fetch(path + suffix, {
          method,
          headers: { 'x-user-id': 'other', 'content-type': 'application/json' },
          ...(method === 'POST' && !suffix
            ? {
                body: JSON.stringify({
                  requestId: 'other',
                  content: 'q',
                  mode: 'agent',
                }),
              }
            : {}),
        })
      ).status,
    ).toBe(404);
  }
  const controller = new AbortController();
  const events = await fetch(`${path}/${run.runId}/events`, {
    headers: { 'x-user-id': 'owner' },
    signal: controller.signal,
  });
  const reader = events.body!.getReader();
  const decoder = new TextDecoder();
  let chunks = decoder.decode((await reader.read()).value);
  expect(chunks).toContain('event: snapshot');
  for (let index = 0; index < 5 && !chunks.includes('event: ping'); index++) {
    chunks += decoder.decode((await reader.read()).value);
  }
  expect(chunks).toContain('event: ping');
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(signal.aborted).toBe(false);
  expect(executions).toBe(1);
  const recovery = (await (
    await fetch(path, { headers: { 'x-user-id': 'owner' } })
  ).json()) as { run: { content: string } };
  expect(recovery.run.content).toBe('partial');
  expect(
    (
      (await (
        await fetch(`${path}/${run.runId}/stop`, {
          method: 'POST',
          headers: { 'x-user-id': 'owner' },
        })
      ).json()) as { status: string }
    ).status,
  ).toBe('stopping');
  expect(signal.aborted).toBe(true);
});
