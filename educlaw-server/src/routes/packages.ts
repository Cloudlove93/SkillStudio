import multer from "multer";
import { Router, type Request, type Response } from "express";
import type { AuthedRequest } from "../types.js";
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
} from "../services/package-service.js";
import { optimizePackage } from "../services/optimization-service.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/", requireAuth, async (req, res) => {
  res.json(await listPackages((req as AuthedRequest).userId || ""));
});

router.post("/generate", requireAuth, async (req, res) => {
  try {
    const pkg = await generatePackage(
      (req as AuthedRequest).userId || "",
      String(req.body?.instruction || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
    );
    res.json(pkg);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "生成智能体包失败" });
  }
});

router.post("/generate/stream", requireAuth, async (req: Request, res: Response) => {
  initSse(res);
  try {
    writeSseEvent(res, "phase", { label: "整理需求并准备生成提示词" });
    writeSseEvent(res, "phase", { label: "调用模型生成 agent.md 与 skill.md" });
    const pkg = await generatePackage(
      (req as AuthedRequest).userId || "",
      String(req.body?.instruction || ""),
      typeof req.body?.model === "string" ? req.body.model : undefined,
      (preview) => writeSseEvent(res, "preview", preview),
    );
    writeSseEvent(res, "phase", { label: "保存智能体包与初始版本" });
    writeSseEvent(res, "done", pkg);
    writeSseEvent(res, "stream_end", { ok: true });
  } catch (error) {
    writeSseEvent(res, "error", { error: error instanceof Error ? error.message : "生成智能体包失败" });
  } finally {
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
    res.end();
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