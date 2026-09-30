import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
  poolEnd: vi.fn(),
  clientQuery: vi.fn(),
  release: vi.fn(),
}));

vi.mock("pg", () => ({
  Pool: class {
    connect = mocks.connect;
    query = mocks.poolQuery;
    end = mocks.poolEnd;
  },
}));

vi.mock("../config.js", () => ({
  config: { databaseUrl: "postgres://test" },
}));

describe("withTransaction", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.connect.mockResolvedValue({
      query: mocks.clientQuery,
      release: mocks.release,
    });
    mocks.clientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("commits successful short work and releases the client", async () => {
    const { withTransaction } = await import("./db.js");

    const result = await withTransaction(async (client) => {
      await client.query("insert work");
      return "saved";
    });

    expect(result).toBe("saved");
    expect(mocks.clientQuery.mock.calls.map((call) => call[0])).toEqual([
      "begin",
      "insert work",
      "commit",
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("rolls back failed work and releases the client", async () => {
    const { withTransaction } = await import("./db.js");

    await expect(
      withTransaction(async (client) => {
        await client.query("insert work");
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");

    expect(mocks.clientQuery.mock.calls.map((call) => call[0])).toEqual([
      "begin",
      "insert work",
      "rollback",
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
