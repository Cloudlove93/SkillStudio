import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const applyManualMarkdownEditMock = vi.fn();

async function createApp() {
  vi.resetModules();
  vi.doMock("../services/package-service.js", () => ({
    applyManualMarkdownEdit: applyManualMarkdownEditMock,
    compareVersions: vi.fn(),
    deletePackage: vi.fn(),
    exportPackageZip: vi.fn(),
    generatePackage: vi.fn(),
    getPackage: vi.fn(),
    importPackageZip: vi.fn(),
    listPackages: vi.fn(),
    listVersions: vi.fn(),
    renamePackage: vi.fn(),
    updateVersionNote: vi.fn(),
  }));
  vi.doMock("../services/optimization-service.js", () => ({
    optimizePackage: vi.fn(),
  }));
  vi.doMock("../services/interactive-optimization-service.js", () => ({
    applyInteractiveChanges: vi.fn(),
    chatOptimize: vi.fn(),
    diagnosePackage: vi.fn(),
    getInteractiveSession: vi.fn(),
    listInteractiveSessions: vi.fn(),
  }));
  const router = (await import("./packages.js")).default;
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
  vi.doUnmock("../services/package-service.js");
  vi.doUnmock("../services/optimization-service.js");
  vi.doUnmock("../services/interactive-optimization-service.js");
  applyManualMarkdownEditMock.mockReset();
});

describe("POST /packages/:packageId/manual-edit", () => {
  it("passes the rubric target through to the package service", async () => {
    applyManualMarkdownEditMock.mockResolvedValue({ ok: true });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/packages/pkg-1/manual-edit`, {
        method: "POST",
        headers: {
          "X-User-Id": "user-1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          target: "rubric",
          content: "# Rubric\n\n## 评分目标",
          note: "update rubric",
        }),
      });

      expect(response.status).toBe(200);
      expect(applyManualMarkdownEditMock).toHaveBeenCalledWith("user-1", "pkg-1", {
        target: "rubric",
        skillId: undefined,
        content: "# Rubric\n\n## 评分目标",
        note: "update rubric",
      });
    } finally {
      await close(server);
    }
  });
});
