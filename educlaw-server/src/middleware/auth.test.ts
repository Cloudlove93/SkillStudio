import type { Server } from "node:http";
import express from "express";
import { describe, expect, it } from "vitest";

import { requireAuth, type GatewayAuthedRequest } from "./auth.js";

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
  it("allows a GET request with Kong user headers and exposes userId", async () => {
    const app = express();
    app.get("/protected", requireAuth, (req, res) => {
      const gatewayReq = req as GatewayAuthedRequest;
      res.json({
        userId: gatewayReq.userId,
        username: gatewayReq.username,
        email: gatewayReq.email,
      });
    });
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/protected`, {
        headers: {
          "X-User-Id": "user-123",
          "X-User-Username": "tester",
          "X-User-Email": "tester@example.com",
        },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        userId: "user-123",
        username: "tester",
        email: "tester@example.com",
      });
    } finally {
      await close(server);
    }
  });

  it("rejects a GET request without X-User-Id", async () => {
    const app = express();
    app.get("/protected", requireAuth, (_req, res) => {
      res.json({ ok: true });
    });
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/protected`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Authentication required" });
    } finally {
      await close(server);
    }
  });

  it("uses X-User-Id as the fallback username when X-User-Username is absent", async () => {
    const app = express();
    app.get("/protected", requireAuth, (req, res) => {
      const gatewayReq = req as GatewayAuthedRequest;
      res.json({ userId: gatewayReq.userId, username: gatewayReq.username });
    });
    const { server, url } = await listen(app);

    try {
      const response = await fetch(`${url}/protected`, {
        headers: { "X-User-Id": "user-456" },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ userId: "user-456", username: "user-456" });
    } finally {
      await close(server);
    }
  });
});
