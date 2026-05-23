import { Router, type Request, type Response } from "express";
import { ARENA_ROUTES } from "@educlaw/shared";
import type { AuthedRequest } from "../types.js";
import { requireAuth } from "../middleware/auth.js";
import { one } from "../utils/http.js";
import { initSse, writeSseEvent } from "../utils/sse.js";
import {
  createThread,
  generateReport,
  getThreadDetail,
  listThreads,
  sendMessage,
  streamMessage,
  type ArenaMode,
} from "../services/arena-service.js";

const router: import("express").Router = Router();

function parseArenaMode(value: unknown): ArenaMode {
  return value === "agent" || value === "baseline" ? value : "compare";
}

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
    res.json(await createThread(
      (req as AuthedRequest).userId || "",
      String(req.body?.packageId || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
    ));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "创建 Arena 对话失败" });
  }
});

router.get(ARENA_ROUTES.THREAD_DETAIL, requireAuth, async (req, res) => {
  try {
    let arenaThreadDetail = await getThreadDetail((req as AuthedRequest).userId || "", one(req.query.threadId as string | string[] | undefined));
    res.json(arenaThreadDetail);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "找不到 Arena 对话" });
  }
});

router.post("/arena/threads/:threadId/messages", requireAuth, async (req, res) => {
  const content = String(req.body?.content || "").trim();
  if (!content) {
    res.status(400).json({ error: "消息内容不能为空" });
    return;
  }

  try {
    res.json(await sendMessage(
      (req as AuthedRequest).userId || "",
      one(req.params.threadId),
      content,
      typeof req.body?.model === "string" ? req.body.model : undefined,
      parseArenaMode(req.body?.mode),
    ));
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
  try {
    for await (const event of streamMessage(
      (req as AuthedRequest).userId || "",
      one(req.query.threadId as string | string[] | undefined),
      content,
      typeof req.body?.model === "string" ? req.body.model : undefined,
      parseArenaMode(req.body?.mode),
    )) {
      writeSseEvent(res, event.event, event.data);
    }
    writeSseEvent(res, "stream_end", { ok: true });
  } catch (error) {
    writeSseEvent(res, "error", { error: error instanceof Error ? error.message : "发送消息失败" });
  } finally {
    res.end();
  }
});

router.post("/arena/threads/:threadId/report", requireAuth, async (req, res) => {
  try {
    res.json(await generateReport(
      (req as AuthedRequest).userId || "",
      one(req.params.threadId),
      typeof req.body?.model === "string" ? req.body.model : undefined,
    ));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "生成评估报告失败" });
  }
});

router.post("/arena/threads/:threadId/report/stream", requireAuth, async (req: Request, res: Response) => {
  initSse(res);
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
    writeSseEvent(res, "error", { error: error instanceof Error ? error.message : "生成评估报告失败" });
  } finally {
    res.end();
  }
});

export default router;
