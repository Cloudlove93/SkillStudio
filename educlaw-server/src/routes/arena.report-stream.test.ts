import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const generateReportMock = vi.fn();

async function createApp() {
  process.env.ARENA_REPORT_STREAM_HEARTBEAT_MS = "10";
  vi.resetModules();
  vi.doMock("../services/arena-service.js", () => ({
    createThread: vi.fn(),
    generateReport: generateReportMock,
    getThreadDetail: vi.fn(),
    listThreads: vi.fn(),
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
  }));

  const router = (await import("./arena.js")).default;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.headers["x-user-id"] = "user-1";
    next();
  });
  app.use(router);
  return app;
}

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

afterEach(() => {
  delete process.env.ARENA_REPORT_STREAM_HEARTBEAT_MS;
  vi.resetModules();
  vi.doUnmock("../services/arena-service.js");
  generateReportMock.mockReset();
});

describe("POST /arena/threads/:threadId/report/stream", () => {
  it("emits heartbeat events while waiting for the report model", async () => {
    generateReportMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              threadId: 1,
              baseline: { summary: "baseline", total: 1, dimensions: [] },
              enhanced: { summary: "enhanced", total: 2, dimensions: [] },
              recommendation: "enhanced is better",
              winningSide: "enhanced",
            });
          }, 35);
        }),
    );

    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/arena/threads/thread-1/report/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain("event: ping");
      expect(body).toContain("event: done");
      expect(body).toContain("event: stream_end");
    } finally {
      await close(server);
    }
  });
});
