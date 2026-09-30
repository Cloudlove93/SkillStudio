import type { Server } from "node:http";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";

const streamMessageMock = vi.fn();

async function createApp() {
  vi.resetModules();
  vi.doMock("../services/arena-service.js", () => ({
    createThread: vi.fn(),
    generateReport: vi.fn(),
    getThreadDetail: vi.fn(),
    listThreads: vi.fn(),
    sendMessage: vi.fn(),
    streamMessage: streamMessageMock,
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
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected server to listen on a TCP port");
  }
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function postMessage(thinkingEnabled: unknown) {
  const { server, url } = await listen(await createApp());
  try {
    const response = await fetch(
      `${url}/arena/threads/messages/stream?threadId=thread-1`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: "请回答",
          mode: "agent",
          thinkingEnabled,
        }),
      },
    );
    await response.text();
    return response;
  } finally {
    await close(server);
  }
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../services/arena-service.js");
  streamMessageMock.mockReset();
});

describe("POST /arena/threads/messages/stream", () => {
  it("forwards the literal boolean true to the service", async () => {
    streamMessageMock.mockImplementation(async function* () {
      yield { event: "stream_end", data: { ok: true } };
    });

    const response = await postMessage(true);

    expect(response.status).toBe(200);
    expect(streamMessageMock).toHaveBeenCalledWith(
      "user-1",
      "thread-1",
      "请回答",
      undefined,
      "agent",
      true,
    );
  });

  it("does not coerce string values into an enabled thinking request", async () => {
    streamMessageMock.mockImplementation(async function* () {
      yield { event: "stream_end", data: { ok: true } };
    });

    await postMessage("true");

    expect(streamMessageMock.mock.calls[0]?.[5]).toBe(false);
  });
});
