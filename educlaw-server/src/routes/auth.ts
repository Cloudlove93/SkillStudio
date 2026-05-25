import { Router } from "express";
import { AUTH_ROUTES } from "@educlaw/shared";
import type { AuthedRequest } from "../types.js";
import { getUserById, loginUser, registerUser } from "../services/auth-service.js";
import { requireAuth } from "../middleware/auth.js";

const router: import("express").Router = Router();

router.post(`/auth${AUTH_ROUTES.REGISTER}`, async (_req, res) => {
  res.status(403).json({ error: "注册已关闭，请使用预置账号登录" });
});

router.post(`/auth${AUTH_ROUTES.LOGIN}`, async (req, res) => {
  try {
    const result = await loginUser(String(req.body?.username || ""), String(req.body?.password || ""));
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "登录失败" });
  }
});

router.get(`/auth${AUTH_ROUTES.ME}`, requireAuth, async (req, res) => {
  const user = await getUserById((req as AuthedRequest).userId || "");
  if (!user) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }
  res.json(user);
});

export default router;
