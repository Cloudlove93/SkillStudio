import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { afterEach, vi } from "vitest";

import { config } from "../config.js";

export const queryMock = vi.fn();

export async function listen(app: express.Express): Promise<{ server: Server; url: string }> {
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

export async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

export async function createAuthApp() {
  vi.resetModules();
  vi.doMock("../services/db.js", () => ({
    query: queryMock,
    newId: () => "test-id",
  }));
  const authRoutes = (await import("./auth.js")).default;
  const app = express();
  app.use(express.json());
  app.use(authRoutes);
  return app;
}

export function signToken(userId: string) {
  return jwt.sign({ sub: userId, username: "tester" }, config.jwtSecret);
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../services/db.js");
  queryMock.mockReset();
});
