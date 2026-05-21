import { describe, expect, it } from "vitest";

import { close, createAuthApp, listen, queryMock } from "./auth-test-utils.js";

describe("POST /auth/login", () => {
  it("returns 400 for invalid credentials", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { server, url } = await listen(await createAuthApp());

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
});
