import type { AgentPackageSnapshot } from "@educlaw/shared";
import type { PoolClient } from "pg";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  DbRowAnswerSkillOptimizationRun,
  DbRowPackage,
  DbRowPackageVersion,
} from "../types.js";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const generateJsonMock = vi.fn();
const generateTextMock = vi.fn();
const validateSkillMock = vi.fn();
const getArenaAnswerRunMock = vi.fn();
const syncPackageVersionSkillsMock = vi.fn();

const createdAt = "2026-07-24T08:00:00.000Z";
const confirmKey = "66666666-6666-4666-8666-666666666666";

function skillMd(): string {
  return [
    "---",
    "name: incident-response",
    "description: Respond to a school incident.",
    "---",
    "",
    "# Incident Response",
    "",
    "## Instructions",
    "Use verified facts and protect the student.",
    "",
    "## Workflow",
    "1. Gather the available facts.",
    "2. Contact the family.",
    "",
    "## Output Format",
    "Return ordered actions and usable wording.",
    "",
    "## Examples",
    "Example: organize a same-day response.",
    "",
    "## Common Issues",
    "Do not present assumptions as facts.",
  ].join("\n");
}

const baseSnapshot: AgentPackageSnapshot = {
  name: "Teacher Assistant",
  description: "Helps teachers respond consistently.",
  versionLabel: "v1",
  agentMd: "Agent instructions",
  rubricMd: "## Dimensions\n- Actionability\n- Safety",
  skills: [
    {
      id: "skill-one",
      dirName: "incident-response",
      name: "Incident Response",
      description: "Use for a school incident.",
      skillMd: skillMd(),
    },
    {
      id: "skill-two",
      dirName: "family-communication",
      name: "Family Communication",
      description: "Use for family communication.",
      skillMd: skillMd().replace(
        /name: incident-response/g,
        "name: family-communication",
      ),
    },
  ],
};

const patchedSkillMd = skillMd().replace(
  "## Workflow\n1. Gather the available facts.\n2. Contact the family.",
  "## Workflow\n\n1. Protect the student.\n2. Verify facts separately.\n3. Contact the family with usable wording.",
);

function testResult(overrides: Record<string, unknown> = {}) {
  return {
    testedRevision: 2,
    question: "What should the teacher do first?",
    beforeAnswer: "Investigate and contact the family.",
    afterAnswer: "Best tested answer.",
    samples: [
      {
        answer: "Best tested answer.",
        passed: true,
        score: 92,
        satisfiedRequirements: ["Ordered steps"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        answer: "Second tested answer.",
        passed: true,
        score: 84,
        satisfiedRequirements: ["Usable wording"],
        unmetRequirements: [],
        riskNotes: [],
        criticalRisk: false,
      },
      {
        answer: "Third tested answer.",
        passed: false,
        score: 62,
        satisfiedRequirements: [],
        unmetRequirements: ["Follow-up is vague"],
        riskNotes: [],
        criticalRisk: false,
      },
    ],
    qualityGate: {
      passed: true,
      passedCount: 2,
      sampleCount: 3,
      bestSampleIndex: 0,
      overallSummary: "Two samples pass without critical risk.",
    },
    runtimeSelectionCheck: {
      targetSkillId: "skill-one",
      selectedSkillIds: ["skill-one"],
      targetSkillSelected: true,
    },
    usedSkillIds: ["skill-one"],
    contextMessageIds: [901, 903],
    model: "recorded-model",
    replayMode: "recorded_context",
    createdAt,
    ...overrides,
  };
}

function optimizationResult(overrides: Record<string, unknown> = {}) {
  return {
    diagnosis: {
      summary: "The answer lacks ordered actions.",
      reusability: "reusable",
      riskNotes: [],
    },
    candidateSkills: [],
    targetSkill: {
      skillId: "skill-one",
      name: "Incident Response",
      selectionSource: "recorded",
    },
    patch: {
      section: "Workflow",
      operation: "replace",
      reason: "Add an executable sequence.",
      proposedContent:
        "1. Protect the student.\n2. Verify facts separately.\n3. Contact the family with usable wording.",
    },
    draft: {
      skillId: "skill-one",
      skillMd: patchedSkillMd,
      validation: { valid: true, errors: [] },
    },
    diff: {
      before: "1. Gather the available facts.\n2. Contact the family.",
      after:
        "1. Protect the student.\n2. Verify facts separately.\n3. Contact the family with usable wording.",
    },
    testResult: testResult(),
    testFailure: null,
    failure: null,
    ...overrides,
  };
}

interface ConfirmState {
  optimization: DbRowAnswerSkillOptimizationRun;
  package: DbRowPackage;
  versions: DbRowPackageVersion[];
}

let state: ConfirmState;
let transactionTail: Promise<void>;
let failurePoint: "version_insert" | "package_update" | "optimization_update" | null;

function initialState(): ConfirmState {
  return {
    optimization: {
      id: 789,
      user_id: "user-1",
      package_id: 123,
      thread_id: 456,
      base_version_id: 10,
      question_message_id: 1001,
      enhanced_answer_message_id: 1002,
      baseline_answer_message_id: 1003,
      user_feedback: "Add ordered steps and usable wording.",
      target_skill_id: "skill-one",
      result_json: optimizationResult(),
      status: "test_ready",
      revision: 2,
      create_request_key: "11111111-1111-4111-8111-111111111111",
      create_request_hash: "create-hash",
      final_version_id: null,
      created_at: createdAt,
      updated_at: createdAt,
    },
    package: {
      id: 123,
      user_id: "user-1",
      name: baseSnapshot.name,
      description: baseSnapshot.description,
      current_version_id: 10,
      created_at: createdAt,
      updated_at: createdAt,
    },
    versions: [
      {
        id: 10,
        package_id: 123,
        version_number: 1,
        source: "generated",
        snapshot_json: structuredClone(baseSnapshot),
        note: "",
        created_at: createdAt,
      },
    ],
  };
}

function createClient(working: ConfirmState): Pick<PoolClient, "query"> {
  return {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      if (
        normalized.startsWith(
          "select * from answer_skill_optimization_runs",
        ) &&
        normalized.includes("for update")
      ) {
        const [id, userId] = values;
        const row =
          Number(id) === Number(working.optimization.id) &&
          userId === working.optimization.user_id
            ? working.optimization
            : undefined;
        return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
      }
      if (
        normalized.startsWith("select * from agent_packages") &&
        normalized.includes("for update")
      ) {
        const [id, userId] = values;
        const row =
          Number(id) === Number(working.package.id) &&
          userId === working.package.user_id
            ? working.package
            : undefined;
        return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
      }
      if (
        normalized.startsWith("select * from agent_package_versions") &&
        normalized.includes("where id = $1 and package_id = $2")
      ) {
        const row = working.versions.find(
          (version) =>
            Number(version.id) === Number(values[0]) &&
            Number(version.package_id) === Number(values[1]),
        );
        return { rows: row ? [structuredClone(row)] : [], rowCount: row ? 1 : 0 };
      }
      if (normalized.startsWith("select coalesce(max(version_number)")) {
        const packageId = Number(values[0]);
        const maximum = working.versions
          .filter((version) => Number(version.package_id) === packageId)
          .reduce(
            (value, version) => Math.max(value, Number(version.version_number)),
            0,
          );
        return {
          rows: [{ next_version_number: maximum + 1 }],
          rowCount: 1,
        };
      }
      if (normalized.startsWith("insert into agent_package_versions")) {
        if (failurePoint === "version_insert") {
          throw new Error("version insert failed");
        }
        const id = Math.max(...working.versions.map((version) => Number(version.id))) + 1;
        working.versions.push({
          id,
          package_id: Number(values[0]),
          version_number: Number(values[1]),
          source: "interactive",
          snapshot_json: JSON.parse(String(values[2])) as unknown,
          note: String(values[3]),
          created_at: String(values[4]),
        });
        return { rows: [{ id }], rowCount: 1 };
      }
      if (normalized.startsWith("update agent_packages")) {
        if (failurePoint === "package_update") {
          throw new Error("package update failed");
        }
        if (
          Number(working.package.id) !== Number(values[2]) ||
          working.package.user_id !== values[3] ||
          Number(working.package.current_version_id) !== Number(values[4])
        ) {
          return { rows: [], rowCount: 0 };
        }
        working.package.current_version_id = Number(values[0]);
        working.package.updated_at = String(values[1]);
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith("update answer_skill_optimization_runs")) {
        if (failurePoint === "optimization_update") {
          throw new Error("optimization update failed");
        }
        if (
          Number(working.optimization.id) !== Number(values[3]) ||
          working.optimization.user_id !== values[4] ||
          Number(working.optimization.revision) !== Number(values[5]) ||
          working.optimization.status !== "test_ready" ||
          working.optimization.final_version_id !== null
        ) {
          return { rows: [], rowCount: 0 };
        }
        working.optimization.result_json = JSON.parse(String(values[0])) as unknown;
        working.optimization.status = "completed";
        working.optimization.final_version_id = Number(values[1]);
        working.optimization.updated_at = String(values[2]);
        return {
          rows: [structuredClone(working.optimization)],
          rowCount: 1,
        };
      }
      throw new Error(`Unexpected confirm query: ${normalized}`);
    }) as PoolClient["query"],
  };
}

async function loadService() {
  vi.resetModules();
  vi.doMock("./db.js", () => ({
    query: queryMock,
    withTransaction: withTransactionMock,
  }));
  vi.doMock("./arena-service.js", () => ({
    ArenaAnswerRunNotFoundError: class extends Error {},
    buildArenaSidePromptContext: vi.fn(),
    buildEnhancedPrompt: vi.fn(),
    getAnswerOptimizationAvailability: (
      run: { contextMessageIds: number[] | null; enhancedModel: string | null } | null,
    ) =>
      !run
        ? { available: false, reason: "missing_answer_run" }
        : run.contextMessageIds === null
          ? { available: false, reason: "replay_context_unavailable" }
          : !run.enhancedModel?.trim()
            ? { available: false, reason: "replay_model_unavailable" }
            : { available: true, reason: null },
    getArenaAnswerRunByEnhancedMessage: getArenaAnswerRunMock,
    parseArenaAnswerContextMessageIds: (value: unknown) => value,
    parseArenaAnswerEnhancedModel: (value: unknown) => value,
    selectRelevantSkills: vi.fn(),
  }));
  vi.doMock("./llm-service.js", () => ({
    generateJson: generateJsonMock,
    generateText: generateTextMock,
    LlmInvalidJsonError: class extends Error {},
  }));
  vi.doMock("./package-service.js", () => ({
    getVersion: vi.fn(),
    validateSkillMdStandard: validateSkillMock,
  }));
  vi.doMock("./skill-version-service.js", () => ({
    getSkillVersionDetail: vi.fn(),
    syncPackageVersionSkillsFromSnapshot: syncPackageVersionSkillsMock,
  }));
  return import("./answer-skill-optimization-service.js");
}

function confirmInput(overrides: Record<string, unknown> = {}) {
  return {
    userId: "user-1",
    optimizationId: 789,
    expectedRevision: 2,
    versionNote: "Add ordered response steps.",
    idempotencyKey: confirmKey,
    ...overrides,
  };
}

beforeEach(() => {
  state = initialState();
  failurePoint = null;
  transactionTail = Promise.resolve();
  queryMock.mockReset();
  syncPackageVersionSkillsMock.mockReset().mockResolvedValue(undefined);
  queryMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (
      sql.includes("from answer_skill_optimization_runs") &&
      sql.includes("where user_id = $1 and id = $2")
    ) {
      const row =
        state.optimization.user_id === values[0] &&
        Number(state.optimization.id) === Number(values[1])
          ? structuredClone(state.optimization)
          : null;
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    throw new Error(`Unexpected outer confirm query: ${sql}`);
  });
  getArenaAnswerRunMock.mockReset().mockResolvedValue({
    id: 9001,
    userId: "user-1",
    threadId: 456,
    packageId: 123,
    packageVersionId: 10,
    questionMessageId: 1001,
    enhancedAnswerMessageId: 1002,
    baselineAnswerMessageId: 1003,
    usedSkillIds: ["skill-one"],
    contextMessageIds: [],
    enhancedModel: "recorded-model",
    createdAt,
  });
  generateJsonMock.mockReset();
  generateTextMock.mockReset();
  validateSkillMock.mockReset().mockReturnValue([]);
  withTransactionMock.mockReset().mockImplementation(
    <T>(operation: (client: PoolClient) => Promise<T>): Promise<T> => {
      const transaction = transactionTail.then(async () => {
        const working = structuredClone(state);
        const result = await operation(createClient(working) as PoolClient);
        state = working;
        return result;
      });
      transactionTail = transaction.then(
        () => undefined,
        () => undefined,
      );
      return transaction;
    },
  );
});

describe("answer optimization confirm transaction", () => {
  it("rejects a legacy optimization without replay provenance before the transaction", async () => {
    getArenaAnswerRunMock.mockResolvedValue({
      id: 9001,
      userId: "user-1",
      threadId: 456,
      packageId: 123,
      packageVersionId: 10,
      questionMessageId: 1001,
      enhancedAnswerMessageId: 1002,
      baselineAnswerMessageId: 1003,
      usedSkillIds: ["skill-one"],
      contextMessageIds: null,
      enhancedModel: "recorded-model",
      createdAt,
    });
    const {
      AnswerSkillOptimizationReplayUnavailableError,
      confirmAnswerSkillOptimization,
    } = await loadService();

    await expect(
      confirmAnswerSkillOptimization(confirmInput()),
    ).rejects.toBeInstanceOf(
      AnswerSkillOptimizationReplayUnavailableError,
    );
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(state.versions).toHaveLength(1);
    expect(state.package.current_version_id).toBe(10);
  });

  it("creates one immutable interactive version and atomically completes the optimization", async () => {
    const { confirmAnswerSkillOptimization } = await loadService();
    const originalBase = structuredClone(state.versions[0]);

    const result = await confirmAnswerSkillOptimization(confirmInput());

    expect(result).toMatchObject({
      optimizationId: 789,
      status: "completed",
      baseVersionId: 10,
      finalVersionId: 11,
      versionNumber: 2,
      source: "interactive",
    });
    expect(state.versions).toHaveLength(2);
    expect(state.package.current_version_id).toBe(11);
    expect(state.optimization).toMatchObject({
      status: "completed",
      final_version_id: 11,
      revision: 2,
    });
    expect(state.versions[0]).toEqual(originalBase);
    const finalSnapshot = state.versions[1]?.snapshot_json as AgentPackageSnapshot;
    expect(finalSnapshot.versionLabel).toBe("v2");
    expect(finalSnapshot.agentMd).toBe(baseSnapshot.agentMd);
    expect(finalSnapshot.rubricMd).toBe(baseSnapshot.rubricMd);
    expect(finalSnapshot.skills[0]?.skillMd).toBe(patchedSkillMd);
    expect(finalSnapshot.skills[1]).toEqual(baseSnapshot.skills[1]);
    expect(state.versions[1]?.note).toBe("Add ordered response steps.");
    expect(syncPackageVersionSkillsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        packageId: 123,
        packageVersionId: 11,
        packageVersionNumber: 2,
        source: "interactive",
        snapshot: finalSnapshot,
      }),
    );
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(generateTextMock).not.toHaveBeenCalled();
  });

  it("preserves an empty Rubric accepted by the existing Package flow", async () => {
    state.versions[0]!.snapshot_json = {
      ...baseSnapshot,
      rubricMd: "",
    };
    const { confirmAnswerSkillOptimization } = await loadService();

    const result = await confirmAnswerSkillOptimization(confirmInput());

    expect(result.status).toBe("completed");
    expect(state.versions).toHaveLength(2);
    const finalSnapshot = state.versions[1]?.snapshot_json as AgentPackageSnapshot;
    expect(finalSnapshot.rubricMd).toBe("");
    expect(finalSnapshot.skills[0]?.skillMd).toBe(patchedSkillMd);
  });

  it("allows confirmation when the advisory preview found improvement opportunities", async () => {
    state.optimization.result_json = optimizationResult({
      testResult: testResult({
        samples: testResult().samples.map((sample, index) => ({
          ...sample,
          passed: index === 0,
        })),
        qualityGate: {
          ...testResult().qualityGate,
          passed: false,
          passedCount: 1,
        },
      }),
    });
    const { confirmAnswerSkillOptimization } = await loadService();

    const result = await confirmAnswerSkillOptimization(confirmInput());

    expect(result).toMatchObject({
      status: "completed",
      finalVersionId: 11,
      versionNumber: 2,
    });
    expect(state.versions).toHaveLength(2);
    expect(state.package.current_version_id).toBe(11);
  });

  it("still rejects confirmation when normal runtime selection misses the target Skill", async () => {
    state.optimization.result_json = optimizationResult({
      testResult: testResult({
        runtimeSelectionCheck: {
          targetSkillId: "skill-one",
          selectedSkillIds: ["skill-two"],
          targetSkillSelected: false,
        },
        qualityGate: { ...testResult().qualityGate, passed: false },
      }),
    });
    const {
      AnswerSkillOptimizationDraftError,
      confirmAnswerSkillOptimization,
    } = await loadService();

    await expect(
      confirmAnswerSkillOptimization(confirmInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect(state.versions).toHaveLength(1);
    expect(state.package.current_version_id).toBe(10);
  });

  it("rejects stale revisions and a changed base version", async () => {
    const {
      AnswerSkillOptimizationConflictError,
      confirmAnswerSkillOptimization,
    } = await loadService();
    await expect(
      confirmAnswerSkillOptimization(
        confirmInput({ expectedRevision: 1 }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);

    state.package.current_version_id = 12;
    await expect(
      confirmAnswerSkillOptimization(confirmInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
    expect(state.versions).toHaveLength(1);
  });

  it("replays the same confirm key without creating another version", async () => {
    const { confirmAnswerSkillOptimization } = await loadService();

    const first = await confirmAnswerSkillOptimization(confirmInput());
    const replay = await confirmAnswerSkillOptimization(confirmInput());

    expect(replay).toEqual(first);
    expect(state.versions).toHaveLength(2);
    expect(state.package.current_version_id).toBe(11);
  });

  it("rejects the same confirm key with a different normalized note", async () => {
    const {
      AnswerSkillOptimizationConflictError,
      confirmAnswerSkillOptimization,
    } = await loadService();
    await confirmAnswerSkillOptimization(confirmInput());

    await expect(
      confirmAnswerSkillOptimization(
        confirmInput({ versionNote: "A different note." }),
      ),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationConflictError);
    expect(state.versions).toHaveLength(2);
  });

  it("serializes concurrent same-key confirmations and creates one version", async () => {
    const { confirmAnswerSkillOptimization } = await loadService();

    const [first, second] = await Promise.all([
      confirmAnswerSkillOptimization(confirmInput()),
      confirmAnswerSkillOptimization(confirmInput()),
    ]);

    expect(second).toEqual(first);
    expect(state.versions).toHaveLength(2);
  });

  it("allows only one of two concurrent different confirm keys", async () => {
    const { confirmAnswerSkillOptimization } = await loadService();
    const results = await Promise.allSettled([
      confirmAnswerSkillOptimization(confirmInput()),
      confirmAnswerSkillOptimization(
        confirmInput({
          idempotencyKey: "77777777-7777-4777-8777-777777777777",
        }),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(state.versions).toHaveLength(2);
  });

  it.each([
    "version_insert",
    "package_update",
    "optimization_update",
  ] as const)("rolls back every write when %s fails", async (point) => {
    failurePoint = point;
    const { confirmAnswerSkillOptimization } = await loadService();

    await expect(
      confirmAnswerSkillOptimization(confirmInput()),
    ).rejects.toThrow();

    expect(state.versions).toHaveLength(1);
    expect(state.package.current_version_id).toBe(10);
    expect(state.optimization.status).toBe("test_ready");
    expect(state.optimization.final_version_id).toBeNull();
  });

  it("rejects a stored draft that no longer matches its Patch", async () => {
    const result = optimizationResult();
    result.draft = {
      ...result.draft,
      skillMd: `${patchedSkillMd}\nTampered`,
    };
    state.optimization.result_json = result;
    const {
      AnswerSkillOptimizationDraftError,
      confirmAnswerSkillOptimization,
    } = await loadService();

    await expect(
      confirmAnswerSkillOptimization(confirmInput()),
    ).rejects.toBeInstanceOf(AnswerSkillOptimizationDraftError);
    expect(state.versions).toHaveLength(1);
  });
});
