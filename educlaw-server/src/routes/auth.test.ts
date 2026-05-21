import type { Server } from "node:http";
import bcrypt from "bcryptjs";
import express from "express";
import jwt from "jsonwebtoken";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config } from "../config.js";

const queryMock = vi.fn();

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

async function createApp() {
  vi.resetModules();
  queryMock.mockReset();
  vi.doMock("../services/db.js", () => ({
    query: queryMock,
    newId: () => "test-id",
  }));
  const authRoutes = (await import("./auth.js")).default;
  const app = express();
  app.use(express.json());
  app.use("/auth", authRoutes);
  return app;
}

function signToken(userId: string) {
  return jwt.sign({ sub: userId, username: "tester" }, config.jwtSecret);
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("../services/db.js");
  queryMock.mockReset();
});

describe("auth routes", () => {
  it("POST /auth/register always returns 403 because registration is closed", async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "new-user", password: "secret123" }),
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "注册已关闭，请使用预置账号登录" });
      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });

  it("POST /auth/login returns a token and user for valid credentials", async () => {
    const passwordHash = await bcrypt.hash("educlaw123", 10);
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: "user-1",
        username: "user1",
        password_hash: passwordHash,
        created_at: "2026-05-21T00:00:00.000Z",
      }],
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "user1", password: "educlaw123" }),
      });

      expect(response.status).toBe(200);
      const body = await response.json() as { token: string; user: { id: string; username: string } };
      expect(body.user).toEqual({ id: "user-1", username: "user1" });
      expect(jwt.verify(body.token, config.jwtSecret)).toMatchObject({ sub: "user-1", username: "user1" });
      expect(queryMock).toHaveBeenCalledWith("select * from users where username = $1", ["user1"]);
    } finally {
      await close(server);
    }
  });

  it("POST /auth/login returns 400 for invalid credentials", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "missing", password: "wrong" }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "用户名或密码错误" });
      expect(queryMock).toHaveBeenCalledWith("select * from users where username = $1", ["missing"]);
    } finally {
      await close(server);
    }
  });

  it("GET /auth/me returns the current user for a valid bearer token", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: "user-1",
        username: "user1",
        password_hash: "unused",
        created_at: "2026-05-21T00:00:00.000Z",
      }],
    });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/auth/me`, {
        headers: { Authorization: `Bearer ${signToken("user-1")}` },
      });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ id: "user-1", username: "user1" });
      expect(queryMock).toHaveBeenCalledWith("select * from users where id = $1", ["user-1"]);
    } finally {
      await close(server);
    }
  });

  it("GET /auth/me returns 404 when the token is valid but the user is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/auth/me`, {
        headers: { Authorization: `Bearer ${signToken("missing-user")}` },
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "用户不存在" });
      expect(queryMock).toHaveBeenCalledWith("select * from users where id = $1", ["missing-user"]);
    } finally {
      await close(server);
    }
  });

  it("GET /auth/me rejects a request without a bearer token", async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/auth/me`);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "未登录或登录状态已失效" });
    } finally {
      await close(server);
    }
  });

  it("GET /auth/me rejects a request with an invalid bearer token", async () => {
    const { server, url } = await listen(await createApp());

    try {
      const response = await fetch(`${url}/auth/me`, {
        headers: { Authorization: "Bearer invalid-token" },
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "未登录或登录状态已失效" });
    } finally {
      await close(server);
    }
  });
});
