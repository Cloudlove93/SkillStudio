/** Browser-only acceptance host. No production config, database, or model imports. */
import fs from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type {
  ArenaRunSnapshot,
  ArenaThread,
  ArenaMessage,
  SkillVersionDetail,
} from '@educlaw/shared';

fs.readFileSync = new Proxy(fs.readFileSync, {
  apply(target, receiver, args) {
    if (typeof args[0] === 'string' && /^\.env(?:\.|$)/.test(basename(args[0])))
      return '';
    return Reflect.apply(target, receiver, args);
  },
});
const root = fileURLToPath(new URL('../../', import.meta.url));
function version(n: number, skillId = '11'): SkillVersionDetail {
  return {
    id: String(skillId === '11' ? n : 200 + n),
    skillId,
    packageId: '7',
    versionNumber: n,
    createdInPackageVersionId: '10',
    status: n >= 6 && skillId === '11' ? 'discarded' : 'active',
    source: 'manual',
    skill: {
      id: `skill-${skillId}`,
      dirName: `skill-${skillId}`,
      name: `Skill ${skillId}`,
      description: 'isolated browser fixture',
      skillMd: `# FIXED_V${n}`,
    },
    contentHash: `fixture-${skillId}-${n}`,
    note: `历史 v${n}`,
    basedOnVersionId: null,
    createdAt: '2026-10-16T00:00:00Z',
    discardedAt: null,
    discardedBy: null,
    discardReason: null,
    restoredAt: null,
    restoredBy: null,
  };
}
const versions = new Map<string, SkillVersionDetail>(
  [
    ...Array.from({ length: 105 }, (_, i) => version(i + 1)),
    version(1, '12'),
  ].map((v) => [v.id, v]),
);
let currentId = '1',
  head = '99',
  nextThread = 100,
  nextMessage = 10,
  failBinding = 2;
const calls: { action: string; payload?: unknown }[] = [];
const threads = new Map<number, ArenaThread>();
const messages = new Map<number, ArenaMessage[]>();
const runs = new Map<string, ArenaRunSnapshot>();
const latest = new Map<number, string>();
const subscribers = new Map<string, Set<express.Response>>();
const makeThread = (id: number, versionId: string, surface = 'run') => {
  const v = versions.get(versionId)!;
  const selected = {
    skillId: v.skillId,
    skillVersionId: v.id,
    versionNumber: v.versionNumber,
  };
  const thread = {
    id,
    packageId: 7,
    title: `对话 ${id} · v${v.versionNumber}`,
    arenaKind: 'skill_arena',
    model: 'fixture',
    basePackageVersionId: '10',
    skillArenaConfig: { left: selected, right: selected, surface },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as ArenaThread;
  threads.set(id, thread);
  messages.set(id, []);
  return thread;
};
makeThread(91, '2');
function detail(id: number) {
  return {
    thread: threads.get(id),
    messages: messages.get(id) ?? [],
    answerOptimizations: [],
  };
}
function publish(run: ArenaRunSnapshot) {
  run.revision++;
  run.updatedAt = Date.now();
  for (const res of subscribers.get(run.runId) ?? [])
    if (!res.destroyed) {
      res.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`);
      if (!['running', 'stopping'].includes(run.status)) res.end();
    }
}
function finish(run: ArenaRunSnapshot) {
  if (run.status !== 'running') return;
  const thread = threads.get(run.threadId)!;
  const id = thread.skillArenaConfig!.right!.skillVersionId;
  const answer = {
    id: nextMessage++,
    threadId: run.threadId,
    side: 'enhanced',
    role: 'assistant',
    content: `固定 v${versions.get(id)!.versionNumber} 回答`,
    skillVersionId: id,
    skillVersionNumber: versions.get(id)!.versionNumber,
    createdAt: new Date().toISOString(),
  } as ArenaMessage;
  messages.get(run.threadId)!.push(answer);
  run.messages = [run.shared!, answer];
  run.content = answer.content;
  run.status = 'succeeded';
  publish(run);
}
const app = express();
app.use(express.json());
app.get('/__acceptance/state', (_req, res) =>
  res.json({
    calls,
    head,
    currentId,
    threads: [...threads.values()],
    runs: [...runs.values()],
    messages: [...messages.entries()],
  }),
);
app.post('/__acceptance/release/:runId', (req, res) => {
  const run = runs.get(String(req.params.runId));
  if (run) finish(run);
  res.json({ ok: !!run });
});
app.post('/__acceptance/optimize', (_req, res) => {
  const v = version(106);
  v.status = 'active';
  versions.set(v.id, v);
  currentId = v.id;
  head = '100';
  res.json({ versionNumber: 106 });
});
app.post('/api', (req, res) => {
  const { action, payload = {} } = req.body;
  calls.push({ action, payload });
  if (action === 'skill.version.list') {
    const skillVersions = [...versions.values()]
      .filter((v) => v.skillId === payload.skillId)
      .sort((a, b) => b.versionNumber - a.versionNumber);
    const start = payload.cursor
      ? skillVersions.findIndex((v) => v.id === payload.cursor) + 1
      : 0;
    const items = skillVersions.slice(start, start + 100);
    res.json({
      data: {
        items,
        nextCursor:
          start + 100 < skillVersions.length ? items.at(-1)!.id : null,
        currentVersionId: payload.skillId === '11' ? currentId : '201',
        currentPackageVersionId: head,
      },
      success: true,
    });
    return;
  }
  if (action === 'skill.version.detail') {
    if (payload.versionId === '2' && failBinding) {
      failBinding--;
      res.status(503).json({ message: '模拟 metadata 失败，请重试' });
      return;
    }
    res.json({ success: true, data: versions.get(payload.versionId) });
    return;
  }
  if (action === 'arena.thread.detail') {
    res.json({ success: true, data: detail(Number(payload.threadId)) });
    return;
  }
  if (action === 'arena.thread.create') {
    res.json({
      success: true,
      data: makeThread(
        nextThread++,
        payload.right.skillVersionId,
        payload.surface,
      ),
    });
    return;
  }
  if (action === 'arena.thread.rename') {
    const t = threads.get(Number(payload.threadId))!;
    t.title = payload.title;
    res.json({ success: true, data: t });
    return;
  }
  if (
    action === 'skill.version.discard' ||
    action === 'skill.version.undiscard'
  ) {
    versions.get(payload.versionId)!.status = action.endsWith('undiscard')
      ? 'active'
      : 'discarded';
    res.json({ success: true, data: {} });
    return;
  }
  if (action === 'skill.version.rollback') {
    if (payload.expectedPackageVersionId !== head) {
      res.status(409).json({
        code: 'PACKAGE_VERSION_CONFLICT',
        message: 'fixture head conflict',
      });
      return;
    }
    const n =
      Math.max(
        ...[...versions.values()]
          .filter((v) => v.skillId === '11')
          .map((v) => v.versionNumber),
      ) + 1;
    const v = version(n);
    v.status = 'active';
    v.source = 'rollback';
    v.createdInPackageVersionId = String(Number(head) + 1);
    versions.set(v.id, v);
    currentId = v.id;
    head = v.createdInPackageVersionId;
    res.json({
      success: true,
      data: {
        packageId: '7',
        packageVersionId: head,
        versionNumber: n,
        rolledBackSkillVersionId: v.id,
      },
    });
    return;
  }
  res.status(422).json({ message: `Unsupported fixture action ${action}` });
});
app.post('/api/arena/threads/:threadId/runs', (req, res) => {
  const threadId = Number(req.params.threadId);
  const prior = [...runs.values()].find(
    (r) => r.threadId === threadId && r.requestId === req.body.requestId,
  );
  if (prior) {
    res.json(prior);
    return;
  }
  const shared = {
    id: nextMessage++,
    threadId,
    role: 'user',
    side: 'shared',
    content: req.body.content,
    createdAt: new Date().toISOString(),
  } as ArenaMessage;
  messages.get(threadId)!.push(shared);
  const run = {
    runId: `fixture-run-${runs.size + 1}`,
    threadId,
    requestId: req.body.requestId,
    revision: 1,
    status: 'running',
    content: '',
    reasoningContent: '模拟可展示思考',
    thinkingRequested: true,
    thinkingEnabled: true,
    thinkingSupported: true,
    shared,
    messages: [],
    error: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as ArenaRunSnapshot;
  runs.set(run.runId, run);
  latest.set(threadId, run.runId);
  calls.push({
    action: 'fixture.model_execution',
    payload: { threadId, runId: run.runId },
  });
  if (!req.body.content.includes('HOLD')) finish(run);
  res.json(run);
});
app.get('/api/arena/threads/:threadId/runs', (req, res) => {
  const id = Number(req.params.threadId);
  res.json({ detail: detail(id), run: runs.get(latest.get(id) ?? '') ?? null });
});
app.get('/api/arena/threads/:threadId/runs/:runId', (req, res) => {
  const run = runs.get(String(req.params.runId));
  if (!run) {
    res.status(404).json({ error: 'missing' });
    return;
  }
  res.json(run);
});
app.get('/api/arena/threads/:threadId/runs/:runId/events', (req, res) => {
  const id = String(req.params.runId);
  const run = runs.get(id)!;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(`event: snapshot\ndata: ${JSON.stringify(run)}\n\n`);
  if (!['running', 'stopping'].includes(run.status)) {
    res.end();
    return;
  }
  if (!subscribers.has(id)) subscribers.set(id, new Set());
  subscribers.get(id)!.add(res);
  res.on('close', () => subscribers.get(id)?.delete(res));
});
app.post('/api/arena/threads/:threadId/runs/:runId/stop', (req, res) => {
  const run = runs.get(String(req.params.runId))!;
  calls.push({ action: 'fixture.explicit_stop', payload: run.runId });
  if (run.status === 'running') {
    run.status = 'cancelled';
    publish(run);
  }
  res.json(run);
});
const server = app.listen(3219, '127.0.0.1');
await new Promise<void>((done) => server.once('listening', done));
const { createServer } =
  await import('../../educlaw-web/node_modules/vite/dist/node/index.js');
const vite = await createServer({
  root: resolve(root, 'educlaw-web'),
  plugins: [
    {
      name: 'version-acceptance-entry',
      configureServer(viteServer) {
        viteServer.middlewares.use('/__version_acceptance', (_req, res) => {
          res.setHeader('Content-Type', 'text/html');
          res.end(
            '<html><head><meta charset="utf-8"><script type="module">import RefreshRuntime from "/@react-refresh";RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div><script type="module" src="/test-utils/version-management-browser-client.tsx"></script></body></html>',
          );
        });
      },
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5189,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:3219',
      '/__acceptance': 'http://127.0.0.1:3219',
    },
  },
});
await vite.listen();
console.log(
  JSON.stringify({
    event: 'version.browser.ready',
    pid: process.pid,
    url: 'http://127.0.0.1:5189/__version_acceptance',
    mode: 'actual components and HTTP with simulated APIs; no database/model',
  }),
);
