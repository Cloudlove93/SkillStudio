import { Router, type Request, type Response } from "express";
import { config } from "../config.js";

/**
 * Reverse-proxy for /auth/* requests.
 *
 * When AUTH_BACKEND_URL is configured, every request hitting /auth/* is
 * forwarded to that upstream (e.g. http://auth.educlaw.innoagent.tech).
 * If the env var is not set the route returns 503 so callers know auth
 * is unavailable rather than getting a silent 404.
 */

/**
 * Translate known error messages from the auth backend to Chinese.
 * The auth backend's sanitizeError() keeps Chinese messages as-is but
 * replaces English ones with fallback strings like "Authentication failed".
 */
const ERROR_TRANSLATIONS: Record<string, string> = {
  "Authentication failed": "邮箱或密码错误",
  "Registration failed": "注册失败，请稍后重试",
};

function translateError(message: string): string {
  // Already Chinese — pass through
  if (/[一-鿿]/.test(message)) return message;
  // Exact match
  if (ERROR_TRANSLATIONS[message]) return ERROR_TRANSLATIONS[message];
  // Prefix match for "Registration failed: <details>"
  for (const [en, zh] of Object.entries(ERROR_TRANSLATIONS)) {
    if (message.startsWith(en)) return zh;
  }
  return message;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function forwardHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      headers[key] = value.join(", ");
    } else if (value !== undefined) {
      headers[key] = value;
    }
  }
  return headers;
}

const router: import("express").Router = Router();

router.all("/*path", async (req: Request, res: Response) => {
  if (!config.authBackendUrl) {
    res.status(503).json({ error: "Auth backend not configured (AUTH_BACKEND_URL)" });
    return;
  }

  // Transform request body for password auth
  if (req.method === "POST" && req.path === "/password" && req.body) {
    const { email, username, mode } = req.body;

    // For login: use email as username (auth backend supports email lookup)
    if (mode === "login" && email) {
      req.body.username = email;
    }

    // For registration: keep username as-is, email is already a separate field
    // The auth backend expects: username (display name), email (actual email), password
  }

  // Validate invite code for registration requests
  if (req.method === "POST" && req.path === "/password" && req.body?.mode === "register") {
    const { inviteCode } = req.body;
    if (!config.inviteCode) {
      res.status(500).json({ error: "服务器未配置邀请码，请联系管理员" });
      return;
    }
    if (!inviteCode || inviteCode !== config.inviteCode) {
      res.status(403).json({ error: "邀请码无效，请检查后重试" });
      return;
    }
  }

  const targetPath = `/auth${req.path === "/" ? "" : req.path}`;
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetUrl = `${config.authBackendUrl}${targetPath}${qs}`;

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders(req),
      body: ["GET", "HEAD"].includes(req.method ?? "GET") ? undefined : JSON.stringify(req.body),
      redirect: "manual",
    });

    // Forward status
    res.status(upstream.status);

    // Forward response headers (skip hop-by-hop)
    for (const [key, value] of upstream.headers.entries()) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      res.setHeader(key, value);
    }

    // Stream body (translate error messages for non-OK responses)
    const body = await upstream.arrayBuffer();
    const contentType = upstream.headers.get("content-type") || "";
    if (!upstream.ok && contentType.includes("application/json")) {
      try {
        const json = JSON.parse(Buffer.from(body).toString("utf-8"));
        if (json.error && typeof json.error === "string") {
          json.error = translateError(json.error);
        }
        res.json(json);
        return;
      } catch {
        // fall through to raw send
      }
    }
    res.send(Buffer.from(body));
  } catch (err) {
    res.status(502).json({
      error: `Failed to reach auth backend: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }
});

export default router;
