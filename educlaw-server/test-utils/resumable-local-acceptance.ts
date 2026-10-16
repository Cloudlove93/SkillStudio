/** Isolated acceptance fixture: real PostgreSQL/routes/SDK, simulated provider and gateway. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const root = fileURLToPath(new URL('../../', import.meta.url));
const blocked = new Set(
  ['.env', '.env.local'].map((name) => resolve(root, name)),
);
fs.readFileSync = new Proxy(fs.readFileSync, {
  apply(target, receiver, args) {
    if (typeof args[0] === 'string' && blocked.has(resolve(args[0]))) return '';
    return Reflect.apply(target, receiver, args);
  },
});
if (
  process.env.DATABASE_URL !==
  'postgres://pi_acceptance:pi-acceptance-only@127.0.0.1:55439/pi_acceptance_test'
) {
  throw new Error('REFUSING_NON_DISPOSABLE_DATABASE');
}
Object.assign(process.env, {
  NODE_ENV: 'test',
  LLM_API_KEY: 'local-fixture-key',
  LLM_MODEL: 'kimi-k2.6',
  PI_HARNESS_SKILL_RUN_ENABLED: 'true',
  PI_HARNESS_MAX_CONCURRENT_RUNS: '4',
  MULTIMODAL_PIPELINE_RUNNER_ENABLED: 'false',
  LLM_NETWORK_RETRIES: '0',
  LLM_TIMEOUT_MS: '1000',
  LOG_LEVEL: 'warn',
});
const evidenceRoot = resolve(
  root,
  'docs/acceptance/evidence/resumable-20261016',
);
await mkdir(evidenceRoot, { recursive: true });
const checks: Record<string, unknown>[] = [];
const calls: { tag: string; thinking: boolean }[] = [];
const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const entered = new Map<
  string,
  ReturnType<typeof Promise.withResolvers<void>>
>();
const closed = new Map<
  string,
  ReturnType<typeof Promise.withResolvers<void>>
>();
function barrier(map: typeof gates, key: string) {
  if (!map.has(key)) map.set(key, Promise.withResolvers<void>());
  return map.get(key)!;
}
const provider = express();
provider.use(express.json());
provider.post('/v1/chat/completions', async (req, res) => {
  const last = JSON.stringify(req.body.messages.at(-1)?.content ?? '');
  // Legacy places the conversation in a single prompt; use its final tag.
  const tag =
    [...last.matchAll(/RESUME_[A-Z0-9_]+/g)].at(-1)?.[0] ?? 'ordinary';
  const thinking = req.body.thinking?.type === 'enabled';
  calls.push({ tag, thinking });
  barrier(entered, tag).resolve();
  res.once('close', () => barrier(closed, tag).resolve());
  if (tag.includes('ERROR')) {
    res.status(503).json({ error: { message: 'Controlled fixture failure' } });
    return;
  }
  const text = `本地续跑回答 ${tag}：先确认教学目标。`;
  const reasoning = thinking ? `本地续跑思考 ${tag}。` : '';
  res.setHeader('Content-Type', 'text/event-stream');
  const chunk = (delta: object, finish_reason: string | null = null) =>
    res.write(
      `data: ${JSON.stringify({ id: 'resumable-fixture', model: 'kimi-k2.6', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  chunk({
    role: 'assistant',
    ...(reasoning ? { reasoning_content: reasoning } : {}),
  });
  if (tag.includes('HOLD') || tag.includes('TIMEOUT'))
    await Promise.race([
      barrier(gates, tag).promise,
      barrier(closed, tag).promise,
    ]);
  if (res.destroyed) return;
  chunk({ content: text });
  chunk({}, 'stop');
  res.end('data: [DONE]\n\n');
});
const providerServer = provider.listen(0, '127.0.0.1');
await new Promise<void>((done) => providerServer.once('listening', done));
const address = providerServer.address();
assert(address && typeof address !== 'string');
process.env.LLM_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
const { initDbSchema } = await import('../src/services/db-schema.js');
const { query, withTransaction, closeDbPool } =
  await import('../src/services/db.js');
await initDbSchema();
const { createPackageWithSnapshotTx } =
  await import('../src/services/package-service.js');
const { createArenaThread, getThreadDetail } =
  await import('../src/services/arena-service.js');
const { config } = await import('../src/config.js');
const { withRequestContext } =
  await import('../src/middleware/request-context.js');
const { default: routes } = await import('../src/routes/index.js');
const { default: compat } = await import('../src/routes/compat.js');
const user = 'resumable-local-acceptance';
const skill = {
  id: 'resume-skill',
  dirName: 'resume-skill',
  name: '续跑验收',
  description: '隔离验收',
  skillMd:
    '---\nname: resume-skill\ndescription: Isolated fixture\n---\n# Instructions\nAnswer briefly using FIXED_RESUME_V1.',
};
const seeded = await withTransaction((client) =>
  createPackageWithSnapshotTx(
    client,
    user,
    {
      name: '续跑隔离验收',
      description: '临时模拟数据',
      versionLabel: 'v1',
      agentMd: 'Follow the fixed Skill.',
      rubricMd: '# Rubric\n教学目标明确。',
      skills: [skill],
    },
    'manual',
  ),
);
const skillId = String(
  (
    await query('select id from agent_package_skills where package_id=$1', [
      seeded.packageId,
    ])
  ).rows[0].id,
);
async function thread(surface: 'run' | 'test' = 'run') {
  return createArenaThread({
    authUserId: user,
    packageId: String(seeded.packageId),
    basePackageVersionId: String(seeded.packageVersionId),
    arenaKind: 'skill_arena',
    right: { skillId, skillVersionId: seeded.skillVersionIds[skill.id] },
    model: 'kimi-k2.6',
    idempotencyKey: randomUUID(),
    surface,
  });
}
const browserA = await thread();
const browserB = await thread();
const browserTest = await thread('test');
const app = express();
app.use(express.json());
app.post('/auth/password', (_req, res) =>
  res.json({ access_token: 'resume-local-token', expires_in: 3600 }),
);
app.get('/auth/me', (_req, res) =>
  res.json({ id: user, username: '续跑验收', roles: [] }),
);
app.post('/auth/logout', (_req, res) => res.json({ ok: true }));
app.get('/__acceptance/state', async (_req, res) => {
  const rows = (
    await query(
      'select thread_id,role,count(*)::int as count from arena_messages where user_id=$1 group by thread_id,role order by thread_id,role',
      [user],
    )
  ).rows;
  res.json({
    packageId: seeded.packageId,
    browserA: browserA.id,
    browserB: browserB.id,
    browserTest: browserTest.id,
    calls,
    messages: rows,
  });
});
app.post('/__acceptance/release/:tag', (req, res) => {
  barrier(gates, String(req.params.tag)).resolve();
  res.json({ ok: true });
});
app.use((req, _res, next) => {
  if (req.headers.authorization === 'Bearer resume-local-token')
    req.headers['x-user-id'] = user;
  else if (req.headers.authorization === 'Bearer resume-other-token')
    req.headers['x-user-id'] = 'resume-other-user';
  next();
});
app.use(withRequestContext);
app.use('/api', routes);
app.use(compat);
const server = app.listen(3219, '127.0.0.1');
await new Promise<void>((done) => server.once('listening', done));
const base = 'http://127.0.0.1:3219';
async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  token = 'resume-local-token',
) {
  return fetch(`${base}/api${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
type Snapshot = {
  runId: string;
  status: string;
  revision: number;
  content: string;
  shared: { id: number } | null;
  messages: { id: number }[];
};
async function start(id: number, content: string, requestId = randomUUID()) {
  const res = await request(`/arena/threads/${id}/runs`, 'POST', {
    requestId,
    content,
    mode: 'agent',
    thinkingEnabled: true,
  });
  assert.equal(
    res.status,
    200,
    `start status ${res.status}: ${(await res.clone().text()).slice(0, 100)}`,
  );
  return (await res.json()) as Snapshot;
}
async function snapshot(id: number, runId: string) {
  const res = await request(`/arena/threads/${id}/runs/${runId}`);
  assert.equal(res.status, 200);
  return (await res.json()) as Snapshot;
}
async function waitTerminal(id: number, runId: string, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const value = await snapshot(id, runId);
      if (!['running', 'stopping'].includes(value.status)) return value;
    } catch (error) {
      if (!(error instanceof TypeError && error.message === 'fetch failed'))
        throw error;
    }
    await new Promise((done) => setTimeout(done, timeout > 10_000 ? 500 : 50));
  }
  throw new Error('Fixture run did not settle');
}
async function check(name: string, work: () => Promise<unknown>) {
  try {
    checks.push({ name, status: 'passed', evidence: await work() });
  } catch (error) {
    for (const gate of gates.values()) gate.resolve();
    checks.push({
      name,
      status: 'failed',
      reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown',
    });
  }
  await writeFile(
    resolve(evidenceRoot, 'http-database.json'),
    JSON.stringify(
      {
        environment:
          'isolated PostgreSQL + actual HTTP/routes/Pi SDK + simulated model/gateway',
        projectEnvironmentFilesBlocked: true,
        node: process.version,
        checks,
      },
      null,
      2,
    ),
  );
}
await check(
  'Detached subscription, recovered same run, saved once',
  async () => {
    const t = await thread();
    const run = await start(t.id, 'RESUME_HOLD_DETACH');
    await barrier(entered, 'RESUME_HOLD_DETACH').promise;
    const controller = new AbortController();
    const response = await fetch(
      `${base}/api/arena/threads/${t.id}/runs/${run.runId}/events`,
      {
        headers: { Authorization: 'Bearer resume-local-token' },
        signal: controller.signal,
      },
    );
    assert.equal(response.status, 200);
    const reader = response.body!.getReader();
    const first = await reader.read();
    assert(new TextDecoder().decode(first.value).includes('snapshot'));
    controller.abort();
    await reader.cancel().catch(() => {});
    const recovery = await (
      await request(`/arena/threads/${t.id}/runs`)
    ).json();
    assert.equal(recovery.run.runId, run.runId);
    assert.equal(recovery.run.status, 'running');
    barrier(gates, 'RESUME_HOLD_DETACH').resolve();
    const done = await waitTerminal(t.id, run.runId);
    assert.equal(done.status, 'succeeded');
    const messages = (await getThreadDetail(user, t.id)).messages;
    assert.equal(messages.length, 2);
    const saved = (
      await query(
        'select count(*)::int as count from arena_answer_runs where thread_id=$1',
        [t.id],
      )
    ).rows[0].count;
    assert.equal(saved, 1);
    assert.equal(
      calls.filter((call) => call.tag === 'RESUME_HOLD_DETACH').length,
      1,
    );
    return {
      threadId: t.id,
      runId: run.runId,
      providerCalls: 1,
      messageCount: messages.length,
      answerRuns: saved,
    };
  },
);
await check(
  'Idempotent start, parameter conflict, same-thread busy, cross-user protection',
  async () => {
    const t = await thread();
    const key = randomUUID();
    const run = await start(t.id, 'RESUME_HOLD_IDEMPOTENT', key);
    const retry = await start(t.id, 'RESUME_HOLD_IDEMPOTENT', key);
    assert.equal(run.runId, retry.runId);
    assert.equal(
      (
        await request(`/arena/threads/${t.id}/runs`, 'POST', {
          requestId: key,
          content: 'different',
          mode: 'agent',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(`/arena/threads/${t.id}/runs`, 'POST', {
          requestId: randomUUID(),
          content: 'busy',
          mode: 'agent',
        })
      ).status,
      409,
    );
    for (const [path, method] of [
      [`/arena/threads/${t.id}/runs`, 'GET'],
      [`/arena/threads/${t.id}/runs/${run.runId}`, 'GET'],
      [`/arena/threads/${t.id}/runs/${run.runId}/events`, 'GET'],
      [`/arena/threads/${t.id}/runs/${run.runId}/stop`, 'POST'],
    ])
      assert.equal(
        (await request(path, method, undefined, 'resume-other-token')).status,
        404,
      );
    await barrier(entered, 'RESUME_HOLD_IDEMPOTENT').promise;
    barrier(gates, 'RESUME_HOLD_IDEMPOTENT').resolve();
    await waitTerminal(t.id, run.runId);
    assert.equal(
      (await start(t.id, 'RESUME_HOLD_IDEMPOTENT', key)).runId,
      run.runId,
    );
    assert.equal(
      calls.filter((call) => call.tag === 'RESUME_HOLD_IDEMPOTENT').length,
      1,
    );
    assert.equal((await getThreadDetail(user, t.id)).messages.length, 2);
    return { providerCalls: 1, messageCount: 2, foreignRequestsRejected: 4 };
  },
);
await check(
  'Explicit stop targets recovered run; stale stop leaves next run alive',
  async () => {
    const t = await thread();
    const run = await start(t.id, 'RESUME_HOLD_STOP');
    await barrier(entered, 'RESUME_HOLD_STOP').promise;
    assert.equal(
      (await request(`/arena/threads/${t.id}/runs/${run.runId}/stop`, 'POST'))
        .status,
      200,
    );
    assert.equal((await waitTerminal(t.id, run.runId)).status, 'cancelled');
    barrier(gates, 'RESUME_HOLD_STOP').resolve();
    assert.equal((await getThreadDetail(user, t.id)).messages.length, 1);
    const next = await start(t.id, 'RESUME_HOLD_AFTER_STOP');
    await barrier(entered, 'RESUME_HOLD_AFTER_STOP').promise;
    await request(`/arena/threads/${t.id}/runs/${run.runId}/stop`, 'POST');
    assert.equal((await snapshot(t.id, next.runId)).status, 'running');
    barrier(gates, 'RESUME_HOLD_AFTER_STOP').resolve();
    assert.equal((await waitTerminal(t.id, next.runId)).status, 'succeeded');
    return {
      cancelledAnswerSaved: false,
      retrySucceeded: true,
      staleStopHarmless: true,
    };
  },
);
await check(
  'Legacy stop and upstream failure do not save fake answers',
  async () => {
    config.piHarnessSkillRunEnabled = false;
    try {
      const t = await thread();
      const run = await start(t.id, 'RESUME_HOLD_LEGACY_STOP');
      await barrier(entered, 'RESUME_HOLD_LEGACY_STOP').promise;
      await request(`/arena/threads/${t.id}/runs/${run.runId}/stop`, 'POST');
      assert.equal((await waitTerminal(t.id, run.runId)).status, 'cancelled');
      barrier(gates, 'RESUME_HOLD_LEGACY_STOP').resolve();
      assert.equal((await getThreadDetail(user, t.id)).messages.length, 1);
      const failed = await start(t.id, 'RESUME_LEGACY_ERROR');
      assert.equal((await waitTerminal(t.id, failed.runId)).status, 'failed');
      assert.equal((await getThreadDetail(user, t.id)).messages.length, 2);
      const retry = await start(t.id, 'RESUME_LEGACY_RETRY');
      assert.equal((await waitTerminal(t.id, retry.runId)).status, 'succeeded');
      assert.equal((await getThreadDetail(user, t.id)).messages.length, 4);
      return {
        threadId: t.id,
        cancelledAndFailedAnswersNotSaved: true,
        retrySucceeded: true,
      };
    } finally {
      config.piHarnessSkillRunEnabled = true;
    }
  },
);
await check(
  'Finish racing recovery preserves persisted message identity',
  async () => {
    const t = await thread();
    const run = await start(t.id, 'RESUME_HOLD_RACE');
    await barrier(entered, 'RESUME_HOLD_RACE').promise;
    const recovering = Array.from({ length: 10 }, async () =>
      (await request(`/arena/threads/${t.id}/runs`)).json(),
    );
    barrier(gates, 'RESUME_HOLD_RACE').resolve();
    for (const recovery of await Promise.all(recovering)) {
      const ids = new Set(
        recovery.detail.messages.map((message: { id: number }) => message.id),
      );
      for (const message of recovery.run.messages) ids.add(message.id);
      if (recovery.run.shared) ids.add(recovery.run.shared.id);
      assert(ids.size <= 2);
      assert.equal(recovery.run.runId, run.runId);
    }
    assert.equal((await waitTerminal(t.id, run.runId)).status, 'succeeded');
    assert.equal((await getThreadDetail(user, t.id)).messages.length, 2);
    return {
      parallelRecoveries: 10,
      messageCount: 2,
      providerCalls: calls.filter((call) => call.tag === 'RESUME_HOLD_RACE')
        .length,
    };
  },
);
await check(
  'Active conversation deletion rejects; settled conversation deletes cleanly',
  async () => {
    const t = await thread();
    const run = await start(t.id, 'RESUME_HOLD_DELETE');
    await barrier(entered, 'RESUME_HOLD_DELETE').promise;
    const deletion = () =>
      request('', 'POST', {
        action: 'arena.thread.delete',
        pkgId: String(seeded.packageId),
        payload: { threadId: String(t.id) },
      });
    assert.equal((await deletion()).status, 409);
    barrier(gates, 'RESUME_HOLD_DELETE').resolve();
    assert.equal((await waitTerminal(t.id, run.runId)).status, 'succeeded');
    assert.equal((await deletion()).status, 200);
    assert.equal(
      (
        await query(
          'select count(*)::int as count from arena_messages where thread_id=$1',
          [t.id],
        )
      ).rows[0].count,
      0,
    );
    return {
      activeDeleteRejected: true,
      settledDeleteSucceeded: true,
      orphanMessages: 0,
    };
  },
);
await check(
  'Pi upstream failure is terminal failure, then retry succeeds',
  async () => {
    const t = await thread();
    const failed = await start(t.id, 'RESUME_PI_ERROR');
    assert.equal((await waitTerminal(t.id, failed.runId)).status, 'failed');
    assert.equal((await getThreadDetail(user, t.id)).messages.length, 1);
    const retry = await start(t.id, 'RESUME_PI_RETRY');
    assert.equal((await waitTerminal(t.id, retry.runId)).status, 'succeeded');
    assert.equal((await getThreadDetail(user, t.id)).messages.length, 3);
    return { failureNotSavedAsAnswer: true, retrySucceeded: true };
  },
);
console.log(
  JSON.stringify({
    event: 'resumable.acceptance.ready',
    checks,
    browser: {
      packageId: seeded.packageId,
      browserA: browserA.id,
      browserB: browserB.id,
      browserTest: browserTest.id,
    },
  }),
);
process.exitCode = checks.some((check) => check.status === 'failed') ? 1 : 0;
if (process.argv.includes('--serve')) {
  const { createServer } =
    await import('../../educlaw-web/node_modules/vite/dist/node/index.js');
  const proxy = Object.fromEntries(
    ['/api', '/auth', '/arena', '/packages', '/skills', '/__acceptance'].map(
      (path) => [path, { target: base, changeOrigin: true }],
    ),
  );
  const vite = await createServer({
    root: resolve(root, 'educlaw-web'),
    server: { host: '127.0.0.1', port: 5189, strictPort: true, proxy },
  });
  await vite.listen();
  console.log(
    JSON.stringify({
      event: 'resumable.browser.ready',
      url: 'http://127.0.0.1:5189',
    }),
  );
  void check(
    'Real 180-second deadline cancels stalled execution and permits retry',
    async () => {
      const t = await thread();
      const run = await start(t.id, 'RESUME_TIMEOUT');
      const failed = await waitTerminal(t.id, run.runId, 185_000);
      assert.equal(failed.status, 'failed');
      assert.equal((await getThreadDetail(user, t.id)).messages.length, 1);
      const retry = await start(t.id, 'RESUME_TIMEOUT_RETRY_OK');
      barrier(gates, 'RESUME_TIMEOUT_RETRY_OK').resolve();
      assert.equal((await waitTerminal(t.id, retry.runId)).status, 'succeeded');
      return {
        timeoutMs: 180000,
        failedAnswerNotSaved: true,
        retrySucceeded: true,
      };
    },
  ).then(() =>
    console.log(
      JSON.stringify({ event: 'resumable.timeout.finished', checks }),
    ),
  );
} else {
  server.closeAllConnections();
  providerServer.closeAllConnections();
  await Promise.all(
    [server, providerServer].map(
      (owned) =>
        new Promise<void>((done, reject) =>
          owned.close((error) => (error ? reject(error) : done())),
        ),
    ),
  );
  await closeDbPool();
}
