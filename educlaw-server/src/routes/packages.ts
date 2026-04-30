import multer from "multer";
import { Router, type Request, type Response } from "express";
import type { AuthedRequest } from "../types.js";
import { config } from "../config.js";
import { requireAuth } from "../middleware/auth.js";
import { one } from "../utils/http.js";
import { initSse, writeSseEvent } from "../utils/sse.js";
import {
  deletePackage,
  exportPackageZip,
  generatePackage,
  getPackage,
  importPackageZip,
  listPackages,
  listVersions,
  compareVersions,
  updateVersionNote,
} from "../services/package-service.js";
import { optimizePackage } from "../services/optimization-service.js";
import {
  diagnosePackage,
  chatOptimize,
  applyInteractiveChanges,
  type AdoptedChange,
} from "../services/interactive-optimization-service.js";

const router: import("express").Router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.uploadLimitBytes } });

router.get("/", requireAuth, async (req, res) => {
  res.json(await listPackages((req as AuthedRequest).userId || ""));
});

router.post("/generate", requireAuth, async (req, res) => {
  try {
    const pkg = await generatePackage(
      (req as AuthedRequest).userId || "",
      String(req.body?.instruction || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
      Array.isArray(req.body?.documents) ? req.body.documents : undefined,
    );
    res.json(pkg);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "生成智能体失败" });
  }
});

router.post("/generate/stream", requireAuth, async (req: Request, res: Response) => {
  initSse(res);
  const startedAt = Date.now();
  const documents: Array<{ name: string; content: string }> | undefined = Array.isArray(req.body?.documents)
    ? req.body.documents
    : undefined;
  console.log("[packages.generate.stream] start", {
    userId: (req as AuthedRequest).userId || "",
    instructionLength: String(req.body?.instruction || "").length,
    documentCount: documents?.length || 0,
    documentChars: documents?.reduce((sum, doc) => sum + String(doc?.content || "").length, 0) || 0,
    model: typeof req.body?.model === "string" ? req.body.model : undefined,
  });
  const heartbeat = setInterval(() => {
    try { writeSseEvent(res, "ping", {}); } catch { /* ignore */ }
  }, 5000);
  try {
    writeSseEvent(res, "phase", { label: "整理需求，准备生成智能体" });
    writeSseEvent(res, "phase", { label: "调用模型生成智能体内容" });
    const pkg = await generatePackage(
      (req as AuthedRequest).userId || "",
      String(req.body?.instruction || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
      documents,
      (preview) => writeSseEvent(res, "preview", preview),
      (delta) => writeSseEvent(res, "preview_delta", delta),
    );
    writeSseEvent(res, "phase", { label: "保存智能体与初始版本" });
    writeSseEvent(res, "done", pkg);
    writeSseEvent(res, "stream_end", { ok: true });
    console.log("[packages.generate.stream] done", { packageId: pkg.id, durationMs: Date.now() - startedAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成智能体失败";
    console.error("[packages.generate.stream] error", { durationMs: Date.now() - startedAt, error: message });
    writeSseEvent(res, "error", { error: message });
    writeSseEvent(res, "stream_end", { ok: false });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

router.post("/import", requireAuth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      res.status(400).json({ error: "请上传 ZIP 文件" });
      return;
    }
    res.json(await importPackageZip((req as AuthedRequest).userId || "", req.file.buffer));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "导入失败" });
  }
});

router.get("/:packageId", requireAuth, async (req, res) => {
  try {
    res.json(await getPackage((req as AuthedRequest).userId || "", one(req.params.packageId)));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "找不到智能体包" });
  }
});

router.get("/:packageId/versions", requireAuth, async (req, res) => {
  try {
    res.json(await listVersions((req as AuthedRequest).userId || "", one(req.params.packageId)));
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "找不到版本记录" });
  }
});

router.get("/:packageId/export", requireAuth, async (req, res) => {
  try {
    const packageId = one(req.params.packageId);
    const data = await exportPackageZip((req as AuthedRequest).userId || "", packageId);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${packageId}.zip"`);
    res.send(data);
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "导出失败" });
  }
});

router.post("/:packageId/optimize", requireAuth, async (req, res) => {
  try {
    const result = await optimizePackage(
      (req as AuthedRequest).userId || "",
      one(req.params.packageId),
      String(req.body?.threadId || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "优化失败" });
  }
});

router.post("/:packageId/optimize/stream", requireAuth, async (req: Request, res: Response) => {
  initSse(res);
  const heartbeat = setInterval(() => {
    try { writeSseEvent(res, "ping", {}); } catch { /* ignore */ }
  }, 5000);
  try {
    const result = await optimizePackage(
      (req as AuthedRequest).userId || "",
      one(req.params.packageId),
      String(req.body?.threadId || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
      (label) => writeSseEvent(res, "phase", { label }),
    );
    writeSseEvent(res, "done", result);
    writeSseEvent(res, "stream_end", { ok: true });
  } catch (error) {
    writeSseEvent(res, "error", { error: error instanceof Error ? error.message : "优化失败" });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

router.post("/:packageId/optimize/diagnose", requireAuth, async (req, res) => {
  try {
    const result = await diagnosePackage(
      (req as AuthedRequest).userId || "",
      one(req.params.packageId),
      String(req.body?.threadId || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "诊断失败" });
  }
});

router.post("/:packageId/optimize/chat", requireAuth, async (req, res) => {
  try {
    const result = await chatOptimize(
      (req as AuthedRequest).userId || "",
      one(req.params.packageId),
      {
        messages: Array.isArray(req.body?.messages) ? req.body.messages : [],
        adoptedChanges: Array.isArray(req.body?.adoptedChanges) ? req.body.adoptedChanges : [],
      },
      typeof req.body?.model === "string" ? req.body.model : undefined,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "对话失败" });
  }
});

router.post("/:packageId/optimize/apply", requireAuth, async (req, res) => {
  try {
    const result = await applyInteractiveChanges(
      (req as AuthedRequest).userId || "",
      one(req.params.packageId),
      Array.isArray(req.body?.changes) ? (req.body.changes as AdoptedChange[]) : [],
      typeof req.body?.model === "string" ? req.body.model : undefined,
      typeof req.body?.note === "string" ? req.body.note : undefined,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "应用修改失败" });
  }
});

router.post("/:packageId/versions/compare", requireAuth, async (req, res) => {
  try {
    const result = await compareVersions(
      (req as AuthedRequest).userId || "",
      one(req.params.packageId),
      String(req.body?.baseVersionId || ""),
      String(req.body?.targetVersionId || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "版本对比失败" });
  }
});

router.post("/:packageId/versions/:versionId/note", requireAuth, async (req, res) => {
  try {
    const result = await updateVersionNote(
      (req as AuthedRequest).userId || "",
      one(req.params.packageId),
      one(req.params.versionId),
      typeof req.body?.note === "string" ? req.body.note : "",
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "更新备注失败" });
  }
});

router.delete("/:packageId", requireAuth, async (req, res) => {
  try {
    await deletePackage((req as AuthedRequest).userId || "", one(req.params.packageId));
    res.json({ ok: true });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "删除失败" });
  }
});

export default router;
