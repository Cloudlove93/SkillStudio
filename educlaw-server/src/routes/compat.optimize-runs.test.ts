import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();

async function createApp() {
  vi.resetModules();
  vi.doMock("../services/db.js", () => ({ query: queryMock }));
  vi.doMock("../services/package-service.js", () => ({
    listPackages: vi.fn(),
    getPackage: vi.fn(),
    generatePackage: vi.fn(),
    deletePackage: vi.fn(),
    exportPackageZip: vi.fn(),
    importPackageZip: vi.fn(),
  }));
  vi.doMock("../services/arena-service.js", () => ({
    listThreads: vi.fn(),
    createThread: vi.fn(),
    getThreadDetail: vi.fn(),
    sendMessage: vi.fn(),
    streamMessage: vi.fn(),
    generateReport: vi.fn(),
  }));
  vi.doMock("../services/optimization-service.js", () => ({
    optimizePackage: vi.fn(),
  }));
  vi.doMock("../services/arena-thread-lifecycle.js", () => ({
    reserveArenaThread: vi.fn(),
  }));
  const router = (await import("./compat.js")).default;
  const app = express();
  app.use(express.json());
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
  vi.resetModules();
  vi.doUnmock("../services/db.js");
  vi.doUnmock("../services/package-service.js");
  vi.doUnmock("../services/arena-service.js");
  vi.doUnmock("../services/optimization-service.js");
  vi.doUnmock("../services/arena-thread-lifecycle.js");
  queryMock.mockReset();
});

describe("legacy optimization runs are tenant scoped", () => {
  it.each([
    ["get", "GET", "/optimize/runs/7"],
    ["apply", "POST", "/optimize/runs/7/apply"],
    ["reject", "POST", "/optimize/runs/7/reject"],
  ] as const)(
    "%s answers 404 for a run owned by another user",
    async (_label, method, path) => {
      queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
      const { server, url } = await listen(await createApp());
      try {
        const response = await fetch(`${url}${path}`, {
          method,
          headers: { "X-User-Id": "intruder", "Content-Type": "application/json" },
          ...(method === "POST" ? { body: "{}" } : {}),
        });
        expect(response.status).toBe(404);
        // The lookup itself must join the owning package, not match by id alone.
        const sql = String(queryMock.mock.calls[0]?.[0] ?? "");
        expect(sql).toContain("join agent_packages");
        expect(sql).toContain("p.user_id = $2");
        expect(queryMock.mock.calls[0]?.[1]).toEqual(["7", "intruder"]);
        expect(
          queryMock.mock.calls.some(([text]) =>
            String(text).startsWith("update optimization_runs"),
          ),
        ).toBe(false);
      } finally {
        await close(server);
      }
    },
  );

  it("deletes only through the owning package", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/optimize/runs/7/delete`, {
        method: "POST",
        headers: { "X-User-Id": "owner", "Content-Type": "application/json" },
      });
      expect(response.status).toBe(200);
      const [sql, values] = queryMock.mock.calls[0] ?? [];
      expect(String(sql)).toContain("using agent_packages");
      expect(String(sql)).toContain("p.user_id = $2");
      expect(values).toEqual(["7", "owner"]);
    } finally {
      await close(server);
    }
  });

  it("applies an owned run and scopes the update by package", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (String(sql).startsWith("update optimization_runs")) {
        return { rows: [], rowCount: 1 };
      }
      return {
        rows: [
          {
            package_id: "42",
            result_json: JSON.stringify({
              applied_keys: [],
              rejected_keys: [],
              suggestions: [{ key: "a" }],
              run: { status: "pending" },
            }),
          },
        ],
        rowCount: 1,
      };
    });
    const { server, url } = await listen(await createApp());
    try {
      const response = await fetch(`${url}/optimize/runs/7/apply`, {
        method: "POST",
        headers: { "X-User-Id": "owner", "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionKey: "a" }),
      });
      expect(response.status).toBe(200);
      const update = queryMock.mock.calls.find(([sql]) =>
        String(sql).startsWith("update optimization_runs"),
      );
      expect(update).toBeDefined();
      expect(String(update?.[0])).toContain("package_id = $5");
      expect(update?.[1]).toContain("42");
    } finally {
      await close(server);
    }
  });
});
