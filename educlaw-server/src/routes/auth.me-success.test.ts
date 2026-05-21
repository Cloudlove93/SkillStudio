import { describe, expect, it } from "vitest";

import { close, createAuthApp, listen, queryMock, signToken } from "./auth-test-utils.js";

describe("GET /auth/me", () => {
  it("returns the current user for a valid bearer token", async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{
        id: "user-1",
        username: "user1",
        password_hash: "unused",
        created_at: "2026-05-21T00:00:00.000Z",
      }],
    });
    const { server, url } = await listen(await createAuthApp());

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
});
