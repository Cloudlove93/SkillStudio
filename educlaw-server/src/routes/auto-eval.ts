import { Router } from "express";
import type { AuthedRequest } from "../types.js";
import { requireAuth } from "../middleware/auth.js";
import {
  getAutoEvalHealth,
  getAutoEvalRun,
  importAutoEvalQuestions,
  previewAutoEval,
  runAutoEval,
} from "../services/auto-eval-service.js";

const router: import("express").Router = Router();

router.get("/health", requireAuth, async (_req, res) => {
  res.json(await getAutoEvalHealth());
});

router.post("/preview", requireAuth, async (req, res) => {
  try {
    res.json(await previewAutoEval(
      (req as AuthedRequest).userId || "",
      String(req.body?.packageId || ""),
    ));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "读取测评预览失败" });
  }
});

router.post("/questions/import", requireAuth, async (req, res) => {
  try {
    res.json(await importAutoEvalQuestions(
      (req as AuthedRequest).userId || "",
      String(req.body?.packageId || ""),
      Array.isArray(req.body?.documents) ? req.body.documents : [],
      typeof req.body?.model === "string" ? req.body.model : undefined,
    ));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "导入测评题失败" });
  }
});

router.post("/runs", requireAuth, async (req, res) => {
  try {
    res.json(await runAutoEval(
      (req as AuthedRequest).userId || "",
      String(req.body?.packageId || ""),
      Array.isArray(req.body?.questionIds) ? req.body.questionIds.map(String) : undefined,
    ));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "自动测评失败" });
  }
});

router.get("/runs/:runId", requireAuth, async (req, res) => {
  try {
    res.json(await getAutoEvalRun(
      (req as AuthedRequest).userId || "",
      String(req.params.runId || ""),
    ));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "读取测评结果失败" });
  }
});

export default router;
