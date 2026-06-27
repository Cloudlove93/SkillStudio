import { describe, expect, it } from "vitest";

import { close, createAuthApp, listen, queryMock } from "./auth-test-utils.js";

describe("POST /auth/register", () => {
  it("requires a valid invite code", async () => {
    const { server, url } = await listen(await createAuthApp());

    try {
      const response = await fetch(`${url}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "new-user", password: "secret123" }),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "邀请码无效" });
      expect(queryMock).not.toHaveBeenCalled();
    } finally {
      await close(server);
    }
  });
});
