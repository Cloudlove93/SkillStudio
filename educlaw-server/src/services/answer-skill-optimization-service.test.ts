import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArenaAnswerRun } from "./arena-service.js";
import type { CreateAnswerSkillOptimizationRunInput } from "./answer-skill-optimization-service.js";
import type { DbRowAnswerSkillOptimizationRun } from "../types.js";

const queryMock = vi.fn();
const getArenaAnswerRunMock = vi.fn();

class MockArenaAnswerRunNotFoundError extends Error {}

const createdAt = "2026-07-22T06:00:00.000Z";
const createKey = "11111111-1111-4111-8111-111111111111";
const secondCreateKey = "22222222-2222-4222-8222-222222222222";
const thirdCreateKey = "33333333-3333-4333-8333-333333333333";

let storedRows: DbRowAnswerSkillOptimizationRun[] = [];
let nextOptimizationId = 7001;
let uniqueViolationCount = 0;
let recoveryWriteCount = 0;
let summaryRows: Array<{
  enhanced_answer_message_id: number | string;
  answer_run_id: number | string | null;
  context_message_ids: unknown | null;
  enhanced_model: string | null;
  optimization_id: number | string | null;
  status: string | null;
  final_version_id: number | string | null;
  version_number: number | string | null;
}> = [];

const defaultAnswerRun: ArenaAnswerRun = {
  id: 9001,
  userId: "user-1",
  threadId: 101,
  packageId: 301,
  packageVersionId: 501,
  questionMessageId: 1001,
  enhancedAnswerMessageId: 2002,
  baselineAnswerMessageId: 2001,
  usedSkillIds: ["skill-bullying"],
  contextMessageIds: [],
  enhancedModel: "resolved-enhanced-model",
  baselineUsedSkillIds: ["skill-bullying"],
  baselineContextMessageIds: [],
  baselineModel: "resolved-enhanced-model",
  baselineSkillVersionId: 101,
  enhancedSkillVersionId: 202,
  createdAt,
};

function createInput(
  overrides: Partial<CreateAnswerSkillOptimizationRunInput> = {},
): CreateAnswerSkillOptimizationRunInput {
  return {
    userId: "user-1",
    packageId: 301,
    threadId: 101,
    questionMessageId: 1001,
    enhancedAnswerMessageId: 2002,
    baselineAnswerMessageId: 2001,
    feedback: "  Please add concrete response steps.  ",
    idempotencyKey: createKey,
    ...overrides,
  };
}

function createStoredRow(
  overrides: Partial<DbRowAnswerSkillOptimizationRun> = {},
): DbRowAnswerSkillOptimizationRun {
  return {
    id: 7001,
    user_id: "user-1",
    package_id: 301,
    thread_id: 101,
    base_version_id: 501,
    question_message_id: 1001,
    enhanced_answer_message_id: 2002,
    baseline_answer_message_id: 2001,
    user_feedback: "Please add concrete response steps.",
    target_skill_id: null,
    result_json: {},
    status: "processing",
    revision: 1,
    create_request_key: createKey,
    create_request_hash: "a".repeat(64),
    final_version_id: null,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function nullableNumber(value: unknown): number | null {
  return value === null ? null : Number(value);
}

function configureQueryMock() {
  queryMock.mockImplementation(
    async (sql: string, values: unknown[] = []) => {
      if (sql.includes("update answer_skill_optimization_runs o")) {
        let rowCount = 0;
        for (const row of storedRows) {
          if (
            row.user_id !== values[0] ||
            row.thread_id !== values[1] ||
            row.status !== "processing" ||
            new Date(row.updated_at).getTime() >
              new Date(String(values[4])).getTime()
          ) {
            continue;
          }
          const parsed = row.result_json as Record<string, unknown>;
          row.result_json = {
            ...parsed,
            failure: JSON.parse(String(values[2])) as unknown,
            idempotencyResults: {},
          };
          row.status = "failed";
          row.updated_at = String(values[3]);
          const summary = summaryRows.find(
            (candidate) => Number(candidate.optimization_id) === Number(row.id),
          );
          if (summary) summary.status = "failed";
          rowCount += 1;
        }
        return { rows: [], rowCount };
      }
      if (
        sql.includes("set result_json = $1, status = 'failed'") &&
        sql.includes("updated_at = $6::timestamptz")
      ) {
        const row = storedRows.find(
          (candidate) =>
            candidate.id === values[2] &&
            candidate.user_id === values[3] &&
            candidate.status === "processing" &&
            candidate.revision === values[4] &&
            new Date(candidate.updated_at).toISOString() ===
              new Date(String(values[5])).toISOString(),
        );
        if (!row) return { rows: [], rowCount: 0 };
        row.result_json = JSON.parse(String(values[0])) as unknown;
        row.status = "failed";
        row.updated_at = String(values[1]);
        recoveryWriteCount += 1;
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes("from arena_messages m")) {
        return { rows: summaryRows, rowCount: summaryRows.length };
      }
      if (
        sql.includes("from answer_skill_optimization_runs r") &&
        sql.includes("r.status <> 'cancelled'")
      ) {
        const row = storedRows
          .filter(
            (candidate) =>
              candidate.user_id === values[0] &&
              ((candidate.answer_message_id ?? candidate.enhanced_answer_message_id) === values[1]) &&
              candidate.status !== "cancelled",
          )
          .sort((left, right) => Number(right.id) - Number(left.id))[0];
        return {
          rows: row
            ? [
                {
                  ...row,
                  final_version_number:
                    row.final_version_id === null ? null : 2,
                },
              ]
            : [],
          rowCount: row ? 1 : 0,
        };
      }

      if (sql.includes("insert into answer_skill_optimization_runs")) {
        const userId = String(values[0]);
        const requestKey = String(values[12]);
        if (
          storedRows.some(
            (row) =>
              row.user_id === userId &&
              row.create_request_key === requestKey,
          )
        ) {
          uniqueViolationCount += 1;
          throw Object.assign(new Error("duplicate create request"), {
            code: "23505",
            constraint:
              "answer_skill_optimization_runs_user_create_key_unique",
          });
        }
        if (
          storedRows.some(
            (row) =>
              row.user_id === userId &&
              (row.answer_message_id ?? row.enhanced_answer_message_id) === Number(values[18]) &&
              row.status !== "cancelled",
          )
        ) {
          throw Object.assign(new Error("duplicate active answer"), {
            code: "23505",
            constraint:
              "uq_answer_skill_optimization_runs_non_cancelled_answer",
          });
        }

        const row: DbRowAnswerSkillOptimizationRun = {
          id: nextOptimizationId,
          user_id: userId,
          package_id: Number(values[1]),
          thread_id: Number(values[2]),
          base_version_id: Number(values[3]),
          question_message_id: Number(values[4]),
          enhanced_answer_message_id: Number(values[5]),
          baseline_answer_message_id: nullableNumber(values[6]),
          user_feedback: String(values[7]),
          target_skill_id: null,
          result_json: JSON.parse(String(values[9])) as unknown,
          status: String(values[10]),
          revision: Number(values[11]),
          create_request_key: requestKey,
          create_request_hash: String(values[13]),
          final_version_id: null,
          created_at: String(values[15]),
          updated_at: String(values[16]),
          answer_side: values[17] as "baseline" | "enhanced",
          answer_message_id: Number(values[18]),
          evidence_version_id: Number(values[19]),
          answer_skill_version_id: nullableNumber(values[20]),
          working_skill_version_id: nullableNumber(values[21]),
        };
        nextOptimizationId += 1;
        storedRows.push(row);
        return { rows: [row], rowCount: 1 };
      }

      if (sql.includes("create_request_key = $2")) {
        const row = storedRows.find(
          (candidate) =>
            candidate.user_id === values[0] &&
            candidate.create_request_key === values[1],
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      if (sql.includes("where user_id = $1 and id = $2")) {
        const row = storedRows.find(
          (candidate) =>
            candidate.user_id === values[0] && candidate.id === values[1],
        );
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  );
}

async function loadService() {
  vi.resetModules();
  vi.doMock("./db.js", () => ({ query: queryMock }));
  vi.doMock("./arena-service.js", () => ({
    ArenaAnswerRunNotFoundError: MockArenaAnswerRunNotFoundError,
    getAnswerOptimizationAvailability: (
      run: Pick<ArenaAnswerRun, "contextMessageIds" | "enhancedModel"> | null,
    ) =>
      !run
        ? { available: false, reason: "missing_answer_run" }
        : run.contextMessageIds === null
          ? { available: false, reason: "replay_context_unavailable" }
          : !run.enhancedModel?.trim()
            ? { available: false, reason: "replay_model_unavailable" }
            : { available: true, reason: null },
    getArenaAnswerRunByEnhancedMessage: getArenaAnswerRunMock,
    getArenaAnswerRunByMessage: getArenaAnswerRunMock,
    parseArenaAnswerContextMessageIds: (value: unknown) => value,
    parseArenaAnswerEnhancedModel: (value: unknown) => value,
  }));
  return import("./answer-skill-optimization-service.js");
}

beforeEach(() => {
  storedRows = [];
  nextOptimizationId = 7001;
  uniqueViolationCount = 0;
  recoveryWriteCount = 0;
  summaryRows = [];
  queryMock.mockReset();
  getArenaAnswerRunMock.mockReset();
  configureQueryMock();
  getArenaAnswerRunMock.mockResolvedValue(defaultAnswerRun);
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./db.js");
  vi.doUnmock("./arena-service.js");
});

describe("publicDraft", () => {
  it("returns the complete Skill preview with validation metadata", async () => {
    const { publicDraft } = await loadService();

    expect(publicDraft({
      skillId: "skill-bullying",
      skillMd: "# Skill\n\n## Instructions\nUse the revised workflow.",
      validation: { valid: true, errors: [] },
    })).toEqual({
      skillId: "skill-bullying",
      previewContent: "# Skill\n\n## Instructions\nUse the revised workflow.",
      validation: { valid: true, errors: [] },
    });
  });
});

describe("createAnswerSkillOptimizationRun", () => {
  it("creates an independent optimization for the baseline Arena answer", async () => {
    const { createAnswerSkillOptimizationRun } = await loadService();

    const run = await createAnswerSkillOptimizationRun(createInput({
      answerSide: "baseline",
      answerMessageId: 2001,
    }));

    expect(run).toMatchObject({
      answerSide: "baseline",
      answerMessageId: 2001,
      answerSkillVersionId: 101,
      workingSkillVersionId: 101,
      enhancedAnswerMessageId: 2002,
    });
    expect(getArenaAnswerRunMock).toHaveBeenCalledWith("user-1", 2001);
  });

  it("creates a processing run from trusted Arena provenance", async () => {
    const { createAnswerSkillOptimizationRun } = await loadService();

    const run = await createAnswerSkillOptimizationRun(createInput());

    expect(run).toMatchObject({
      id: 7001,
      userId: "user-1",
      packageId: 301,
      threadId: 101,
      baseVersionId: 501,
      questionMessageId: 1001,
      enhancedAnswerMessageId: 2002,
      baselineAnswerMessageId: 2001,
      answerSide: "enhanced",
      answerMessageId: 2002,
      evidenceVersionId: 501,
      answerSkillVersionId: 202,
      workingSkillVersionId: 202,
      userFeedback: "Please add concrete response steps.",
      targetSkillId: null,
      result: {},
      status: "processing",
      revision: 1,
      finalVersionId: null,
    });
    expect(run).not.toHaveProperty("createRequestKey");
    expect(run).not.toHaveProperty("createRequestHash");
    expect(storedRows[0]?.create_request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(getArenaAnswerRunMock).toHaveBeenCalledWith("user-1", 2002);
  });

  it.each([
    [
      "missing replay context",
      { contextMessageIds: null, enhancedModel: "resolved-enhanced-model" },
      "replay_context_unavailable",
    ],
    [
      "missing replay model",
      { contextMessageIds: [], enhancedModel: null },
      "replay_model_unavailable",
    ],
    [
      "blank replay model",
      { contextMessageIds: [], enhancedModel: "   " },
      "replay_model_unavailable",
    ],
  ] as const)(
    "rejects %s before inserting an optimization",
    async (_label, provenance, reason) => {
      getArenaAnswerRunMock.mockResolvedValue({
        ...defaultAnswerRun,
        ...provenance,
      });
      const {
        AnswerSkillOptimizationReplayUnavailableError,
        createAnswerSkillOptimizationRun,
      } = await loadService();

      const failure = await createAnswerSkillOptimizationRun(
        createInput(),
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(
        AnswerSkillOptimizationReplayUnavailableError,
      );
      expect(failure).toMatchObject({ reason });
      expect(storedRows).toHaveLength(0);
      expect(
        queryMock.mock.calls.some((call) =>
          String(call[0]).includes(
            "insert into answer_skill_optimization_runs",
          ),
        ),
      ).toBe(false);
    },
  );

  it("derives baseVersionId from provenance and rejects forged extra fields", async () => {
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationValidationError } =
      await loadService();
    const forged = {
      ...createInput(),
      baseVersionId: 999,
      snapshot: { name: "forged" },
      skillMd: "forged skill",
    } as CreateAnswerSkillOptimizationRunInput & {
      baseVersionId: number;
      snapshot: Record<string, unknown>;
      skillMd: string;
    };

    await expect(createAnswerSkillOptimizationRun(forged)).rejects.toBeInstanceOf(
      AnswerSkillOptimizationValidationError,
    );
    expect(storedRows).toHaveLength(0);

    const run = await createAnswerSkillOptimizationRun(
      createInput({ idempotencyKey: secondCreateKey }),
    );
    expect(run.baseVersionId).toBe(defaultAnswerRun.packageVersionId);
  });

  it("persists a null baseline for enhanced-only provenance", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      ...defaultAnswerRun,
      baselineAnswerMessageId: null,
    });
    const { createAnswerSkillOptimizationRun } = await loadService();
    const input = createInput();
    delete input.baselineAnswerMessageId;

    const run = await createAnswerSkillOptimizationRun(input);

    expect(run.baselineAnswerMessageId).toBeNull();
    expect(storedRows[0]?.baseline_answer_message_id).toBeNull();
  });

  it.each([
    ["packageId", { packageId: 999 }],
    ["threadId", { threadId: 999 }],
    ["questionMessageId", { questionMessageId: 999 }],
    ["enhancedAnswerMessageId", { enhancedAnswerMessageId: 999 }],
  ] satisfies Array<
    [string, Partial<CreateAnswerSkillOptimizationRunInput>]
  >)("rejects a mismatched %s", async (_label, overrides) => {
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationValidationError } =
      await loadService();

    await expect(
      createAnswerSkillOptimizationRun(createInput(overrides)),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
    expect(storedRows).toHaveLength(0);
  });

  it("rejects a mismatched baseline answer", async () => {
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationValidationError } =
      await loadService();

    await expect(
      createAnswerSkillOptimizationRun(
        createInput({ baselineAnswerMessageId: 2999 }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
  });

  it("returns not found when provenance is outside the owner scope", async () => {
    getArenaAnswerRunMock.mockRejectedValue(
      new MockArenaAnswerRunNotFoundError(),
    );
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationNotFoundError } =
      await loadService();

    await expect(
      createAnswerSkillOptimizationRun(createInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationNotFoundError);
    expect(storedRows).toHaveLength(0);
  });

  it.each(["   ", "x".repeat(2001)])(
    "rejects invalid feedback",
    async (feedback) => {
      const {
        createAnswerSkillOptimizationRun,
        AnswerSkillOptimizationValidationError,
      } = await loadService();

      await expect(
        createAnswerSkillOptimizationRun(createInput({ feedback })),
      ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
      expect(getArenaAnswerRunMock).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-UUID idempotency key", async () => {
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationValidationError } =
      await loadService();

    await expect(
      createAnswerSkillOptimizationRun(
        createInput({ idempotencyKey: "not-a-uuid" }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
  });

  it("does not treat another unique constraint as an idempotent retry", async () => {
    const { createAnswerSkillOptimizationRun } = await loadService();
    const databaseError = Object.assign(new Error("duplicate primary key"), {
      code: "23505",
      constraint: "answer_skill_optimization_runs_pkey",
    });
    queryMock.mockRejectedValueOnce(databaseError);

    await expect(
      createAnswerSkillOptimizationRun(createInput()),
    ).rejects.toBe(databaseError);
  });

  it("returns the existing run for the same key and request hash", async () => {
    const { createAnswerSkillOptimizationRun } = await loadService();

    const first = await createAnswerSkillOptimizationRun(createInput());
    const retried = await createAnswerSkillOptimizationRun(createInput());

    expect(retried.id).toBe(first.id);
    expect(storedRows).toHaveLength(1);
    expect(uniqueViolationCount).toBe(0);
  });

  it("rejects the same key with different feedback", async () => {
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationConflictError } =
      await loadService();
    await createAnswerSkillOptimizationRun(createInput());

    await expect(
      createAnswerSkillOptimizationRun(
        createInput({ feedback: "A different reusable preference" }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
  });

  it("rejects the same key with a different valid answer", async () => {
    getArenaAnswerRunMock.mockImplementation(
      async (_userId: string, enhancedAnswerMessageId: number) =>
        enhancedAnswerMessageId === 2003
          ? {
              ...defaultAnswerRun,
              id: 9002,
              questionMessageId: 1004,
              enhancedAnswerMessageId: 2003,
              baselineAnswerMessageId: null,
            }
          : defaultAnswerRun,
    );
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationConflictError } =
      await loadService();
    await createAnswerSkillOptimizationRun(createInput());

    await expect(
      createAnswerSkillOptimizationRun(
        createInput({
          questionMessageId: 1004,
          enhancedAnswerMessageId: 2003,
          baselineAnswerMessageId: null,
        }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
  });

  it("handles concurrent identical creates through the unique constraint", async () => {
    const { createAnswerSkillOptimizationRun } = await loadService();

    const [first, second] = await Promise.all([
      createAnswerSkillOptimizationRun(createInput()),
      createAnswerSkillOptimizationRun(createInput()),
    ]);

    expect(first.id).toBe(second.id);
    expect(storedRows).toHaveLength(1);
    expect(uniqueViolationCount).toBe(1);
  });

  it("reports conflict for concurrent creates with different hashes", async () => {
    const { createAnswerSkillOptimizationRun, AnswerSkillOptimizationConflictError } =
      await loadService();

    const results = await Promise.allSettled([
      createAnswerSkillOptimizationRun(createInput()),
      createAnswerSkillOptimizationRun(
        createInput({ feedback: "Different concurrent feedback" }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejection = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejection?.reason).toBeInstanceOf(
      AnswerSkillOptimizationConflictError,
    );
    expect(storedRows).toHaveLength(1);
  });

  it.each([
    "processing",
    "target_selection_required",
    "draft_ready",
    "test_ready",
    "failed",
  ] as const)(
    "blocks a second create while the existing task is %s",
    async (status) => {
      storedRows.push(
        createStoredRow({
          status,
          ...(status === "processing"
            ? { updated_at: new Date().toISOString() }
            : {}),
        }),
      );
      const {
        AnswerSkillOptimizationAlreadyExistsError,
        createAnswerSkillOptimizationRun,
      } = await loadService();

      const failure = await createAnswerSkillOptimizationRun(
        createInput({ idempotencyKey: secondCreateKey }),
      ).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(
        AnswerSkillOptimizationAlreadyExistsError,
      );
      expect(failure).toMatchObject({
        code: "answer_optimization_already_exists",
        existingOptimizationId: 7001,
        status,
      });
      expect(storedRows).toHaveLength(1);
    },
  );

  it("permanently blocks a completed answer and reports its final version", async () => {
    storedRows.push(
      createStoredRow({
        status: "completed",
        final_version_id: 8001,
      }),
    );
    const { createAnswerSkillOptimizationRun } = await loadService();

    const failure = await createAnswerSkillOptimizationRun(
      createInput({ idempotencyKey: secondCreateKey }),
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "answer_already_optimized",
      existingOptimizationId: 7001,
      status: "completed",
      finalVersionId: 8001,
      versionNumber: 2,
    });
    expect(storedRows).toHaveLength(1);
  });

  it("does not substitute a package version number when the final Skill version cannot be resolved", async () => {
    storedRows.push(
      createStoredRow({
        status: "completed",
        final_version_id: 8001,
        target_skill_id: null,
      }),
    );
    queryMock.mockImplementationOnce(async (sql: string) => {
      expect(sql).toContain("sv.version_number as final_version_number");
      expect(sql).not.toContain("coalesce(sv.version_number, v.version_number)");
      return {
        rows: [{ ...storedRows[0], final_version_number: null }],
        rowCount: 1,
      };
    });
    const { createAnswerSkillOptimizationRun } = await loadService();

    const failure = await createAnswerSkillOptimizationRun(
      createInput({ idempotencyKey: secondCreateKey }),
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "answer_already_optimized",
      versionNumber: null,
    });
  });

  it("allows a cancelled answer optimization to restart with a new key", async () => {
    storedRows.push(createStoredRow({ status: "cancelled" }));
    nextOptimizationId = 7002;
    const { createAnswerSkillOptimizationRun } = await loadService();

    const restarted = await createAnswerSkillOptimizationRun(
      createInput({ idempotencyKey: secondCreateKey }),
    );

    expect(restarted.id).toBe(7002);
    expect(restarted.status).toBe("processing");
    expect(storedRows).toHaveLength(2);
  });

  it("allows only one non-cancelled task across concurrent create keys", async () => {
    const {
      AnswerSkillOptimizationAlreadyExistsError,
      createAnswerSkillOptimizationRun,
    } = await loadService();

    const results = await Promise.allSettled([
      createAnswerSkillOptimizationRun(
        createInput({ idempotencyKey: secondCreateKey }),
      ),
      createAnswerSkillOptimizationRun(
        createInput({ idempotencyKey: thirdCreateKey }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const rejected = results.find(
      (result): result is PromiseRejectedResult =>
        result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(
      AnswerSkillOptimizationAlreadyExistsError,
    );
    expect(storedRows.filter((row) => row.status !== "cancelled")).toHaveLength(
      1,
    );
  });

  it("recovers a stale existing create task and does not create a second row", async () => {
    storedRows.push(createStoredRow());
    const { createAnswerSkillOptimizationRun } = await loadService();

    const failure = await createAnswerSkillOptimizationRun(
      createInput({ idempotencyKey: secondCreateKey }),
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "answer_optimization_already_exists",
      existingOptimizationId: 7001,
      status: "failed",
    });
    expect(storedRows).toHaveLength(1);
    expect(storedRows[0]?.status).toBe("failed");
    expect(recoveryWriteCount).toBe(1);
  });
});

describe("resolveAnswerSkillOptimizationReference", () => {
  it("returns the existing task for the exact answer identity", async () => {
    storedRows.push(createStoredRow({ status: "draft_ready" }));
    const { resolveAnswerSkillOptimizationReference } = await loadService();

    const existing = await resolveAnswerSkillOptimizationReference({
      userId: "user-1",
      packageId: 301,
      threadId: 101,
      questionMessageId: 1001,
      answerMessageId: 2002,
      answerSide: "enhanced",
    });

    expect(existing).toEqual({
      optimizationId: 7001,
      status: "draft_ready",
      versionNumber: null,
    });
    expect(getArenaAnswerRunMock).toHaveBeenCalledWith("user-1", 2002);
  });

  it("rejects answer identity fields that do not match recorded provenance", async () => {
    storedRows.push(createStoredRow({ status: "draft_ready" }));
    const {
      resolveAnswerSkillOptimizationReference,
      AnswerSkillOptimizationNotFoundError,
    } = await loadService();

    await expect(resolveAnswerSkillOptimizationReference({
      userId: "user-1",
      packageId: 999,
      threadId: 101,
      questionMessageId: 1001,
      answerMessageId: 2002,
      answerSide: "enhanced",
    })).rejects.toBeInstanceOf(AnswerSkillOptimizationNotFoundError);
  });

  it("restores a baseline Arena optimization independently from the enhanced side", async () => {
    storedRows.push(createStoredRow({
      answer_side: "baseline",
      answer_message_id: 2001,
      answer_skill_version_id: 101,
      working_skill_version_id: 101,
      status: "test_ready",
    }));
    const { resolveAnswerSkillOptimizationReference } = await loadService();

    await expect(resolveAnswerSkillOptimizationReference({
      userId: "user-1",
      packageId: 301,
      threadId: 101,
      questionMessageId: 1001,
      answerMessageId: 2001,
      answerSide: "baseline",
    })).resolves.toEqual({
      optimizationId: 7001,
      status: "test_ready",
      versionNumber: null,
    });
  });

  it("does not restore an optimization row whose stored answer provenance is inconsistent", async () => {
    storedRows.push(createStoredRow({
      package_id: 999,
      status: "draft_ready",
    }));
    const {
      resolveAnswerSkillOptimizationReference,
      AnswerSkillOptimizationNotFoundError,
    } = await loadService();

    await expect(resolveAnswerSkillOptimizationReference({
      userId: "user-1",
      packageId: 301,
      threadId: 101,
      questionMessageId: 1001,
      answerMessageId: 2002,
      answerSide: "enhanced",
    })).rejects.toBeInstanceOf(AnswerSkillOptimizationNotFoundError);
  });
});

describe("getAnswerSkillOptimizationRun", () => {
  it("returns an owner-scoped camelCase domain object", async () => {
    storedRows.push(
      createStoredRow({
        created_at: new Date(createdAt) as unknown as string,
        updated_at: new Date(createdAt) as unknown as string,
      }),
    );
    const { getAnswerSkillOptimizationRun } = await loadService();

    const run = await getAnswerSkillOptimizationRun("user-1", 7001);

    expect(run).toEqual({
      id: 7001,
      userId: "user-1",
      packageId: 301,
      threadId: 101,
      baseVersionId: 501,
      questionMessageId: 1001,
      enhancedAnswerMessageId: 2002,
      baselineAnswerMessageId: 2001,
      answerSide: "enhanced",
      answerMessageId: 2002,
      evidenceVersionId: 501,
      answerSkillVersionId: null,
      workingSkillVersionId: null,
      userFeedback: "Please add concrete response steps.",
      targetSkillId: null,
      result: {},
      status: "processing",
      revision: 1,
      finalVersionId: null,
      createdAt,
      updatedAt: createdAt,
    });
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("where user_id = $1 and id = $2"),
      ["user-1", 7001],
    );
  });

  it("returns not found to a different owner", async () => {
    storedRows.push(createStoredRow());
    const { getAnswerSkillOptimizationRun, AnswerSkillOptimizationNotFoundError } =
      await loadService();

    await expect(
      getAnswerSkillOptimizationRun("user-2", 7001),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationNotFoundError);
  });

  it.each([
    ["status", { status: "unknown" }],
    ["revision", { revision: 0 }],
    ["result_json", { result_json: [] }],
  ] satisfies Array<
    [string, Partial<DbRowAnswerSkillOptimizationRun>]
  >)("rejects an invalid stored %s", async (_label, overrides) => {
    storedRows.push(createStoredRow(overrides));
    const { getAnswerSkillOptimizationRun, AnswerSkillOptimizationValidationError } =
      await loadService();

    await expect(
      getAnswerSkillOptimizationRun("user-1", 7001),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationValidationError);
  });
});

describe("stale processing recovery", () => {
  it("preserves durable results, removes pending mutations, and keeps revision", async () => {
    storedRows.push(
      createStoredRow({
        result_json: {
          diff: { before: "old workflow", after: "new workflow" },
          idempotencyResults: {
            [`revise:${secondCreateKey}`]: {
              action: "revise",
              key: secondCreateKey,
              requestHash: "b".repeat(64),
              resultingRevision: 1,
              responseSummary: { status: "processing" },
            },
          },
        },
      }),
    );
    const {
      getAnswerSkillOptimizationRun,
      recoverStaleAnswerSkillOptimizationRun,
    } = await loadService();
    const original = await getAnswerSkillOptimizationRun("user-1", 7001);

    const recovered = await recoverStaleAnswerSkillOptimizationRun(
      original,
      new Date("2026-07-22T06:16:00.000Z"),
    );

    expect(recovered).toMatchObject({
      id: 7001,
      status: "failed",
      revision: 1,
      result: {
        diff: { before: "old workflow", after: "new workflow" },
        failure: {
          code: "operation_interrupted",
          message:
            "The previous operation was interrupted and can be retried.",
        },
        idempotencyResults: {},
      },
    });
    expect(recoveryWriteCount).toBe(1);
  });

  it("uses a conditional update so concurrent recoveries do not overwrite each other", async () => {
    storedRows.push(createStoredRow());
    const {
      getAnswerSkillOptimizationRun,
      recoverStaleAnswerSkillOptimizationRun,
    } = await loadService();
    const original = await getAnswerSkillOptimizationRun("user-1", 7001);
    const now = new Date("2026-07-22T06:16:00.000Z");

    const [first, second] = await Promise.all([
      recoverStaleAnswerSkillOptimizationRun(original, now),
      recoverStaleAnswerSkillOptimizationRun(original, now),
    ]);

    expect(first.status).toBe("failed");
    expect(second.status).toBe("failed");
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(1);
    expect(recoveryWriteCount).toBe(1);
    expect(storedRows).toHaveLength(1);
  });

  it("does not recover a fresh processing task", async () => {
    storedRows.push(
      createStoredRow({ updated_at: "2026-07-22T06:10:00.001Z" }),
    );
    const {
      getAnswerSkillOptimizationRun,
      recoverStaleAnswerSkillOptimizationRun,
    } = await loadService();
    const original = await getAnswerSkillOptimizationRun("user-1", 7001);

    const current = await recoverStaleAnswerSkillOptimizationRun(
      original,
      new Date("2026-07-22T06:25:00.000Z"),
    );

    expect(current.status).toBe("processing");
    expect(recoveryWriteCount).toBe(0);
  });
});

describe("listAnswerOptimizationSummariesForThread", () => {
  it("returns owner-scoped create, resume, restart, completed, and unavailable actions", async () => {
    summaryRows = [
      {
        enhanced_answer_message_id: "2001",
        answer_run_id: null,
        context_message_ids: null,
        enhanced_model: null,
        optimization_id: null,
        status: null,
        final_version_id: null,
        version_number: null,
      },
      {
        enhanced_answer_message_id: "2002",
        answer_run_id: "9002",
        context_message_ids: [],
        enhanced_model: "resolved-enhanced-model",
        optimization_id: null,
        status: null,
        final_version_id: null,
        version_number: null,
      },
      {
        enhanced_answer_message_id: "2003",
        answer_run_id: "9003",
        context_message_ids: [1001, 2002],
        enhanced_model: "resolved-enhanced-model",
        optimization_id: "7003",
        status: "draft_ready",
        final_version_id: null,
        version_number: null,
      },
      {
        enhanced_answer_message_id: "2004",
        answer_run_id: "9004",
        context_message_ids: [],
        enhanced_model: "resolved-enhanced-model",
        optimization_id: "7004",
        status: "cancelled",
        final_version_id: null,
        version_number: null,
      },
      {
        enhanced_answer_message_id: "2005",
        answer_run_id: "9005",
        context_message_ids: null,
        enhanced_model: null,
        optimization_id: "7005",
        status: "completed",
        final_version_id: "8005",
        version_number: "2",
      },
    ];
    const { listAnswerOptimizationSummariesForThread } = await loadService();

    const summaries = await listAnswerOptimizationSummariesForThread(
      "user-1",
      101,
    );

    expect(
      summaries.map(({ enhancedAnswerMessageId, action, canOptimize }) => ({
        enhancedAnswerMessageId,
        action,
        canOptimize,
      })),
    ).toEqual([
      {
        enhancedAnswerMessageId: 2001,
        action: "unavailable",
        canOptimize: false,
      },
      {
        enhancedAnswerMessageId: 2002,
        action: "create",
        canOptimize: true,
      },
      {
        enhancedAnswerMessageId: 2003,
        action: "resume",
        canOptimize: true,
      },
      {
        enhancedAnswerMessageId: 2004,
        action: "restart",
        canOptimize: true,
      },
      {
        enhancedAnswerMessageId: 2005,
        action: "completed",
        canOptimize: false,
      },
    ]);
    expect(summaries[4]).toMatchObject({
      optimizationId: 7005,
      finalVersionId: 8005,
      versionNumber: 2,
      unavailableReason: null,
    });
    expect(summaries[0]?.unavailableReason).toBe("missing_answer_run");
    expect(summaries[1]?.unavailableReason).toBeNull();
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("m.user_id = $1"),
      ["user-1", 101],
    );
  });

  it("marks incomplete legacy provenance unavailable while completed wins", async () => {
    summaryRows = [
      {
        enhanced_answer_message_id: 2010,
        answer_run_id: 9010,
        context_message_ids: null,
        enhanced_model: "resolved-enhanced-model",
        optimization_id: 7010,
        status: "draft_ready",
        final_version_id: null,
        version_number: null,
      },
      {
        enhanced_answer_message_id: 2011,
        answer_run_id: 9011,
        context_message_ids: [],
        enhanced_model: "   ",
        optimization_id: null,
        status: null,
        final_version_id: null,
        version_number: null,
      },
      {
        enhanced_answer_message_id: 2012,
        answer_run_id: 9012,
        context_message_ids: null,
        enhanced_model: null,
        optimization_id: 7012,
        status: "completed",
        final_version_id: 8012,
        version_number: 3,
      },
    ];
    const { listAnswerOptimizationSummariesForThread } = await loadService();

    const summaries = await listAnswerOptimizationSummariesForThread(
      "user-1",
      101,
    );

    expect(summaries[0]).toMatchObject({
      optimizationId: 7010,
      status: "draft_ready",
      canOptimize: false,
      action: "unavailable",
      unavailableReason: "replay_context_unavailable",
    });
    expect(summaries[1]).toMatchObject({
      optimizationId: null,
      status: null,
      canOptimize: false,
      action: "unavailable",
      unavailableReason: "replay_model_unavailable",
    });
    expect(summaries[2]).toMatchObject({
      optimizationId: 7012,
      status: "completed",
      action: "completed",
      unavailableReason: null,
    });
  });

  it("recovers stale processing tasks in one thread-level update before summarizing", async () => {
    storedRows.push(createStoredRow());
    summaryRows = [
      {
        enhanced_answer_message_id: 2002,
        answer_run_id: 9001,
        context_message_ids: [],
        enhanced_model: "resolved-enhanced-model",
        optimization_id: 7001,
        status: "processing",
        final_version_id: null,
        version_number: null,
      },
    ];
    const { listAnswerOptimizationSummariesForThread } = await loadService();

    const summaries = await listAnswerOptimizationSummariesForThread(
      "user-1",
      101,
    );

    expect(summaries[0]).toMatchObject({
      optimizationId: 7001,
      status: "failed",
      action: "resume",
      canOptimize: true,
      unavailableReason: null,
    });
    expect(storedRows[0]?.revision).toBe(1);
    expect(storedRows[0]?.result_json).toMatchObject({
      failure: { code: "operation_interrupted" },
    });
    expect(
      queryMock.mock.calls.filter((call) =>
        String(call[0]).includes("update answer_skill_optimization_runs o"),
      ),
    ).toHaveLength(1);
  });
});
