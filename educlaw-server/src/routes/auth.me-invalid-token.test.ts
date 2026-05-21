import { describe, expect, it } from "vitest";

import { close, createAuthApp, listen } from "./auth-test-utils.js";

describe("GET /auth/me", () => {
  it("rejects a request with an invalid bearer token", async () => {
    const { server, url } = await listen(await createAuthApp());

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
