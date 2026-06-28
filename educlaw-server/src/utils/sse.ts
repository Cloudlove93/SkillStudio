import type { Response } from "express";

type FlushableResponse = Response & { flush?: () => void };
type HeartbeatHandle = ReturnType<typeof setInterval> | null;

export function initSse(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    "X-Accel-Buffering": "no",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
}

export function writeSseEvent(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  (res as FlushableResponse).flush?.();
}

export function startSseHeartbeat(
  res: Response,
  intervalMs: number,
): HeartbeatHandle {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return null;
  }
  return setInterval(() => {
    try {
      writeSseEvent(res, "ping", {});
    } catch {
      // ignore disconnected clients
    }
  }, intervalMs);
}

export function stopSseHeartbeat(handle: HeartbeatHandle) {
  if (handle) {
    clearInterval(handle);
  }
}
