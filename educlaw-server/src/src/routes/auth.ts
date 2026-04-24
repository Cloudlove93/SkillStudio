import { Router } from "express";
import type { AuthedRequest } from "../types.js";
import { getUserById, loginUser, registerUser } from "../services/auth-service.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.post("/register", async (req, res) => {
  try {
    const result = await registerUser(String(req.body?.username || ""), String(req.body?.password || ""));
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "注册失败" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const result = await loginUser(String(req.body?.username || ""), String(req.body?.password || ""));
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "登录失败" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const user = await getUserById((req as AuthedRequest).userId || "");
  if (!user) {
    res.status(404).json({ error: "用户不存在" });
    return;
  }
  res.json(user);
});

export default router;