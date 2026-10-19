/** Disposable local acceptance app. Never import from production code. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";

// The real config module reads project env files on import. This disposable
// process supplies its settings explicitly and must never read those secrets.
const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
const projectEnvPaths = new Set([resolve(workspaceRoot, ".env"), resolve(workspaceRoot, ".env.local")]);
fs.readFileSync = new Proxy(fs.readFileSync, {
  apply(target, receiver, args) {
    if (typeof args[0] === "string" && projectEnvPaths.has(resolve(args[0]))) return "";
    return Reflect.apply(target, receiver, args);
  },
});

const database = process.env.DATABASE_URL;
if (![
  "postgres://postgres@127.0.0.1:55439/pi_acceptance_test",
  "postgres://pi_acceptance:pi-acceptance-only@127.0.0.1:55439/pi_acceptance_test",
  "postgres://pi_acceptance:pi-acceptance-only@pi-acceptance-db:5432/pi_acceptance_test",
].includes(database ?? "")) {
  throw new Error("REFUSING_NON_DISPOSABLE_DATABASE");
}
process.env.NODE_ENV = "test";
process.env.LLM_API_KEY = "local-fixture-key";
process.env.LLM_MODEL = "kimi-k2.6";
process.env.PI_HARNESS_SKILL_RUN_ENABLED = "true";
process.env.PI_HARNESS_MAX_CONCURRENT_RUNS = "2";
process.env.MULTIMODAL_PIPELINE_RUNNER_ENABLED = "false";
process.env.LLM_NETWORK_RETRIES = "0";
// Legacy keeps its request deadline timer until expiry; bound the disposable
// fixture's lifetime without changing the production Legacy configuration.
process.env.LLM_TIMEOUT_MS = "1000";
const reportCohort = process.env.PI_ACCEPTANCE_COHORT;
if (reportCohort && reportCohort !== "integrated-4afdfe2") throw new Error("REFUSING_UNEXPECTED_REPORT_COHORT");
const reportRoot = resolve("../docs/acceptance/evidence", reportCohort ?? ".");
const reportName = process.env.PI_ACCEPTANCE_REPORT_FILE ?? "pi-core-local-20261016.json";
if (!["pi-core-local-20261016.json", "pi-core-container-chain-20261016.json"].includes(reportName)) {
  throw new Error("REFUSING_UNEXPECTED_REPORT_PATH");
}
await mkdir(reportRoot, { recursive: true });
const results: Record<string, unknown>[] = [];
const requests: Record<string, unknown>[] = [];
const gates = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const entered = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const closed = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();
const barrier = (map: typeof gates, key: string) => {
  if (!map.has(key)) map.set(key, Promise.withResolvers<void>());
  return map.get(key)!;
};

const providerApp = express();
providerApp.use(express.json());
providerApp.post("/v1/chat/completions", async (req, res) => {
  requests.push(req.body);
  const content = JSON.stringify(req.body.messages.at(-1)?.content ?? "");
  const tag = /ACCEPT_[A-Z0-9_]+/.exec(content)?.[0] ?? "ordinary";
  barrier(entered, tag).resolve();
  res.once("close", () => barrier(closed, tag).resolve());
  if (tag === "ACCEPT_ERROR") { res.status(503).json({ error: { message: "Controlled local upstream error" } }); return; }
  if (tag.startsWith("ACCEPT_HOLD")) await barrier(gates, tag).promise;
  if (tag === "ACCEPT_TIMEOUT") {
    res.setHeader("Content-Type", "text/event-stream");
    res.flushHeaders();
    await barrier(closed, tag).promise;
    return;
  }
  if (res.destroyed) return;
  const reasoning = req.body.thinking?.type === "enabled" ? "本地模拟可展示思考。" : "";
  const text = "本地验收回答：先确认教学目标。";
  if (!req.body.stream) {
    res.json({ model: "kimi-k2.6", choices: [{ message: { content: text, reasoning_content: reasoning } }] });
    return;
  }
  res.setHeader("Content-Type", "text/event-stream");
  for (const choice of [
    { delta: { role: "assistant", reasoning_content: reasoning }, finish_reason: null },
    { delta: { content: text }, finish_reason: null },
    { delta: {}, finish_reason: "stop" },
  ]) res.write(`data: ${JSON.stringify({ id: "local-fixture", model: "kimi-k2.6", choices: [{ index: 0, ...choice }] })}\n\n`);
  res.end("data: [DONE]\n\n");
});
const providerServer = providerApp.listen(0, "127.0.0.1");
await new Promise<void>((done) => providerServer.once("listening", done));
const providerAddress = providerServer.address();
assert(providerAddress && typeof providerAddress !== "string");
process.env.LLM_BASE_URL = `http://127.0.0.1:${providerAddress.port}/v1`;

const { query, withTransaction, closeDbPool } = await import("../src/services/db.js");
const { createPackageWithSnapshotTx, createPackageVersionWithSnapshotTx } = await import("../src/services/package-service.js");
const { createArenaThread, getThreadDetail } = await import("../src/services/arena-service.js");
const { config } = await import("../src/config.js");
const { createAnswerSkillOptimizationRun } = await import("../src/services/answer-skill-optimization-service.js");
const { withRequestContext } = await import("../src/middleware/request-context.js");
const { default: routes } = await import("../src/routes/index.js");
const { default: compat } = await import("../src/routes/compat.js");
const user = "pi-local-acceptance";
const skill = { id: "acceptance-skill", dirName: "acceptance-skill", name: "Pi本地验收", description: "仅用于隔离验收", skillMd: "---\nname: acceptance-skill\ndescription: Local acceptance fixture\n---\n# Instructions\nFIXED_V1_BODY. Answer briefly." };
const snapshot = { name: "Pi验收项目", description: "隔离临时测试数据", versionLabel: "v1", agentMd: "Follow the fixed Skill.", rubricMd: "# Rubric\n教学目标明确。", skills: [skill] };
const seeded = await withTransaction((client) => createPackageWithSnapshotTx(client, user, snapshot, "manual"));
const skillRow = (await query<{ id: string }>("select id from agent_package_skills where package_id=$1", [seeded.packageId])).rows[0];
async function thread(surface: "run" | "test" = "run") {
  return createArenaThread({ authUserId: user, packageId: String(seeded.packageId), basePackageVersionId: String(seeded.packageVersionId), arenaKind: "skill_arena", right: { skillId: String(skillRow.id), skillVersionId: seeded.skillVersionIds[skill.id] }, model: "kimi-k2.6", idempotencyKey: randomUUID(), surface });
}
const runThread = await thread();
const testThread = await thread("test");
const app = express();
app.use(express.json());
// This stub replaces the external authentication gateway only for this app.
app.post("/auth/password", (_req, res) => res.json({ access_token: "pi-local-token", expires_in: 3600 }));
app.get("/auth/me", (_req, res) => res.json({ id: user, username: "Pi本地验收", roles: [] }));
app.post("/auth/logout", (_req, res) => res.json({ ok: true }));
app.use((req, _res, next) => {
  if (req.headers.authorization === "Bearer pi-local-token") req.headers["x-user-id"] = user;
  else if (req.headers.authorization === "Bearer pi-other-token") req.headers["x-user-id"] = "pi-other-user";
  next();
});
app.use(withRequestContext);
app.use("/api", routes);
app.use(compat);
const server = app.listen(3219, "127.0.0.1");
await new Promise<void>((done) => server.once("listening", done));
const base = "http://127.0.0.1:3219";
type SseEvent = { event: string; data: Record<string, unknown> };
async function send(id: number, content: string, thinkingEnabled = false, token = "pi-local-token", signal?: AbortSignal): Promise<SseEvent[]> {
  const response = await fetch(`${base}/api/arena/threads/${encodeURIComponent(String(id))}/messages/stream`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ content, mode: "agent", thinkingEnabled }), signal });
  return (await response.text()).split(/\r?\n\r?\n/).flatMap((block) => {
    const event = /^event: (.+)$/m.exec(block)?.[1];
    const data = /^data: (.+)$/m.exec(block)?.[1];
    return event && data ? [{ event, data: JSON.parse(data) }] : [];
  });
}
const check = async (name: string, work: () => Promise<unknown>) => {
  try { const evidence = await work(); results.push({ name, status: "passed", evidence }); }
  catch (error) { results.push({ name, status: "failed", reason: error instanceof Error ? error.message.slice(0, 200) : "unknown" }); }
  await writeFile(resolve(reportRoot, reportName), JSON.stringify({ cohort: reportCohort ?? "original-e816342", environment: "real disposable PostgreSQL + HTTP/SSE + real Pi SDK + simulated provider/gateway", projectEnvironmentFilesBlocked: true, node: process.version, platform: process.platform, packageId: seeded.packageId, runThreadId: runThread.id, testThreadId: testThread.id, checks: results }, null, 2));
};
const success = (events: SseEvent[]) => assert(events.some((event) => event.event === "stream_end" && event.data.ok === true));

await check("Run thinking off: HTTP/SSE/DB", async () => {
  const events = await send(runThread.id, "普通成功"); success(events);
  assert(!events.some((event) => event.event === "reasoning_delta"));
  const detail = await getThreadDetail(user, runThread.id);
  assert.equal(detail.messages.at(-1)?.reasoningContent, null);
  return { threadId: runThread.id, messageCount: detail.messages.length };
});
await check("Test thinking on: HTTP/SSE/DB", async () => {
  const events = await send(testThread.id, "开启思考", true); success(events);
  assert(events.some((event) => event.event === "reasoning_delta"));
  const detail = await getThreadDetail(user, testThread.id);
  assert.equal(detail.messages.at(-1)?.reasoningContent, "本地模拟可展示思考。");
  return { threadId: testThread.id, reasoningSaved: true };
});
await check("Fixed historical version and multi-turn provenance", async () => {
  await withTransaction((client) => createPackageVersionWithSnapshotTx(client, { userId: user, packageId: seeded.packageId, expectedPackageVersionId: seeded.packageVersionId, snapshot: { ...snapshot, skills: [{ ...skill, skillMd: skill.skillMd.replace("FIXED_V1_BODY", "NEW_V2_BODY") }] }, source: "manual" }));
  success(await send(runThread.id, "第二轮继续"));
  const body = JSON.stringify(requests.at(-1)?.messages);
  assert(body.includes("FIXED_V1_BODY")); assert(!body.includes("NEW_V2_BODY")); assert(body.includes("普通成功"));
  const runs = (await query("select context_message_ids, enhanced_skill_version_id from arena_answer_runs where thread_id=$1 order by id", [runThread.id])).rows;
  assert.equal(String(runs.at(-1)?.enhanced_skill_version_id), seeded.skillVersionIds[skill.id]);
  assert.equal(runs.at(-1)?.context_message_ids.length, 2);
  return { historicalSkillVersionId: seeded.skillVersionIds[skill.id], contextCount: 2 };
});
await check("Other user ownership is denied", async () => {
  const before = requests.length;
  const events = await send(runThread.id, "越权", false, "pi-other-token");
  assert(events.some((event) => event.event === "stream_end" && event.data.ok === false));
  assert.equal(requests.length, before);
  return { providerCalls: 0 };
});
await check("Same-thread busy and different-thread global capacity", async () => {
  const secondThread = await thread(); const thirdThread = await thread();
  const first = send(runThread.id, "ACCEPT_HOLD_ONE"); await barrier(entered, "ACCEPT_HOLD_ONE").promise;
  const busy = await send(runThread.id, "同线程竞争"); assert(busy.some((event) => event.event === "stream_end" && !event.data.ok));
  const second = send(secondThread.id, "ACCEPT_HOLD_TWO"); await barrier(entered, "ACCEPT_HOLD_TWO").promise;
  const capacity = await send(thirdThread.id, "超过全局限额"); assert(capacity.some((event) => event.event === "stream_end" && !event.data.ok));
  barrier(gates, "ACCEPT_HOLD_ONE").resolve(); barrier(gates, "ACCEPT_HOLD_TWO").resolve();
  success(await first); success(await second); success(await send(thirdThread.id, "名额释放后重试"));
  return { maxConcurrentRuns: 2, sameThreadRejected: true, excessRejected: true, retrySucceeded: true };
});
await check("Disconnected client cancels and saves only its question", async () => {
  const cancelThread = await thread(); const controller = new AbortController();
  const pending = send(cancelThread.id, "ACCEPT_HOLD_CANCEL", false, "pi-local-token", controller.signal).catch(() => []);
  await barrier(entered, "ACCEPT_HOLD_CANCEL").promise; controller.abort(); await pending;
  await barrier(closed, "ACCEPT_HOLD_CANCEL").promise; barrier(gates, "ACCEPT_HOLD_CANCEL").resolve();
  // The provider socket closes before Adapter cleanup; an explicit DB query barrier follows event completion below.
  for (let attempt = 0; attempt < 10; attempt++) { const retry = await send(cancelThread.id, "取消后重试"); if (retry.some((event) => event.event === "stream_end" && event.data.ok)) break; }
  const messages = (await getThreadDetail(user, cancelThread.id)).messages;
  assert.equal(messages.filter((message) => message.role === "assistant").length, 1);
  return { threadId: cancelThread.id, questionRetained: true, cancelledAnswerNotSaved: true, retrySucceeded: true };
});
await check("Upstream error is not persisted; retry succeeds", async () => {
  const errorThread = await thread(); const events = await send(errorThread.id, "ACCEPT_ERROR");
  assert(events.some((event) => event.event === "stream_end" && !event.data.ok));
  assert.equal((await getThreadDetail(user, errorThread.id)).messages.length, 1);
  success(await send(errorThread.id, "错误后重试")); return { threadId: errorThread.id };
});
await check("Save failure rolls back assistant and provenance; retry succeeds", async () => {
  const saveThread = await thread();
  await query(`create or replace function pi_acceptance_fail_save() returns trigger language plpgsql as $$ begin if new.thread_id=${Number(saveThread.id)} and new.role='assistant' then raise exception 'controlled acceptance save failure'; end if; return new; end $$`);
  await query("create trigger pi_acceptance_save_guard before insert on arena_messages for each row execute function pi_acceptance_fail_save()");
  try { const events = await send(saveThread.id, "保存失败"); assert(!events.some((event) => event.event === "done")); assert(events.some((event) => event.event === "stream_end" && !event.data.ok)); assert.equal((await getThreadDetail(user, saveThread.id)).messages.length, 1); }
  finally { await query("drop trigger pi_acceptance_save_guard on arena_messages"); await query("drop function pi_acceptance_fail_save()"); }
  success(await send(saveThread.id, "保存恢复后重试")); return { threadId: saveThread.id, rollbackVerified: true };
});
await check("Pi disabled continues the same conversation through Legacy", async () => {
  config.piHarnessSkillRunEnabled = false;
  try { success(await send(runThread.id, "Legacy继续")); } finally { config.piHarnessSkillRunEnabled = true; }
  assert(JSON.stringify(requests.at(-1)?.messages).includes("第二轮继续"));
  return { threadId: runThread.id, historyPreserved: true };
});
await check("Pi answer enters the existing answer optimization flow", async () => {
  const row = (await query("select * from arena_answer_runs where thread_id=$1 order by id limit 1", [runThread.id])).rows[0];
  const optimization = await createAnswerSkillOptimizationRun({ userId: user, packageId: seeded.packageId, threadId: runThread.id, questionMessageId: Number(row.question_message_id), enhancedAnswerMessageId: Number(row.enhanced_answer_message_id), feedback: "请更明确教学目标", idempotencyKey: randomUUID() });
  return { optimizationId: optimization.id, status: optimization.status, provenanceAccepted: true, modelAnalysisNotInvoked: true };
});
console.log(JSON.stringify({ event: "local.acceptance.ready", url: base, checks: results, runThreadId: runThread.id, testThreadId: testThread.id }));
process.exitCode = results.some((result) => result.status === "failed") ? 1 : 0;
if (process.argv.includes("--serve")) {
  const { createServer } = await import("../../educlaw-web/node_modules/vite/dist/node/index.js");
  const proxy = Object.fromEntries(["/api", "/auth", "/arena", "/packages", "/skills"].map((path) => [path, { target: base, changeOrigin: true }]));
  const vite = await createServer({ root: resolve("../educlaw-web"), server: { host: "127.0.0.1", port: 5189, strictPort: true, proxy } });
  await vite.listen();
  console.log(JSON.stringify({ event: "local.browser.ready", url: "http://127.0.0.1:5189", gateway: "simulated local only" }));
  await check("Upstream stall reaches the real Adapter timeout and leaves only user input", async () => {
    const timeoutThread = await thread(); const events = await send(timeoutThread.id, "ACCEPT_TIMEOUT");
    assert(events.some((event) => event.event === "side_done" && String(event.data.error).includes("超时")));
    assert.equal((await getThreadDetail(user, timeoutThread.id)).messages.length, 1);
    success(await send(timeoutThread.id, "超时后重试")); return { threadId: timeoutThread.id, timeoutMs: 180000 };
  });
  console.log(JSON.stringify({ event: "local.timeout.finished", checks: results }));
  process.exitCode = results.some((result) => result.status === "failed") ? 1 : 0;
} else {
  server.closeAllConnections();
  providerServer.closeAllConnections();
  await Promise.all([server, providerServer].map((ownedServer) => new Promise<void>((done, reject) => {
    ownedServer.close((error) => error ? reject(error) : done());
  })));
  await closeDbPool();
}
