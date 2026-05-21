import { describe, expect, it } from "vitest";

import { close, createAuthApp, listen, queryMock, signToken } from "./auth-test-utils.js";

describe("GET /auth/me", () => {
  it("returns 404 when the token is valid but the user is missing", async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const { server, url } = await listen(await createAuthApp());

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
});
