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

    // Stream body
    const body = await upstream.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (err) {
    res.status(502).json({
      error: `Failed to reach auth backend: ${err instanceof Error ? err.message : "unknown error"}`,
    });
  }
});

export default router;
