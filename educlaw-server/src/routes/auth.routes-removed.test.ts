import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

async function createApp() {
  vi.resetModules();
  vi.doMock("../services/db.js", () => ({
    query: queryMock,
    newId: () => "test-id",
  }));

  const apiRoutes = (await import("./index.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", apiRoutes);
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
  vi.resetModules();
  vi.doUnmock("../services/db.js");
  queryMock.mockReset();
});

describe("auth routes owned by EduSkill server", () => {
  it("does not expose /api/auth/me", async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api/auth/me`, {
        headers: { "X-User-Id": "user-1" },
      });

      expect(response.status).toBe(404);
    } finally {
      await close(server);
    }
  });
});
