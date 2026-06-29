import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.hoisted(() => vi.fn());
const checkDbConnectionMock = vi.hoisted(() => vi.fn());

vi.mock("./db.js", () => ({
  checkDbConnection: checkDbConnectionMock,
  query: queryMock,
}));

describe("db schema initialization", () => {
  beforeEach(() => {
    queryMock.mockReset();
    checkDbConnectionMock.mockReset();
  });

  it("checks the database connection before running schema and migration statements", async () => {
    const { initDbSchema, schemaStatements, migrationStatements } = await import("./db-schema.js");

    await initDbSchema();

    expect(checkDbConnectionMock).toHaveBeenCalledOnce();
    const totalExpected = schemaStatements.length + migrationStatements.length;
    expect(queryMock).toHaveBeenCalledTimes(totalExpected);

    // First N calls are schema statements
    const schemaCalls = queryMock.mock.calls.slice(0, schemaStatements.length).map((call) => call[0]);
    expect(schemaCalls).toEqual(schemaStatements);

    // Remaining calls are migration statements
    const migrationCalls = queryMock.mock.calls.slice(schemaStatements.length).map((call) => call[0]);
    expect(migrationCalls).toEqual(migrationStatements);
  });

  it("keeps all existing application tables in the manual schema script", async () => {
    const { schemaStatements } = await import("./db-schema.js");
    const schemaSql = schemaStatements.join("\n").toLowerCase();

    expect(schemaSql).toContain("create table if not exists agent_packages");
    expect(schemaSql).toContain("create table if not exists agent_package_versions");
    expect(schemaSql).toContain("create table if not exists arena_threads");
    expect(schemaSql).toContain("create table if not exists arena_messages");
    expect(schemaSql).toContain("create table if not exists arena_runs");
    expect(schemaSql).toContain("create table if not exists optimization_runs");
    expect(schemaSql).toContain("create table if not exists interactive_optimization_sessions");
    expect(schemaSql).toContain("create table if not exists auto_eval_specs");
    expect(schemaSql).toContain("create table if not exists auto_eval_runs");
    expect(schemaSql).toContain("alter table agent_package_versions add column if not exists note");
  });
});
