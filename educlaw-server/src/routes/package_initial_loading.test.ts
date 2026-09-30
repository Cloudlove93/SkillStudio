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

  const packageRoutes = (await import("./packages.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/api", packageRoutes);
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

describe("package initial loading workflow", () => {
  it("GET /api/packages returns authenticated user's package summaries", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: "package-1",
        user_id: "user-1",
        name: "Math Coach",
        description: "Helps with algebra practice",
        current_version_id: "version-1",
        created_at: "2026-05-21T01:00:00.000Z",
        updated_at: "2026-05-21T02:00:00.000Z",
        current_version_number: 3,
      }],
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/api/packages`, {
        headers: { "X-User-Id": "user-1" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([{
        id: "package-1",
        userId: "user-1",
        name: "Math Coach",
        description: "Helps with algebra practice",
        versionNumber: 3,
        updatedAt: "2026-05-21T02:00:00.000Z",
      }]);
      expect(queryMock).toHaveBeenCalledTimes(1);
      expect(queryMock.mock.calls[0]?.[0]).toContain(
        "join agent_package_versions",
      );
      expect(queryMock.mock.calls[0]?.[1]).toEqual(["user-1"]);
    } finally {
      await close(server);
    }
  });
});
