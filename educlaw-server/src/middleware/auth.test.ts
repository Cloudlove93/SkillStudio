import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";

import { config } from "../config.js";
import { requireAuth } from "./auth.js";
import type { AuthedRequest } from "../types.js";

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

describe("requireAuth", () => {
  it("allows a GET request with a valid bearer token and exposes userId", async () => {
    const token = jwt.sign({ sub: "user-123", username: "tester" }, config.jwtSecret);
    const app = express();
    app.get("/protected", requireAuth, (req, res) => {
      res.json({ userId: (req as AuthedRequest).userId });
    });
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/protected`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: "user-123" });
    } finally {
      await close(server);
    }
  });

  it("rejects a GET request without a bearer token", async () => {
    const app = express();
    app.get("/protected", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/protected`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "未登录或登录状态已失效" });
    } finally {
      await close(server);
    }
  });

  it("rejects a GET request when token verification throws", async () => {
    const app = express();
    app.get("/protected", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/protected`, {
        headers: { Authorization: "Bearer bad-token" },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "未登录或登录状态已失效" });
    } finally {
      await close(server);
    }
  });
});
