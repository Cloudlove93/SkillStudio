import { Router, type Request, type Response } from "express";
import { ARENA_ROUTES } from "@educlaw/shared";
import type { AuthedRequest } from "../types.js";
import { requireAuth } from "../middleware/auth.js";
import { one } from "../utils/http.js";
import {
  initSse,
  startSseHeartbeat,
  stopSseHeartbeat,
  writeSseEvent,
} from "../utils/sse.js";
import {
  createThread,
  generateReport,
  getThreadDetail,
  listThreads,
  listThreadsPage,
  sendMessage,
  streamMessage,
  type ArenaMode,
} from "../services/arena-service.js";
import { listAnswerOptimizationSummariesForThread } from "../services/answer-skill-optimization-service.js";

const router: import("express").Router = Router();

function parseArenaMode(value: unknown): ArenaMode {
  return value === "agent" || value === "baseline" ? value : "compare";
}

function optionalSingleQuery(value: unknown, field: string) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a single non-empty string`);
  }
  return value.trim();
}

router.get('/arena/threads/page', requireAuth, async (req, res) => {
  try {
    const packageId = optionalSingleQuery(req.query.packageId, 'packageId');
    if (!packageId) throw new Error('packageId is required');
    const rawLimit = optionalSingleQuery(req.query.limit, 'limit');
    if (rawLimit && !/^[1-9]\d*$/.test(rawLimit)) {
      throw new Error('limit must be a positive integer');
    }
    res.json(await listThreadsPage({
      userId: (req as AuthedRequest).userId || '',
      packageId,
      skillId: optionalSingleQuery(req.query.skillId, 'skillId'),
      cursor: optionalSingleQuery(req.query.cursor, 'cursor'),
      limit: rawLimit ? Number(rawLimit) : 100,
    }));
  } catch (error) {
    const status = error instanceof Error
      && typeof (error as Error & { status?: unknown }).status === 'number'
      ? (error as Error & { status: number }).status
      : 422;
    res.status(status).json({
      code: error instanceof Error
        && typeof (error as Error & { code?: unknown }).code === 'string'
        ? (error as Error & { code: string }).code
        : 'INVALID_ARGUMENT',
      error: error instanceof Error ? error.message : 'Arena 对话加载失败',
    });
  }
});

router.get(ARENA_ROUTES.THREADS, requireAuth, async (req, res) => {
  const packageId = String(req.query.packageId || "");
  if (!packageId) {
    res.status(400).json({ error: "缺少 packageId" });
    return;
  }
  res.json(await listThreads((req as AuthedRequest).userId || "", packageId));
});

router.post(ARENA_ROUTES.CREATE_THREAD, requireAuth, async (req, res) => {
  try {
    res.json(
      await createThread(
        (req as AuthedRequest).userId || "",
        String(req.body?.packageId || ""),
        typeof req.body?.model === "string" ? req.body.model : undefined,
      ),
    );
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : "创建 Arena 对话失败" });
  }
});

router.get(ARENA_ROUTES.THREAD_DETAIL, requireAuth, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).userId || "";
    const threadId = one(req.query.threadId as string | string[] | undefined);
    const [arenaThreadDetail, answerOptimizations] = await Promise.all([
      getThreadDetail(userId, threadId),
      listAnswerOptimizationSummariesForThread(userId, Number(threadId)),
    ]);
    res.json({ ...arenaThreadDetail, answerOptimizations });
  } catch (error) {
    res
      .status(404)
      .json({ error: error instanceof Error ? error.message : "找不到 Arena 对话" });
  }
});

router.post("/arena/threads/:threadId/messages", requireAuth, async (req, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) {
    res.status(400).json({ error: "消息内容不能为空" });
    return;
  }

  try {
    res.json(
      await sendMessage(
        (req as AuthedRequest).userId || "",
        one(req.params.threadId),
        content,
        typeof req.body?.model === "string" ? req.body.model : undefined,
        parseArenaMode(req.body?.mode),
        req.body?.thinkingEnabled === true,
      ),
    );
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "发送消息失败" });
  }
});

router.post(ARENA_ROUTES.MESSAGE_STREAM, requireAuth, async (req: Request, res: Response) => {
  const content = String(req.body?.content || "").trim();
  if (!content) {
    res.status(400).json({ error: "消息内容不能为空" });
    return;
  }

  initSse(res);
  const heartbeat = startSseHeartbeat(
    res,
    Number(process.env.ARENA_STREAM_HEARTBEAT_MS || "15000"),
  );
  try {
    for await (const event of streamMessage(
      (req as AuthedRequest).userId || "",
      one(req.query.threadId as string | string[] | undefined),
      content,
      typeof req.body?.model === "string" ? req.body.model : undefined,
      parseArenaMode(req.body?.mode),
      req.body?.thinkingEnabled === true,
    )) {
      writeSseEvent(res, event.event, event.data);
    }
    writeSseEvent(res, "stream_end", { ok: true });
  } catch (error) {
    writeSseEvent(res, "error", {
      error: error instanceof Error ? error.message : "发送消息失败",
    });
  } finally {
    stopSseHeartbeat(heartbeat);
    res.end();
  }
});

router.post("/arena/threads/:threadId/report", requireAuth, async (req, res) => {
  try {
    res.json(
      await generateReport(
        (req as AuthedRequest).userId || "",
        one(req.params.threadId),
        typeof req.body?.model === "string" ? req.body.model : undefined,
      ),
    );
  } catch (error) {
    res
      .status(400)
      .json({ error: error instanceof Error ? error.message : "生成评估报告失败" });
  }
});

router.post("/arena/threads/:threadId/report/stream", requireAuth, async (req: Request, res: Response) => {
  initSse(res);
  const heartbeat = startSseHeartbeat(
    res,
    Number(
      process.env.ARENA_REPORT_STREAM_HEARTBEAT_MS ||
        process.env.ARENA_STREAM_HEARTBEAT_MS ||
        "15000",
    ),
  );

  try {
    writeSseEvent(res, "phase", { label: "读取最新一轮 Arena 对话" });
    writeSseEvent(res, "phase", { label: "调用评估模型生成报告" });
    const report = await generateReport(
      (req as AuthedRequest).userId || "",
      one(req.params.threadId),
      typeof req.body?.model === "string" ? req.body.model : undefined,
    );
    writeSseEvent(res, "done", report);
    writeSseEvent(res, "stream_end", { ok: true });
  } catch (error) {
    writeSseEvent(res, "error", {
      error: error instanceof Error ? error.message : "生成评估报告失败",
    });
  } finally {
    stopSseHeartbeat(heartbeat);
    res.end();
  }
});

export default router;
