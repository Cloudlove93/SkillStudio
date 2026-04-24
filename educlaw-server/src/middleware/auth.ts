import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "../types.js";
import { verifyToken } from "../services/auth-service.js";

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "未登录或登录状态已失效" });
    return;
  }

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "未登录或登录状态已失效" });
  }
}