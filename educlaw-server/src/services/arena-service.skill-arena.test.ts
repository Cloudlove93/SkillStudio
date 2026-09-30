import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const streamTextPartsMock = vi.fn();
const resolveBaselineModelMock = vi.fn();
const generateJsonMock = vi.fn();
const getPackageMock = vi.fn();
const assertRubricConfiguredMock = vi.fn();

async function loadService() {
  vi.resetModules();

  vi.doMock("./db.js", () => ({
    query: queryMock,
    withTransaction: withTransactionMock,
  }));

  vi.doMock("./llm-service.js", () => ({
    generateJson: generateJsonMock,
    resolveBaselineModel: resolveBaselineModelMock,
    streamTextParts: streamTextPartsMock,
    supportsExplicitThinking: vi.fn(() => true),
  }));

  vi.doMock("./package-service.js", () => ({
    getPackage: getPackageMock,
    assertRubricConfigured: assertRubricConfiguredMock,
  }));

  return import("./arena-service.js");
}

function buildCreateArenaThreadHash() {
  return createHash("sha256")
    .update(
      JSON.stringify({
        packageId: "7",
        arenaKind: "skill_arena",
        basePackageVersionId: "33",
        left: {
          skillId: "11",
          skillVersionId: "101",
        },
        right: {
          skillId: "12",
          skillVersionId: "202",
        },
        model: "gpt-5",
        surface: null,
      }),
    )
    .digest("hex");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./db.js");
  vi.doUnmock("./llm-service.js");
  vi.doUnmock("./package-service.js");
  queryMock.mockReset();
  withTransactionMock.mockReset();
  streamTextPartsMock.mockReset();
  resolveBaselineModelMock.mockReset();
  generateJsonMock.mockReset();
  getPackageMock.mockReset();
  assertRubricConfiguredMock.mockReset();
});

describe("createArenaThread", () => {
  it("creates a same-package skill arena thread with fixed skill versions", async () => {
    withTransactionMock.mockImplementation(async (work) =>
      work({
        query: queryMock,
      }),
    );
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith("delete from api_idempotency_keys")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("insert into api_idempotency_keys")) {
        return { rows: [{ id: "1" }], rowCount: 1 };
      }
      if (sql.startsWith("select * from agent_packages where id = $1 and user_id = $2")) {
        return {
          rows: [
            {
              id: 7,
              user_id: "user-1",
              name: "Package",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select * from agent_package_versions where id = $1 and package_id = $2")) {
        expect(params).toEqual(["33", "7"]);
        return {
          rows: [
            {
              id: 33,
              package_id: 7,
              version_number: 4,
              source: "manual",
              snapshot_json: {
                name: "Package",
                description: "",
                versionLabel: "v4",
                agentMd: "agent",
                rubricMd: "rubric",
                skills: [],
              },
              note: "",
              created_at: "2026-07-24T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select sv.*, s.skill_uid")) {
        if (params[0] === "101") {
          return {
            rows: [
              {
                id: 101,
                skill_id: 11,
                package_id: 7,
                version_number: 1,
                skill_uid: "skill-a",
                skill_snapshot_json: {
                  id: "skill-a",
                  dirName: "skill-a",
                  name: "Skill A",
                  description: "A",
                  skillMd: "A body",
                },
              },
            ],
            rowCount: 1,
          };
        }
        if (params[0] === "202") {
          return {
            rows: [
              {
                id: 202,
                skill_id: 12,
                package_id: 7,
                version_number: 2,
                skill_uid: "skill-b",
                skill_snapshot_json: {
                  id: "skill-b",
                  dirName: "skill-b",
                  name: "Skill B",
                  description: "B",
                  skillMd: "B body",
                },
              },
            ],
            rowCount: 1,
          };
        }
      }
      if (sql.startsWith("insert into arena_threads")) {
        return {
          rows: [{ id: 91 }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("insert into arena_thread_variants")) {
        return {
          rows: [],
          rowCount: 1,
        };
      }
      if (sql.startsWith("update api_idempotency_keys")) {
        return {
          rows: [],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { createArenaThread } = await loadService();
    const thread = await createArenaThread({
      authUserId: "user-1",
      packageId: "7",
      arenaKind: "skill_arena",
      basePackageVersionId: "33",
      left: {
        skillId: "11",
        skillVersionId: "101",
      },
      right: {
        skillId: "12",
        skillVersionId: "202",
      },
      model: "gpt-5",
      idempotencyKey: "arena-key-create",
    });

    expect(thread.arenaKind).toBe("skill_arena");
    expect(thread.basePackageVersionId).toBe("33");
    expect(thread.skillArenaConfig).toEqual({
      mode: "skill_arena",
      compositionMode: "skill_only",
      basePackageVersionId: "33",
      left: {
        side: "left",
        skillId: "11",
        skillVersionId: "101",
        skillUid: "skill-a",
        skillName: "Skill A",
        versionNumber: 1,
      },
      right: {
        side: "right",
        skillId: "12",
        skillVersionId: "202",
        skillUid: "skill-b",
        skillName: "Skill B",
        versionNumber: 2,
      },
    });
  });

  it("rejects a selected skill version outside the package graph", async () => {
    withTransactionMock.mockImplementation(async (work) =>
      work({
        query: queryMock,
      }),
    );
    queryMock.mockImplementation(async (sql: string, params: unknown[]) => {
      if (sql.startsWith("delete from api_idempotency_keys")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("insert into api_idempotency_keys")) {
        return { rows: [{ id: "1" }], rowCount: 1 };
      }
      if (sql.startsWith("select * from agent_packages where id = $1 and user_id = $2")) {
        return {
          rows: [{ id: 7, user_id: "user-1" }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select * from agent_package_versions where id = $1 and package_id = $2")) {
        return {
          rows: [{ id: 33, package_id: 7 }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select sv.*, s.skill_uid")) {
        if (params[0] === "101") {
          return {
            rows: [
              {
                id: 101,
                skill_id: 11,
                package_id: 7,
                version_number: 1,
                skill_uid: "skill-a",
                skill_snapshot_json: {
                  id: "skill-a",
                  dirName: "skill-a",
                  name: "Skill A",
                  description: "A",
                  skillMd: "A body",
                },
              },
            ],
            rowCount: 1,
          };
        }
        return {
          rows: [],
          rowCount: 0,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { createArenaThread } = await loadService();

    await expect(
      createArenaThread({
        authUserId: "user-1",
        packageId: "7",
        arenaKind: "skill_arena",
        basePackageVersionId: "33",
        left: {
          skillId: "11",
          skillVersionId: "101",
        },
        right: {
          skillId: "12",
          skillVersionId: "202",
        },
        idempotencyKey: "arena-key-create",
      }),
    ).rejects.toMatchObject({
      code: "SKILL_VERSION_NOT_FOUND",
      status: 404,
    });
  });

  it("returns the first created thread for repeated idempotent requests", async () => {
    const replayed = {
      id: 91,
      packageId: 7,
      title: "Skill Arena: Skill A vs Skill B",
      model: "gpt-5",
      arenaKind: "skill_arena" as const,
      basePackageVersionId: "33",
      skillArenaConfig: {
        mode: "skill_arena" as const,
        compositionMode: "skill_only" as const,
        basePackageVersionId: "33",
        left: {
          side: "left" as const,
          skillId: "11",
          skillVersionId: "101",
          skillUid: "skill-a",
          skillName: "Skill A",
          versionNumber: 1,
        },
        right: {
          side: "right" as const,
          skillId: "12",
          skillVersionId: "202",
          skillUid: "skill-b",
          skillName: "Skill B",
          versionNumber: 2,
        },
      },
      createdAt: "2026-07-24T00:00:00.000Z",
      updatedAt: "2026-07-24T00:00:00.000Z",
    };
    withTransactionMock.mockImplementation(async (work) =>
      work({
        query: queryMock,
      }),
    );
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("delete from api_idempotency_keys")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("insert into api_idempotency_keys")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("select request_hash, status, response_status")) {
        return {
          rows: [
            {
              request_hash: buildCreateArenaThreadHash(),
              status: "completed",
              response_status: 200,
              response_json: replayed,
              expires_at: "2099-01-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { createArenaThread } = await loadService();

    await expect(
      createArenaThread({
        authUserId: "user-1",
        packageId: "7",
        arenaKind: "skill_arena",
        basePackageVersionId: "33",
        left: {
          skillId: "11",
          skillVersionId: "101",
        },
        right: {
          skillId: "12",
          skillVersionId: "202",
        },
        model: "gpt-5",
        idempotencyKey: "arena-key-1",
      }),
    ).resolves.toEqual(replayed);

    expect(
      queryMock.mock.calls.some((call) =>
        String(call[0]).startsWith("insert into arena_threads"),
      ),
    ).toBe(false);
  });

  it("rejects reusing the same idempotency key with different create payload", async () => {
    withTransactionMock.mockImplementation(async (work) =>
      work({
        query: queryMock,
      }),
    );
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("delete from api_idempotency_keys")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("insert into api_idempotency_keys")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("select request_hash, status, response_status")) {
        return {
          rows: [
            {
              request_hash: "different-hash",
              status: "completed",
              response_status: 200,
              response_json: {},
              expires_at: "2099-01-01T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { createArenaThread } = await loadService();

    await expect(
      createArenaThread({
        authUserId: "user-1",
        packageId: "7",
        arenaKind: "skill_arena",
        basePackageVersionId: "33",
        left: {
          skillId: "11",
          skillVersionId: "101",
        },
        right: {
          skillId: "12",
          skillVersionId: "202",
        },
        model: "gpt-5",
        idempotencyKey: "arena-key-1",
      }),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      status: 409,
    });
  });
});

describe("skill arena runtime", () => {
  it("streams both sides from the fixed skill versions instead of the live package", async () => {
    withTransactionMock.mockImplementation(async (work) =>
      work({ query: queryMock }),
    );
    getPackageMock.mockImplementation(() => {
      throw new Error("live package should not be loaded for skill arena");
    });
    let streamCallIndex = 0;
    streamTextPartsMock.mockImplementation(async function* () {
      const answer = streamCallIndex === 0 ? "left answer" : "right answer";
      streamCallIndex += 1;
      yield { type: "content", delta: answer };
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select * from arena_threads where id = $1 and user_id = $2")) {
        return {
          rows: [
            {
              id: 91,
              user_id: "user-1",
              package_id: 7,
              title: "Skill Arena",
              model: "gpt-5",
              arena_kind: "skill_arena",
              base_package_version_id: 33,
              arena_config_jsonb: {
                mode: "skill_arena",
                compositionMode: "skill_only",
                basePackageVersionId: "33",
              },
              created_at: "2026-07-24T00:00:00.000Z",
              updated_at: "2026-07-24T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1 and user_id = $2")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("select * from agent_package_versions where id = $1 and package_id = $2")) {
        return {
          rows: [
            {
              id: 33,
              package_id: 7,
              version_number: 4,
              source: "manual",
              snapshot_json: {
                name: "Historic Package",
                description: "",
                versionLabel: "v4",
                agentMd: "Historic agent",
                rubricMd: "Historic rubric",
                skills: [
                  {
                    id: "current-skill",
                    dirName: "current",
                    name: "Current Skill",
                    description: "current",
                    skillMd: "Current skill body",
                  },
                ],
              },
              note: "",
              created_at: "2026-07-24T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select atv.*, sv.version_number, s.skill_uid, sv.skill_snapshot_json")) {
        return {
          rows: [
            {
              id: 101,
              thread_id: 91,
              package_id: 7,
              side: "left",
              skill_id: 11,
              skill_version_id: 101,
              version_number: 1,
              skill_uid: "skill-a",
              skill_snapshot_json: {
                id: "skill-a",
                dirName: "skill-a",
                name: "Skill A",
                description: "A",
                skillMd: "Skill A body",
              },
              created_at: "2026-07-24T00:00:00.000Z",
            },
            {
              id: 202,
              thread_id: 91,
              package_id: 7,
              side: "right",
              skill_id: 12,
              skill_version_id: 202,
              version_number: 2,
              skill_uid: "skill-b",
              skill_snapshot_json: {
                id: "skill-b",
                dirName: "skill-b",
                name: "Skill B",
                description: "B",
                skillMd: "Skill B body",
              },
              created_at: "2026-07-24T00:00:00.000Z",
            },
          ],
          rowCount: 2,
        };
      }
      // Skill Arena 线程详情会附带版本绑定信息（getSkillArenaVersionInfo）
      if (sql.startsWith("select atv.side,")) {
        return {
          rows: [
            {
              side: "left",
              bound_version_number: 1,
              latest_version_number: 1,
            },
            {
              side: "right",
              bound_version_number: 2,
              latest_version_number: 2,
            },
          ],
          rowCount: 2,
        };
      }
      if (sql.startsWith("insert into arena_messages")) {
        return {
          rows: [{ id: 1 }],
          rowCount: 1,
        };
      }
      if (sql.includes("insert into arena_answer_runs")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("update arena_threads set updated_at = $1")) {
        return {
          rows: [],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { sendMessage } = await loadService();
    const result = await sendMessage("user-1", "91", "请对比回答");

    expect(result.baseline?.content).toBe("left answer");
    expect(result.enhanced?.content).toBe("right answer");
    expect(getPackageMock).not.toHaveBeenCalled();
    expect(resolveBaselineModelMock).not.toHaveBeenCalled();
    expect(streamTextPartsMock).toHaveBeenCalledTimes(2);
    // buildSkillArenaPrompt 使用 [SKILL.md: <skillName>] 格式输出绑定的 Skill
    expect(streamTextPartsMock.mock.calls[0]?.[0]?.systemPrompt).toContain("[SKILL.md: Skill A]");
    expect(streamTextPartsMock.mock.calls[0]?.[0]?.systemPrompt).not.toContain(
      "Current Skill",
    );
    expect(streamTextPartsMock.mock.calls[1]?.[0]?.systemPrompt).toContain("[SKILL.md: Skill B]");
    const answerRunInsert = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("insert into arena_answer_runs"),
    );
    expect(answerRunInsert).toBeDefined();
    expect(answerRunInsert?.[1]).toEqual([
      "user-1",
      "91",
      7,
      33,
      1,
      1,
      1,
      JSON.stringify(["skill-b"]),
      JSON.stringify([]),
      "gpt-5",
      JSON.stringify(["skill-a"]),
      JSON.stringify([]),
      "gpt-5",
      101,
      202,
      expect.any(String),
    ]);
  });

  it("generates reports with fixed skill labels from the bound versions", async () => {
    assertRubricConfiguredMock.mockImplementation((rubricMd: string) => {
      if (!String(rubricMd || "").trim()) {
        throw new Error("missing rubric");
      }
    });
    generateJsonMock.mockResolvedValue({
      baseline: {
        summary: "Left summary",
        total: 7,
        dimensions: [],
      },
      enhanced: {
        summary: "Right summary",
        total: 9,
        dimensions: [],
      },
      recommendation: "Right wins",
      winningSide: "enhanced",
    });
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select * from arena_threads where id = $1 and user_id = $2")) {
        return {
          rows: [
            {
              id: 91,
              user_id: "user-1",
              package_id: 7,
              title: "Skill Arena",
              model: "gpt-5",
              arena_kind: "skill_arena",
              base_package_version_id: 33,
              arena_config_jsonb: {},
              created_at: "2026-07-24T00:00:00.000Z",
              updated_at: "2026-07-24T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1 and user_id = $2")) {
        return {
          rows: [
            {
              id: 1,
              thread_id: 91,
              user_id: "user-1",
              side: "shared",
              role: "user",
              content: "请回答问题",
              created_at: "2026-07-24T00:00:01.000Z",
            },
            {
              id: 2,
              thread_id: 91,
              user_id: "user-1",
              side: "baseline",
              role: "assistant",
              content: "Skill A answer",
              created_at: "2026-07-24T00:00:02.000Z",
            },
            {
              id: 3,
              thread_id: 91,
              user_id: "user-1",
              side: "enhanced",
              role: "assistant",
              content: "Skill B answer",
              created_at: "2026-07-24T00:00:03.000Z",
            },
          ],
          rowCount: 3,
        };
      }
      if (sql.startsWith("select * from agent_package_versions where id = $1 and package_id = $2")) {
        return {
          rows: [
            {
              id: 33,
              package_id: 7,
              version_number: 4,
              source: "manual",
              snapshot_json: {
                name: "Historic Package",
                description: "",
                versionLabel: "v4",
                agentMd: "Historic agent",
                rubricMd: "Historic rubric",
                skills: [],
              },
              note: "",
              created_at: "2026-07-24T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.startsWith("select atv.*, sv.version_number, s.skill_uid, sv.skill_snapshot_json")) {
        return {
          rows: [
            {
              id: 101,
              thread_id: 91,
              package_id: 7,
              side: "left",
              skill_id: 11,
              skill_version_id: 101,
              version_number: 1,
              skill_uid: "skill-a",
              skill_snapshot_json: {
                id: "skill-a",
                dirName: "skill-a",
                name: "Skill A",
                description: "A",
                skillMd: "Skill A body",
              },
              created_at: "2026-07-24T00:00:00.000Z",
            },
            {
              id: 202,
              thread_id: 91,
              package_id: 7,
              side: "right",
              skill_id: 12,
              skill_version_id: 202,
              version_number: 2,
              skill_uid: "skill-b",
              skill_snapshot_json: {
                id: "skill-b",
                dirName: "skill-b",
                name: "Skill B",
                description: "B",
                skillMd: "Skill B body",
              },
              created_at: "2026-07-24T00:00:00.000Z",
            },
          ],
          rowCount: 2,
        };
      }
      // Skill Arena 线程详情会附带版本绑定信息（getSkillArenaVersionInfo）
      if (sql.startsWith("select atv.side,")) {
        return {
          rows: [
            {
              side: "left",
              bound_version_number: 1,
              latest_version_number: 1,
            },
            {
              side: "right",
              bound_version_number: 2,
              latest_version_number: 2,
            },
          ],
          rowCount: 2,
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const { generateReport } = await loadService();
    const report = await generateReport("user-1", "91");

    expect(getPackageMock).not.toHaveBeenCalled();
    expect(report.labels).toEqual({
      baseline: "Skill A v1",
      enhanced: "Skill B v2",
    });
    expect(generateJsonMock.mock.calls[0]?.[0]?.userPrompt).toContain("Historic rubric");
  });
});
