import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";

import { config } from "../config.js";
import { close, createAuthApp, listen, queryMock } from "./auth-test-utils.js";

describe("POST /auth/login", () => {
  it("returns a token and user for valid credentials", async () => {
    const passwordHash = await bcrypt.hash("educlaw123", 10);
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: "user-1",
        username: "user1",
        password_hash: passwordHash,
        created_at: "2026-05-21T00:00:00.000Z",
      }],
    });
    const { server, url } = await listen(await createAuthApp());

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
});
