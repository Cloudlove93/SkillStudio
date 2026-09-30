import type { Server } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";
import { getRequestId } from "../lib/request-context.js";
import { withRequestContext } from "./request-context.js";

async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("withRequestContext", () => {
  it("preserves an incoming x-request-id across async work", async () => {
    const app = express();
    app.use(withRequestContext);
    app.get("/context", async (_req, res) => {
      await Promise.resolve();
      res.json({ requestId: getRequestId() });
    });

    const { server, url } = await listen(app);
    try {
      const response = await fetch(`${url}/context`, {
        headers: { "x-request-id": "req-123" },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe("req-123");
      expect(await response.json()).toEqual({ requestId: "req-123" });
    } finally {
      await close(server);
    }
  });

  it("creates an x-request-id when the caller does not provide one", async () => {
    const app = express();
    app.use(withRequestContext);
    app.get("/context", (_req, res) => {
      res.json({ requestId: getRequestId() });
    });

    const { server, url } = await listen(app);
    try {
      const response = await fetch(`${url}/context`);
      const payload = await response.json() as { requestId?: string };
      const headerValue = response.headers.get("x-request-id");

      expect(response.status).toBe(200);
      expect(typeof payload.requestId).toBe("string");
      expect(payload.requestId).toBeTruthy();
      expect(headerValue).toBe(payload.requestId);
    } finally {
      await close(server);
    }
  });
});
