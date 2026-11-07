/** Real PostgreSQL/HTTP acceptance; --serve also opens the local web app. No model stub. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import express from 'express';
import type { AgentPackageSnapshot, AgentWorkspace, ArenaThread } from '@educlaw/shared';

const serve = process.argv.includes('--serve');
const root = fileURLToPath(new URL('../../', import.meta.url));
const reportPath = resolve(root, '.runlogs/p2-local-acceptance.json');
process.env.NODE_ENV = 'test';
// This process never borrows model credentials from the normal local setup.
process.env.LLM_API_KEY = '';
process.env.MULTIMODAL_PIPELINE_RUNNER_ENABLED = 'false';
process.env.LOG_LEVEL = 'warn';
const { isolatedPostgres } = await import('./isolated-postgres.js');
const { config } = await import('../src/config.js');
const isolation = await isolatedPostgres();
const database = new URL(config.databaseUrl);
database.hostname = '127.0.0.1';
database.pathname = `/${isolation.name}`;
config.databaseUrl = database.toString();
process.env.DATABASE_URL = config.databaseUrl;
const { query, withTransaction, closeDbPool } = await import('../src/services/db.js');
let server: Server | undefined;
let vite: { close(): Promise<void>; resolvedUrls: unknown } | undefined;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await vite?.close();
  if (server) await new Promise<void>((done) => server!.close(() => done()));
  await closeDbPool();
  await isolation.close();
}
const checks: Array<{ name: string; status: 'passed' | 'failed'; evidence?: unknown; reason?: string }> = [];
const user = 'p2-local-acceptance';
const token = 'p2-local-acceptance-token';
const info: Record<string, unknown> = {
  environment: 'real isolated PostgreSQL + production HTTP routes; no model calls',
  database: isolation.name,
  modelConfigured: false,
  user,
};
async function report() {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ ...info, checks }, null, 2));
}
async function check(name: string, work: () => Promise<unknown>) {
  try { checks.push({ name, status: 'passed', evidence: await work() }); }
  catch (error) {
    checks.push({ name, status: 'failed', reason: error instanceof Error ? error.message : String(error) });
  }
  console.log(`${checks.at(-1)!.status}: ${name}`);
  await report();
}

try {
  await (await import('../src/services/db-schema.js')).initDbSchema();
  const { createPackageWithSnapshotTx } = await import('../src/services/package-service.js');
  const snapshot: AgentPackageSnapshot = {
    name: 'P2 验收教学助手', description: '本地隔离验收数据，可检查固定版本与会话恢复。',
    versionLabel: 'v1', agentMd: 'P2_ORIGINAL_INSTRUCTIONS：先明确教学目标，再使用已启用的 Skill。', rubricMd: '',
    skills: ['lesson', 'review', 'disabled'].map((id) => ({
      id, dirName: id, name: id === 'lesson' ? '课程设计' : id === 'review' ? '教学评价' : '未启用示例',
      description: '本地验收 Skill', enabled: id !== 'disabled',
      skillMd: `---\nname: ${id}\ndescription: Local acceptance fixture\n---\n# Steps\nP2_FIXED_${id}_V1：先分析目标，再提出教学步骤。`,
    })),
  };
  const seeded = await withTransaction((client) => createPackageWithSnapshotTx(client, user, snapshot, 'manual'));
  const app = express();
  app.use(express.json());
  app.post('/auth/password', (req, res) => {
    if (req.body?.username !== 'p2-local' || req.body?.password !== 'p2-local') {
      res.status(401).json({ error: '本地验收账号和密码均为 p2-local' }); return;
    }
    res.json({ access_token: token, refresh_token: 'p2-local-refresh', token_type: 'Bearer', expires_in: 86400 });
  });
  app.get('/auth/me', (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) { res.status(401).json({ error: '请登录本地验收账号' }); return; }
    res.json({ id: user, username: 'P2 本地验收', email: 'p2-local@example.invalid', roles: [] });
  });
  app.post('/auth/logout', (_req, res) => res.json({ ok: true }));
  app.use((req, _res, next) => {
    delete req.headers['x-user-id'];
    if (req.headers.authorization === `Bearer ${token}`) req.headers['x-user-id'] = user;
    else if (req.headers.authorization === 'Bearer p2-other-user') req.headers['x-user-id'] = 'p2-other-user';
    next();
  });
  const { withRequestContext } = await import('../src/middleware/request-context.js');
  app.use(withRequestContext);
  app.use('/api', (await import('../src/routes/index.js')).default);
  app.use((await import('../src/routes/compat.js')).default);
  server = app.listen(serve ? 3219 : 0, '127.0.0.1');
  await new Promise<void>((done, reject) => { server!.once('listening', done); server!.once('error', reject); });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  Object.assign(info, { apiUrl: base, packageId: seeded.packageId, packageVersionId: seeded.packageVersionId });
  async function request<T = Record<string, unknown>>(path: string, method = 'GET', body?: unknown, bearer = token) {
    const response = await fetch(`${base}${path}`, {
      method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    return { status: response.status, body: await response.json() as T };
  }
  const agentPath = `/api/agent-workspaces/${seeded.packageId}`;
  async function agent() {
    const result = await request<AgentWorkspace>(agentPath); assert.equal(result.status, 200); return result.body;
  }
  async function save(changes: Partial<AgentWorkspace>) {
    const current = await agent();
    const result = await request<AgentWorkspace>(agentPath, 'PUT', {
      name: current.name, description: current.description, instructions: current.instructions, model: current.model,
      skills: current.skills.map(({ skillId, skillVersionId, enabled }) => ({ skillId, skillVersionId, enabled })),
      ...changes, expectedUpdatedAt: current.updatedAt,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body;
  }
  async function conversation(requestId = randomUUID(), purpose = 'run') {
    return request<ArenaThread>(`${agentPath}/conversations`, 'POST', { purpose, requestId });
  }
  let first!: ArenaThread;
  let fixedExecution: unknown;
  await check('concurrent requestId creates one persisted snapshot with enabled Skills and default model', async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 24 }, () => conversation(key)));
    for (const result of responses) assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(new Set(responses.map((result) => String(result.body.id))).size, 1);
    first = responses[0]!.body;
    const rows = await query('select model, arena_config_jsonb from arena_threads where user_id=$1 and arena_config_jsonb->>\'agentRequestId\'=$2', [user, key]);
    assert.equal(rows.rows.length, 1);
    const execution = rows.rows[0]!.arena_config_jsonb.agentExecution;
    assert.equal(execution.instructions, snapshot.agentMd);
    assert.equal(execution.model, config.llmModel); assert.equal(rows.rows[0]!.model, config.llmModel);
    assert.deepEqual(execution.skills.map((skill: { skillUid: string }) => skill.skillUid), ['lesson', 'review']);
    for (const skill of execution.skills) {
      assert(skill.skillVersionId); assert(skill.versionNumber); assert(skill.skillMd.includes(`P2_FIXED_${skill.skillUid}_V1`));
    }
    fixedExecution = structuredClone(execution);
    const mismatch = await conversation(key, 'test'); assert.equal(mismatch.status, 409);
    return { threadId: first.id, concurrentRequests: 24, persistedRows: 1, enabledSkills: 2, defaultModel: execution.model, purposeConflict: 409 };
  });
  await check('old conversation retains its complete snapshot after Agent configuration changes', async () => {
    assert(first, 'snapshot creation prerequisite failed');
    await save({ instructions: 'P2_NEW_INSTRUCTIONS：这是修改后的 Agent 配置。', model: 'p2-updated-model' });
    const detail = await request<{ thread: ArenaThread }>(`/api/arena/threads/detail?threadId=${first.id}`);
    assert.equal(detail.status, 200); assert.deepEqual(detail.body.thread.skillArenaConfig?.agentExecution, fixedExecution);
    const created = await conversation(); assert.equal(created.status, 200);
    assert.equal(created.body.skillArenaConfig?.agentExecution?.instructions, 'P2_NEW_INSTRUCTIONS：这是修改后的 Agent 配置。');
    assert.equal(created.body.skillArenaConfig?.agentExecution?.model, 'p2-updated-model');
    return { originalThreadId: first.id, newThreadId: created.body.id, fixedExecutionUnchanged: true };
  });
  await check('all disabled returns readable 422; re-enabling restores conversation creation', async () => {
    const current = await agent();
    await save({ skills: current.skills.map((skill) => ({ ...skill, enabled: false })) });
    const disabled = await request(`${agentPath}/conversations`, 'POST', { purpose: 'run', requestId: randomUUID() });
    assert.equal(disabled.status, 422); assert.equal(disabled.body.code, 'NO_ENABLED_SKILLS'); assert.match(String(disabled.body.error), /启用/);
    const stopped = await agent();
    await save({ skills: stopped.skills.map((skill) => ({ ...skill, enabled: skill.name !== '未启用示例' })) });
    assert.equal((await conversation()).status, 200);
    return { disabledStatus: 422, code: disabled.body.code, restoredStatus: 200 };
  });
  await check('discarded pinned Skill blocks new conversations while persisted history stays readable', async () => {
    const bound = (await agent()).skills.find((skill) => skill.enabled)!;
    await query("update agent_skill_versions set status='discarded',discarded_at=now(),discarded_by=$2,discard_reason='P2 acceptance' where id=$1", [bound.skillVersionId, user]);
    try {
      const result = await request(`${agentPath}/conversations`, 'POST', { purpose: 'run', requestId: randomUUID() });
      assert.equal(result.status, 422); assert.equal(result.body.code, 'SKILL_UNAVAILABLE'); assert.match(String(result.body.error), /重新保存/);
      const old = await request<{ thread: ArenaThread }>(`/api/arena/threads/detail?threadId=${first.id}`);
      assert.equal(old.status, 200); assert.deepEqual(old.body.thread.skillArenaConfig?.agentExecution, fixedExecution);
      return { newStatus: 422, code: result.body.code, oldHistoryStatus: 200 };
    } finally { await query("update agent_skill_versions set status='active',discarded_at=null,discarded_by=null,discard_reason=null where id=$1", [bound.skillVersionId]); }
  });
  await check('legacy skill_arena remains readable with its pinned version', async () => {
    const rows = await query('select id from agent_package_skills where package_id=$1 and skill_uid=$2', [seeded.packageId, 'lesson']);
    const skillId = String(rows.rows[0]!.id);
    const skillVersionId = seeded.skillVersionIds.lesson!;
    const legacyConfig = { mode: 'skill_arena', compositionMode: 'skill_only', surface: 'run', basePackageVersionId: String(seeded.packageVersionId), left: null, right: { side: 'right', skillId, skillVersionId, skillUid: 'lesson', skillName: '课程设计', versionNumber: 1 } };
    const inserted = await query("insert into arena_threads(user_id,package_id,title,model,arena_kind,base_package_version_id,arena_config_jsonb,created_at,updated_at) values($1,$2,'P2 旧 Skill 会话（验收数据）',$3,'skill_arena',$4,$5,now(),now()) returning id", [user, seeded.packageId, config.llmModel, seeded.packageVersionId, JSON.stringify(legacyConfig)]);
    const id = inserted.rows[0]!.id;
    await query("insert into arena_thread_variants(thread_id,package_id,side,skill_id,skill_version_id,created_at) values($1,$2,'right',$3,$4,now())", [id, seeded.packageId, skillId, skillVersionId]);
    for (const [side, role, content] of [
      ['shared', 'user', '请设计一节合作学习课程（历史验收样例）。'],
      ['enhanced', 'assistant', '本地历史验收样例：先明确合作目标，再分组分工，最后开展共同评价。此内容为预置数据，未调用模型。'],
    ]) await query('insert into arena_messages(thread_id,user_id,side,role,content,created_at) values($1,$2,$3,$4,$5,now())', [id, user, side, role, content]);
    const comparisonConfig = { ...legacyConfig, surface: 'arena', left: { ...legacyConfig.right, side: 'left' } };
    const comparison = await query("insert into arena_threads(user_id,package_id,title,model,arena_kind,base_package_version_id,arena_config_jsonb,created_at,updated_at) values($1,$2,'P2 旧对比会话（验收数据）',$3,'skill_arena',$4,$5,now(),now()) returning id", [user, seeded.packageId, config.llmModel, seeded.packageVersionId, JSON.stringify(comparisonConfig)]);
    const comparisonId = comparison.rows[0]!.id;
    for (const side of ['left', 'right']) await query('insert into arena_thread_variants(thread_id,package_id,side,skill_id,skill_version_id,created_at) values($1,$2,$3,$4,$5,now())', [comparisonId, seeded.packageId, side, skillId, skillVersionId]);
    for (const [side, role, content] of [
      ['shared', 'user', '比较两种教学设计（旧对比会话验收样例）。'],
      ['baseline', 'assistant', '左侧历史验收样例：先讲解概念，再完成练习。此内容为预置数据，未调用模型。'],
      ['enhanced', 'assistant', '右侧历史验收样例：围绕学习目标组织合作任务，再开展反馈。此内容为预置数据，未调用模型。'],
    ]) await query('insert into arena_messages(thread_id,user_id,side,role,content,created_at) values($1,$2,$3,$4,$5,now())', [comparisonId, user, side, role, content]);
    const result = await request<{ thread: ArenaThread; messages: unknown[] }>('/api', 'POST', { action: 'arena.thread.detail', pkgId: String(seeded.packageId), payload: { threadId: String(id) } });
    assert.equal(result.status, 200);
    const data = (result.body as unknown as { data: { thread: ArenaThread } }).data;
    assert.equal(data.thread.skillArenaConfig?.right?.skillVersionId, skillVersionId);
    assert.equal(data.thread.skillArenaConfig?.agentExecution, undefined);
    const oldComparison = await request<{ thread: ArenaThread; messages: unknown[] }>(`/api/arena/threads/detail?threadId=${comparisonId}`);
    assert.equal(oldComparison.status, 200); assert.equal(oldComparison.body.messages.length, 3);
    assert.equal(oldComparison.body.thread.skillArenaConfig?.left?.skillVersionId, skillVersionId);
    info.legacyThreadId = id; info.legacyArenaThreadId = comparisonId; info.legacySkillId = skillId;
    return { threadId: id, comparisonThreadId: comparisonId, pinnedSkillVersionId: skillVersionId, persistedMessages: 5, historyStatus: 200 };
  });
  await check('all retired conversation-creation HTTP entrances return 422 without inserting a thread', async () => {
    const before = Number((await query('select count(*) from arena_threads where user_id=$1', [user])).rows[0]!.count);
    const paths = ['/api/arena/threads/create', '/arena/chat/profile/1', '/arena/chat/skill/lesson', '/arena/chat/agent/1'];
    for (const path of paths) { const result = await request(path, 'POST', { packageId: String(seeded.packageId) }); assert.equal(result.status, 422, path); assert.equal(result.body.code, 'AGENT_REQUIRED', path); }
    for (const surface of [undefined, 'run', 'test', 'arena']) {
      const result = await request('/api', 'POST', { action: 'arena.thread.create', pkgId: String(seeded.packageId), payload: { surface } });
      assert.equal(result.status, 422); assert.equal(result.body.code, 'AGENT_REQUIRED');
    }
    const after = Number((await query('select count(*) from arena_threads where user_id=$1', [user])).rows[0]!.count);
    assert.equal(after, before); return { blockedEntrances: 8, noNewThreads: true };
  });
  await check('another user cannot read or create this Agent conversation', async () => {
    assert.equal((await request(agentPath, 'GET', undefined, 'p2-other-user')).status, 404);
    assert.equal((await request(`${agentPath}/conversations`, 'POST', { purpose: 'run', requestId: randomUUID() }, 'p2-other-user')).status, 404);
    return { readStatus: 404, createStatus: 404 };
  });
  info.passed = checks.filter((item) => item.status === 'passed').length;
  info.failed = checks.filter((item) => item.status === 'failed').length;
  await report();
  if (checks.some((item) => item.status === 'failed')) { process.exitCode = 1; }
  if (serve) {
    // Reset the current model to the normal default before handing the UI to the user.
    await save({ model: '' });
    const webRoot = resolve(root, 'educlaw-web');
    const webRequire = createRequire(resolve(webRoot, 'package.json'));
    const { createServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
    const prefixes = ['/auth', '/api', '/packages', '/arena', '/optimize', '/profiles', '/agents', '/runtimes', '/llm', '/events', '/admin'];
    const proxy = Object.fromEntries(prefixes.map((prefix) => [prefix, {
      target: base, changeOrigin: true,
      ...(prefix === '/agents' ? { bypass(req: { headers: { accept?: string } }) { if (req.headers.accept?.includes('text/html')) return '/index.html'; } } : {}),
    }]));
    vite = await createServer({ root: webRoot, configFile: resolve(webRoot, 'vite.config.ts'), server: { host: '127.0.0.1', port: 5189, strictPort: true, proxy } });
    await (vite as unknown as { listen(): Promise<void> }).listen();
    Object.assign(info, { webUrl: 'http://localhost:5189/agents', login: 'p2-local / p2-local', serving: true });
    await report();
    console.log(`P2 UI: ${info.webUrl}\nLocal acceptance login: p2-local / p2-local\nIsolated database: ${isolation.name}\nReport: ${reportPath}`);
    await new Promise<void>((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); });
    info.serving = false;
    await report();
  }
} finally { await cleanup(); }
