import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";
import { runWithRequestContext } from "../lib/request-context.js";

function normalizeRequestId(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export const withRequestContext: RequestHandler = (req, res, next) => {
  const requestId = normalizeRequestId(req.header("x-request-id")) || randomUUID();
  const startedAt = Date.now();
  res.setHeader("x-request-id", requestId);

  const requestLogger = logger.child({
    requestId,
    method: req.method,
    path: req.originalUrl || req.url,
  });

  runWithRequestContext({ requestId, logger: requestLogger }, () => {
    requestLogger.info({ event: "request.start" }, "request.start");

    res.on("finish", () => {
      requestLogger.info({
        event: "request.finish",
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      }, "request.finish");
    });

    next();
  });
};
