import { Router, type Request, type Response } from "express";
import type { AuthedRequest } from "../types.js";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../services/db.js";
import { listPackages, getPackage, generatePackage, deletePackage, exportPackageZip, importPackageZip } from "../services/package-service.js";
import { listThreads, createThread, getThreadDetail, sendMessage, streamMessage, generateReport } from "../services/arena-service.js";
import { optimizePackage } from "../services/optimization-service.js";
import { config } from "../config.js";
import { parseDbJson } from "../utils/json.js";
import {
  initSse,
  startSseHeartbeat,
  stopSseHeartbeat,
  writeSseEvent,
} from "../utils/sse.js";

const router: import("express").Router = Router();

/* ─── Helpers ─── */

function ok(res: Response, data: unknown) { res.json(data); }
function bad(res: Response, message: string) { res.status(400).json({ error: message }); }
function notFound(res: Response, message = "Not found") { res.status(404).json({ error: message }); }
function retired(res: Response, feature: string) {
  res.status(410).json({
    code: "FEATURE_RETIRED",
    error: `${feature} 已停用，请使用当前工作区功能`,
  });
}

function pickUserId(req: Request) {
  return (req as AuthedRequest).userId || "";
}

type CompatOptimizeRunView = {
  applied_keys: string[];
  rejected_keys: string[];
  suggestions: Array<{ key: string }>;
  run: { status: string };
  [key: string]: unknown;
};

function emptyOptimizeRunView(): CompatOptimizeRunView {
  return {
    applied_keys: [],
    rejected_keys: [],
    suggestions: [],
    run: { status: "pending" },
  };
}

function calcTurnIndex(messages: Array<{ side: string; role: string; created_at?: string; createdAt?: string }>) {
  let turn = 0;
  const result: number[] = [];
  for (const m of messages) {
    if (m.side === "shared" && m.role === "user") turn++;
    result.push(turn);
  }
  return result;
}

function threadToSession(thread: Awaited<ReturnType<typeof listThreads>>[0]) {
  return {
    id: thread.id,
    user_id: thread.packageId,
    target_kind: "profile" as const,
    target_ref: thread.packageId,
    model: thread.model,
    status: "completed" as const,
    created_at: thread.createdAt,
    updated_at: thread.updatedAt,
  };
}

/* ─── LLM Models ─── */

router.get("/llm/models", (_req, res) => {
  const models: Array<{ name: string; modelName: string }> = [];
  if (config.llmModel) {
    models.push({ name: config.llmModel, modelName: config.llmModel });
  }
  ok(res, models);
});

/* ─── Runtimes ─── */

router.get("/runtimes", (_req, res) => retired(res, "旧运行时管理"));
router.get("/profiles", requireAuth, async (req, res) => {
  try {
    const packages = await listPackages(pickUserId(req));
    ok(res, packages.map((p) => ({ fileName: p.id, name: p.name, description: p.description, details: "", agent_runtime: "default", agent_template: "default", tools: [], skills: [], subagents: [], isPublished: false, publishedName: null })));
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});
router.get("/agents", requireAuth, async (_req, res) => retired(res, "旧 Agent 管理"));
router.get("/api/chat/sessions", requireAuth, async (_req, res) => retired(res, "旧聊天会话"));
router.get("/api/events", (_req, res) => retired(res, "旧事件流"));
router.get("/events", (_req, res) => retired(res, "旧事件流"));

router.get("/api/sidebar-groups", requireAuth, async (_req, res) => retired(res, "旧侧栏分组"));
router.post("/api/sidebar-groups", requireAuth, async (_req, res) => retired(res, "旧侧栏分组"));
router.patch("/api/sidebar-groups/:id", requireAuth, async (_req, res) => retired(res, "旧侧栏分组"));
router.delete("/api/sidebar-groups/:id", requireAuth, async (_req, res) => retired(res, "旧侧栏分组"));
router.post("/api/sidebar-groups/:groupId/items", requireAuth, async (_req, res) => retired(res, "旧侧栏分组"));
router.delete("/api/sidebar-groups/:groupId/items/:itemId/:itemType", requireAuth, async (_req, res) => retired(res, "旧侧栏分组"));
router.post("/api/sidebar-groups/move-item", requireAuth, async (_req, res) => retired(res, "旧侧栏分组"));

/* ─── Agents (stub) ─── */

router.post("/agents", requireAuth, (_req, res) => retired(res, "旧 Agent 管理"));
router.post("/agents/:id/delete", requireAuth, (_req, res) => retired(res, "旧 Agent 管理"));
router.post("/agents/:id/start", requireAuth, (_req, res) => retired(res, "旧 Agent 管理"));
router.post("/agents/:id/stop", requireAuth, (_req, res) => retired(res, "旧 Agent 管理"));
router.post("/agents/:id/sync-db", requireAuth, (_req, res) => retired(res, "旧 Agent 管理"));
router.post("/agents/:id/settings", requireAuth, (_req, res) => retired(res, "旧 Agent 管理"));
router.get("/agents/:id/files", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));
router.get("/agents/:id/file-content", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));
router.put("/agents/:id/file-content", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));
router.post("/agents/:id/fs/create-file", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));
router.post("/agents/:id/fs/create-dir", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));
router.post("/agents/:id/fs/rename", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));
router.post("/agents/:id/fs/delete", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));
router.post("/agents/:id/fs/upload", requireAuth, (_req, res) => retired(res, "旧 Agent 文件管理"));

/* ─── Profiles ─── */

router.get("/profiles/user", requireAuth, async (req, res) => {
  try {
    const packages = await listPackages(pickUserId(req));
    ok(res, packages.map((p) => ({
      fileName: p.id,
      name: p.name,
      description: p.description,
      details: "",
      agent_runtime: "default",
      agent_template: "default",
      tools: [],
      skills: [],
      subagents: [],
      isPublished: false,
      publishedName: null,
    })));
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/profiles/user", requireAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const pkg = await generatePackage(pickUserId(req), body.name || body.description || "New agent package");
    ok(res, { fileName: pkg.id });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.put("/profiles/user/:fileName", requireAuth, async (req, res) => {
  void req;
  retired(res, "旧资料更新接口");
});

router.post("/profiles/user/:fileName/delete", requireAuth, async (req, res) => {
  try {
    await deletePackage(pickUserId(req), String(req.params.fileName));
    ok(res, { ok: true });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/profiles/user/copy", requireAuth, async (req, res) => {
  try {
    const source = await getPackage(pickUserId(req), String(req.body?.sourceFileName || ""));
    const pkg = await generatePackage(pickUserId(req), `Copy of ${source.name}`);
    ok(res, { fileName: pkg.id });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.get("/profiles/user/:fileName/export", requireAuth, async (req, res) => {
  try {
    const data = await exportPackageZip(pickUserId(req), String(req.params.fileName));
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${String(req.params.fileName)}.zip"`);
    res.send(data);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

import multer from "multer";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimitBytes } });

router.post("/profiles/user/import", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) { bad(res, "Please upload a ZIP file"); return; }
    const pkg = await importPackageZip(pickUserId(req), req.file.buffer);
    ok(res, { fileName: pkg.id });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/profiles/published/:fileName", requireAuth, async (_req, res) => retired(res, "旧发布接口"));
router.post("/profiles/published/:fileName/delete", requireAuth, async (_req, res) => retired(res, "旧发布接口"));

/* ─── Arena (legacy stubs) ─── */

router.post("/arena/profile/:fileName", requireAuth, async (_req, res) => retired(res, "旧 Arena 运行接口"));
router.post("/arena/skill/:dirName", requireAuth, async (_req, res) => retired(res, "旧 Arena 运行接口"));
router.post("/arena/agent/:id", requireAuth, async (_req, res) => retired(res, "旧 Arena 运行接口"));

router.get("/arena/runs", requireAuth, async (_req, res) => retired(res, "旧 Arena 运行记录"));
router.get("/arena/runs/:runId", requireAuth, async (_req, res) => retired(res, "旧 Arena 运行记录"));
router.post("/arena/runs/:runId/delete", requireAuth, async (_req, res) => retired(res, "旧 Arena 运行记录"));

/* ─── Arena Chat ─── */

async function findPackageByRef(userId: string, ref: string) {
  try { return await getPackage(userId, ref); } catch { return null; }
}

router.post("/arena/chat/profile/:fileName", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const pkg = await findPackageByRef(userId, String(req.params.fileName));
    if (!pkg) { notFound(res, "Profile not found"); return; }
    const thread = await createThread(userId, pkg.id, req.body?.model);
    const detail = await getThreadDetail(userId, thread.id);
    const turnIndexes = calcTurnIndex(detail.messages);
    ok(res, {
      session: threadToSession(thread),
      messages: detail.messages.map((m, i) => ({
        id: m.id,
        arena_session_id: m.threadId,
        user_id: userId,
        side: m.side,
        role: m.role,
        content: m.content,
        turn_index: turnIndexes[i],
        created_at: m.createdAt,
      })),
    });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/arena/chat/skill/:dirName", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const packages = await listPackages(userId);
    const pkg = packages.find((p) => p.name === String(req.params.dirName));
    if (!pkg) { notFound(res, "Skill not found"); return; }
    const thread = await createThread(userId, pkg.id, req.body?.model);
    const detail = await getThreadDetail(userId, thread.id);
    const turnIndexes = calcTurnIndex(detail.messages);
    ok(res, {
      session: threadToSession(thread),
      messages: detail.messages.map((m, i) => ({
        id: m.id,
        arena_session_id: m.threadId,
        user_id: userId,
        side: m.side,
        role: m.role,
        content: m.content,
        turn_index: turnIndexes[i],
        created_at: m.createdAt,
      })),
    });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/arena/chat/agent/:id", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const pkg = await findPackageByRef(userId, String(req.params.id));
    if (!pkg) { notFound(res, "Agent not found"); return; }
    const thread = await createThread(userId, pkg.id, req.body?.model);
    const detail = await getThreadDetail(userId, thread.id);
    const turnIndexes = calcTurnIndex(detail.messages);
    ok(res, {
      session: threadToSession(thread),
      messages: detail.messages.map((m, i) => ({
        id: m.id,
        arena_session_id: m.threadId,
        user_id: userId,
        side: m.side,
        role: m.role,
        content: m.content,
        turn_index: turnIndexes[i],
        created_at: m.createdAt,
      })),
    });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.get("/arena/chat/sessions", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const packages = await listPackages(userId);
    if (packages.length === 0) { ok(res, []); return; }
    const allSessions: ReturnType<typeof threadToSession>[] = [];
    for (const pkg of packages) {
      const threads = await listThreads(userId, pkg.id);
      for (const t of threads) allSessions.push(threadToSession(t));
    }
    ok(res, allSessions);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.get("/arena/chat/sessions/:sessionId", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const detail = await getThreadDetail(userId, String(req.params.sessionId));
    const turnIndexes = calcTurnIndex(detail.messages);
    ok(res, {
      session: threadToSession(detail.thread),
      messages: detail.messages.map((m, i) => ({
        id: m.id,
        arena_session_id: m.threadId,
        user_id: userId,
        side: m.side,
        role: m.role,
        content: m.content,
        turn_index: turnIndexes[i],
        created_at: m.createdAt,
      })),
    });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/arena/chat/sessions/:sessionId/messages", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const result = await sendMessage(userId, String(req.params.sessionId), String(req.body?.content || ""), req.body?.model);
    ok(res, {
      thread: result.thread,
      shared: result.shared,
      baseline: result.baseline,
      enhanced: result.enhanced,
    });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/arena/chat/sessions/:sessionId/messages/stream", requireAuth, async (req: Request, res: Response) => {
  initSse(res);
  const heartbeat = startSseHeartbeat(
    res,
    Number(
      process.env.COMPAT_ARENA_STREAM_HEARTBEAT_MS ||
        process.env.ARENA_STREAM_HEARTBEAT_MS ||
        "15000",
    ),
  );
  try {
    const userId = pickUserId(req);
    const content = String(req.body?.content || "").trim();
    if (!content) { writeSseEvent(res, "error", { error: "Message content is required" }); res.end(); return; }

    let turnIndex = 1;
    try {
      const detail = await getThreadDetail(userId, String(req.params.sessionId));
      turnIndex = detail.messages.filter((m) => m.side === "shared" && m.role === "user").length + 1;
    } catch { /* ignore */ }

    for await (const event of streamMessage(userId, String(req.params.sessionId), content, req.body?.model)) {
      if (event.event === "shared") {
        writeSseEvent(res, "shared", { message: { ...event.data.message, arena_session_id: event.data.message.threadId, user_id: userId, turn_index: turnIndex, created_at: event.data.message.createdAt } });
      } else if (event.event === "side_start") {
        writeSseEvent(res, "side_start", event.data);
      } else if (event.event === "delta") {
        writeSseEvent(res, "delta", event.data);
      } else if (event.event === "side_done") {
        writeSseEvent(res, "side_done", event.data);
      } else if (event.event === "done") {
        writeSseEvent(res, "done", {
          session: threadToSession(event.data.thread),
          messages: event.data.messages.map((m) => ({
            id: m.id,
            arena_session_id: m.threadId,
            user_id: userId,
            side: m.side,
            role: m.role,
            content: m.content,
            turn_index: m.side === "shared" && m.role === "user" ? turnIndex : turnIndex,
            created_at: m.createdAt,
          })),
        });
      } else if ((event as { event: string }).event === "error") {
        writeSseEvent(res, "error", (event as unknown as { data: { error: string } }).data);
      }
    }
    writeSseEvent(res, "stream_end", { ok: true });
  } catch (error) {
    writeSseEvent(res, "error", { error: error instanceof Error ? error.message : "Stream failed" });
  } finally {
    stopSseHeartbeat(heartbeat);
    res.end();
  }
});

router.post("/arena/chat/sessions/:sessionId/report", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const report = await generateReport(userId, String(req.params.sessionId), req.body?.model);
    const detail = await getThreadDetail(userId, String(req.params.sessionId));

    const now = new Date().toISOString();
    const runResult = await query<{ id: number }>(
      "insert into arena_runs (session_id, package_id, target_kind, target_ref, model, state, report_json, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
      [String(req.params.sessionId), detail.thread.packageId, "profile", detail.thread.packageId, detail.thread.model, 1, "{}", now, now],
    );
    const runId = runResult.rows[0].id;

    const runView = {
      run: {
        id: runId,
        target_kind: "profile" as const,
        target_ref: detail.thread.packageId,
        model: detail.thread.model,
        state: 1,
        created_at: now,
        updated_at: now,
      },
      baseline: {
        totalScore: report.baseline.total,
        summary: report.baseline.summary,
        dimensions: report.baseline.dimensions.map((d) => ({
          key: d.key,
          name: d.name,
          score: d.score,
          maxScore: d.maxScore,
          reason: d.reason || "",
        })),
      },
      enhanced: {
        totalScore: report.enhanced.total,
        summary: report.enhanced.summary,
        dimensions: report.enhanced.dimensions.map((d) => ({
          key: d.key,
          name: d.name,
          score: d.score,
          maxScore: d.maxScore,
          reason: d.reason || "",
        })),
      },
      report: {
        delta: report.enhanced.total - report.baseline.total,
        recommendation: report.recommendation,
        weakestDimensions: report.baseline.dimensions.filter((d) => report.enhanced.dimensions.find((e) => e.key === d.key && e.score < d.score)).map((d) => d.name),
        strongestDimensions: report.enhanced.dimensions.filter((d) => report.baseline.dimensions.find((e) => e.key === d.key && e.score > e.score)).map((d) => d.name),
        shouldOptimize: report.enhanced.total > report.baseline.total,
        optimizeInstruction: "Optimize based on arena report",
      },
      evaluation_spec: {
        dimensions: report.baseline.dimensions.map((d) => ({
          key: d.key,
          name: d.name,
          scale: d.maxScore,
          passThreshold: Math.ceil(d.maxScore * 0.6),
          optimizeInstruction: `Improve ${d.name}`,
        })),
      },
    };

    await query(
      "update arena_runs set report_json = $1 where id = $2",
      [JSON.stringify(runView), runId],
    );

    ok(res, runView);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/arena/chat/sessions/:sessionId/delete", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    await query("delete from arena_messages where thread_id = $1 and user_id = $2", [String(req.params.sessionId), userId]);
    await query("delete from arena_threads where id = $1 and user_id = $2", [String(req.params.sessionId), userId]);
    ok(res, { ok: true });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

/* ─── Optimize ─── */

async function createOptimizeRun(userId: string, targetRef: string, targetKind: string, model?: string) {
  const pkg = await findPackageByRef(userId, targetRef);
  if (!pkg) throw new Error("Target not found");

  const threads = await listThreads(userId, pkg.id);
  const thread = threads[0];
  if (!thread) throw new Error("No arena thread found for this package");

  const result = await optimizePackage(userId, pkg.id, thread.id, model);

  const now = new Date().toISOString();
  const suggestions = result.issues.map((issue, idx) => ({
    key: `${issue.expert}-${idx}`,
    kind: issue.target === "agent" ? "profile_fields" : issue.target === "skill" ? "skill_markdown" : "agent_settings" as const,
    target: issue.target === "agent" ? "agent.md" : issue.target === "skill" ? issue.targetId || "skill" : "rubric.md",
    title: issue.title,
    description: issue.reason,
    patch: issue.target === "agent"
      ? { agentMd: result.snapshot.agentMd }
      : issue.target === "skill"
        ? { skillMd: result.snapshot.skills.find((s) => s.dirName === issue.targetId || s.name === issue.targetId)?.skillMd || "" }
        : { rubricMd: result.snapshot.rubricMd },
    status: "pending" as const,
  }));

  const runResult = await query<{ id: number }>(
    "insert into optimization_runs (package_id, thread_id, target_kind, target_ref, model, status, result_json, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id",
    [pkg.id, thread.id, targetKind, targetRef, model || null, "pending", "{}", now, now],
  );
  const runId = runResult.rows[0].id;

  const runView = {
    run: {
      id: runId,
      target_kind: targetKind,
      target_ref: targetRef,
      model,
      status: "pending" as const,
      created_at: now,
      updated_at: now,
    },
    suggestions,
    applied_keys: [] as string[],
    rejected_keys: [] as string[],
  };

  await query(
    "update optimization_runs set result_json = $1 where id = $2",
    [JSON.stringify(runView), runId],
  );

  return { created: true, ...runView };
}

router.post("/optimize/profile/:fileName", requireAuth, async (req, res) => {
  try {
    const result = await createOptimizeRun(pickUserId(req), String(req.params.fileName), "profile", req.body?.model);
    ok(res, result);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/optimize/skill/:dirName", requireAuth, async (req, res) => {
  try {
    const result = await createOptimizeRun(pickUserId(req), String(req.params.dirName), "skill", req.body?.model);
    ok(res, result);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/optimize/agent/:id", requireAuth, async (req, res) => {
  try {
    const result = await createOptimizeRun(pickUserId(req), String(req.params.id), "agent", req.body?.model);
    ok(res, result);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.get("/optimize/runs", requireAuth, async (req, res) => {
  try {
    const userId = pickUserId(req);
    const result = await query("select * from optimization_runs where package_id in (select id from agent_packages where user_id = $1) order by created_at desc", [userId]);
    ok(res, result.rows.map((row) => parseDbJson<unknown>(row.result_json, {})));
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.get("/optimize/runs/:runId", requireAuth, async (req, res) => {
  try {
    const result = await query("select * from optimization_runs where id = $1", [req.params.runId as string]);
    if (!result.rows[0]) { notFound(res); return; }
    ok(res, parseDbJson<unknown>(result.rows[0].result_json, {}));
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/optimize/runs/:runId/apply", requireAuth, async (req, res) => {
  try {
    const result = await query("select * from optimization_runs where id = $1", [req.params.runId as string]);
    if (!result.rows[0]) { notFound(res); return; }
    const runView = parseDbJson<CompatOptimizeRunView>(result.rows[0].result_json, emptyOptimizeRunView());
    const key = req.body?.suggestionKey;
    if (key) {
      if (!runView.applied_keys.includes(key)) runView.applied_keys.push(key);
      runView.rejected_keys = runView.rejected_keys.filter((k: string) => k !== key);
    } else {
      runView.applied_keys = runView.suggestions.map((s: { key: string }) => s.key);
      runView.rejected_keys = [];
    }
    runView.run.status = "applied";
    await query("update optimization_runs set result_json = $1, status = $2, updated_at = $3 where id = $4", [JSON.stringify(runView), "applied", new Date().toISOString(), req.params.runId as string]);
    ok(res, runView);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/optimize/runs/:runId/reject", requireAuth, async (req, res) => {
  try {
    const result = await query("select * from optimization_runs where id = $1", [req.params.runId as string]);
    if (!result.rows[0]) { notFound(res); return; }
    const runView = parseDbJson<CompatOptimizeRunView>(result.rows[0].result_json, emptyOptimizeRunView());
    const key = req.body?.suggestionKey;
    if (key) {
      if (!runView.rejected_keys.includes(key)) runView.rejected_keys.push(key);
      runView.applied_keys = runView.applied_keys.filter((k: string) => k !== key);
    } else {
      runView.rejected_keys = runView.suggestions.map((s: { key: string }) => s.key);
      runView.applied_keys = [];
    }
    runView.run.status = "rejected";
    await query("update optimization_runs set result_json = $1, status = $2, updated_at = $3 where id = $4", [JSON.stringify(runView), "rejected", new Date().toISOString(), req.params.runId as string]);
    ok(res, runView);
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

router.post("/optimize/runs/:runId/delete", requireAuth, async (req, res) => {
  try {
    await query("delete from optimization_runs where id = $1", [String(req.params.runId)]);
    ok(res, { ok: true });
  } catch (e) { bad(res, e instanceof Error ? e.message : "Failed"); }
});

export default router;
