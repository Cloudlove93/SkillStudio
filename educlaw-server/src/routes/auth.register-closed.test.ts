import { describe, expect, it } from "vitest";

import { close, createAuthApp, listen, queryMock } from "./auth-test-utils.js";

describe("POST /auth/register", () => {
  it("always returns 403 because registration is closed", async () => {
    const { server, url } = await listen(await createAuthApp());

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
});
