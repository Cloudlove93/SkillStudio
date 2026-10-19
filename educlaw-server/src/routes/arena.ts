import { createTrackedRouter } from '../services/http-drain.js';
import { Router, type Request, type Response } from 'express';
import { ARENA_ROUTES } from '@educlaw/shared';
import type { AuthedRequest } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { one } from '../utils/http.js';
import {
  initSse,
  startSseHeartbeat,
  stopSseHeartbeat,
  writeSseEvent,
} from '../utils/sse.js';
import {
  createThread,
  generateReport,
  getThreadDetail,
  listThreads,
  listThreadsPage,
  sendMessage,
  streamMessage,
  type ArenaMode,
} from '../services/arena-service.js';
import { listAnswerOptimizationSummariesForThread } from '../services/answer-skill-optimization-service.js';
import { arenaRunService } from '../services/arena-run-service.js';
import { writeArenaRunSnapshot } from '../utils/arena-run-sse.js';

const router: import('express').Router = createTrackedRouter(Router());

function runError(res: Response, error: unknown) {
  const structured = error as { status?: number; code?: string };
  res
    .status(structured?.status ?? 500)
    .json({
      code: structured?.code ?? 'RUN_ERROR',
      error: error instanceof Error ? error.message : 'Run request failed',
    });
}
function runThread(req: Request) {
  const value = one(req.params.threadId);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value)))
    throw Object.assign(new Error('Invalid threadId'), { status: 422 });
  return Number(value);
}

router.post('/arena/threads/:threadId/runs', requireAuth, async (req, res) => {
  try {
    res.json(
      await arenaRunService.start({
        ...req.body,
        userId: (req as AuthedRequest).userId || '',
        threadId: runThread(req),
      }),
    );
  } catch (error) {
    runError(res, error);
  }
});
router.get('/arena/threads/:threadId/runs', requireAuth, async (req, res) => {
  try {
    res.json(
      await arenaRunService.recover(
        (req as AuthedRequest).userId || '',
        runThread(req),
      ),
    );
  } catch (error) {
    runError(res, error);
  }
});
router.get(
  '/arena/threads/:threadId/runs/:runId',
  requireAuth,
  async (req, res) => {
    try {
      res.json(
        await arenaRunService.get(
          (req as AuthedRequest).userId || '',
          runThread(req),
          one(req.params.runId),
        ),
      );
    } catch (error) {
      runError(res, error);
    }
  },
);
router.post(
  '/arena/threads/:threadId/runs/:runId/stop',
  requireAuth,
  async (req, res) => {
    try {
      res.json(
        await arenaRunService.stop(
          (req as AuthedRequest).userId || '',
          runThread(req),
          one(req.params.runId),
        ),
      );
    } catch (error) {
      runError(res, error);
    }
  },
);
router.get(
  '/arena/threads/:threadId/runs/:runId/events',
  requireAuth,
  async (req, res) => {
    let subscription: Awaited<ReturnType<typeof arenaRunService.subscribe>>;
    try {
      subscription = await arenaRunService.subscribe(
        (req as AuthedRequest).userId || '',
        runThread(req),
        one(req.params.runId),
      );
    } catch (error) {
      runError(res, error);
      return;
    }
    const detach = () => {
      void subscription.return?.();
    };
    res.once('close', detach);
    // A disconnect can occur during the asynchronous ownership check.
    if (res.destroyed || req.aborted) {
      detach();
      return;
    }
    initSse(res);
    try {
      for await (const snapshot of subscription) {
        if (res.destroyed || res.writableEnded) break;
        // One bounded frame at a time. A slow socket detaches and recovers using
        // the same runId; it cannot accumulate queued full snapshots in Node.
        await writeArenaRunSnapshot(res, snapshot);
      }
    } finally {
      detach();
      res.removeListener('close', detach);
      if (!res.destroyed && !res.writableEnded) res.end();
    }
  },
);

function canWriteSse(res: Response): boolean {
  return !res.destroyed && !res.writableEnded;
}

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

async function streamArenaMessage(req: Request, res: Response) {
  // Exactly one identity source per entry. Never let a query override the path
  // or silently choose the first of repeated legacy query parameters.
  const scoped = req.params.threadId !== undefined;
  const threadId = scoped ? req.params.threadId : req.query.threadId;
  if ((scoped && req.query.threadId !== undefined)
    || typeof threadId !== 'string' || !threadId.trim()) {
    res.status(400).json({ error: 'threadId 必须来自当前入口唯一的非空标识' });
    return;
  }
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
  const abortController = new AbortController();
  let streamFinished = false;
  const abortDisconnectedClient = () => {
    if (!streamFinished) abortController.abort();
  };
  req.once("aborted", abortDisconnectedClient);
  res.once("close", abortDisconnectedClient);
  try {
    for await (const event of streamMessage(
      (req as AuthedRequest).userId || "",
      threadId.trim(),
      content,
      typeof req.body?.model === "string" ? req.body.model : undefined,
      parseArenaMode(req.body?.mode),
      req.body?.thinkingEnabled === true,
      abortController.signal,
    )) {
      if (canWriteSse(res)) writeSseEvent(res, event.event, event.data);
    }
    if (canWriteSse(res)) writeSseEvent(res, "stream_end", { ok: true });
    streamFinished = true;
  } catch (error) {
    if (canWriteSse(res)) {
      writeSseEvent(res, "error", {
        error: abortController.signal.aborted
          ? "运行已取消"
          : error instanceof Error ? error.message : "发送消息失败",
      });
      writeSseEvent(res, "stream_end", { ok: false });
    }
    streamFinished = true;
  } finally {
    streamFinished = true;
    req.removeListener("aborted", abortDisconnectedClient);
    res.removeListener("close", abortDisconnectedClient);
    stopSseHeartbeat(heartbeat);
    if (canWriteSse(res)) res.end();
  }
}

router.post(ARENA_ROUTES.MESSAGE_STREAM, requireAuth, streamArenaMessage);
router.post(ARENA_ROUTES.LEGACY_MESSAGE_STREAM, requireAuth, streamArenaMessage);

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
