import type { AgentPackageSnapshot } from "@educlaw/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbRowMessage } from "../types.js";

const queryMock = vi.fn();
const transactionQueryMock = vi.fn();
const withTransactionMock = vi.fn();
const streamTextPartsMock = vi.fn();
const resolveBaselineModelMock = vi.fn();
const resolveEnhancedModelMock = vi.fn();
const getPackageMock = vi.fn();
const getPackageWithVersionIdMock = vi.fn();
type MockDbRowMessage = Omit<DbRowMessage, "id" | "thread_id"> & {
  id: number | string;
  thread_id: number | string;
};
let storedThreadMessages: MockDbRowMessage[] = [];

interface StreamTextInput {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
}

type TransactionOperation = (client: {
  query: typeof transactionQueryMock;
}) => Promise<unknown>;

const timestamp = "2026-07-19T08:00:00.000Z";

function createSnapshot(
  skills: AgentPackageSnapshot["skills"] = [
    {
      id: "skill-bullying",
      dirName: "bullying-response",
      name: "bullying response",
      description: "Steps for bullying incidents",
      skillMd: "# MATCHED_SKILL_BODY\nHandle bullying safely.",
    },
    {
      id: "skill-unrelated",
      dirName: "lesson-planning",
      name: "lesson planning",
      description: "Prepare a classroom lesson",
      skillMd: "# UNRELATED_SKILL_BODY\nPlan a lesson.",
    },
  ],
): AgentPackageSnapshot {
  return {
    name: "Teacher Assistant",
    description: "Supports classroom work",
    versionLabel: "v4",
    agentMd: "# Agent\nFollow school policy.",
    rubricMd: "# Rubric\nBe practical.",
    skills,
  };
}

function createPackageContext(
  versionId = 501,
  snapshot = createSnapshot(),
) {
  return {
    versionId,
    package: {
      id: 301,
      userId: "user-1",
      name: snapshot.name,
      description: snapshot.description,
      versionNumber: 4,
      updatedAt: timestamp,
      snapshot,
    },
  };
}

async function loadService() {
  vi.resetModules();
  vi.doMock("./db.js", () => ({
    query: queryMock,
    withTransaction: withTransactionMock,
  }));
  vi.doMock("./llm-service.js", () => ({
    generateJson: vi.fn(),
    resolveBaselineModel: resolveBaselineModelMock,
    resolveEnhancedModel: resolveEnhancedModelMock,
    streamTextParts: streamTextPartsMock,
    supportsExplicitThinking: vi.fn(() => false),
  }));
  vi.doMock("./package-service.js", () => ({
    assertRubricConfigured: vi.fn(),
    getPackage: getPackageMock,
    getPackageWithVersionId: getPackageWithVersionIdMock,
  }));
  return import("./arena-service.js");
}

function configureDatabaseMocks() {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select * from arena_threads where id = $1")) {
      return {
        rows: [
          {
            id: "101",
            user_id: "user-1",
            package_id: "301",
            title: "Arena Thread",
            model: null,
            created_at: timestamp,
            updated_at: timestamp,
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1")) {
      return {
        rows: storedThreadMessages,
        rowCount: storedThreadMessages.length,
      };
    }
    if (sql.startsWith("insert into arena_messages")) {
      return { rows: [{ id: "1001" }], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  transactionQueryMock.mockImplementation(
    async (sql: string, values: unknown[] = []) => {
      if (sql.startsWith("insert into arena_messages")) {
        const side = String(values[2]);
        return {
          rows: [{ id: side === "baseline" ? "2001" : "2002" }],
          rowCount: 1,
        };
      }
      if (sql.includes("insert into arena_answer_runs")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith("update arena_threads")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  );
}

async function collectEvents<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const events: T[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function findTransactionCall(fragment: string) {
  return transactionQueryMock.mock.calls.find((call) =>
    String(call[0]).includes(fragment),
  );
}

beforeEach(() => {
  queryMock.mockReset();
  transactionQueryMock.mockReset();
  withTransactionMock.mockReset();
  streamTextPartsMock.mockReset();
  resolveBaselineModelMock.mockReset();
  resolveEnhancedModelMock.mockReset();
  getPackageMock.mockReset();
  getPackageWithVersionIdMock.mockReset();
  storedThreadMessages = [];

  configureDatabaseMocks();
  withTransactionMock.mockImplementation(
    async (operation: TransactionOperation) =>
      operation({ query: transactionQueryMock }),
  );
  resolveBaselineModelMock.mockReturnValue("baseline-model");
  resolveEnhancedModelMock.mockReturnValue("resolved-enhanced-model");
  streamTextPartsMock.mockImplementation((input: StreamTextInput) =>
    (async function* () {
      yield {
        type: "content",
        delta: input.systemPrompt.includes("[agent.md]")
          ? "enhanced answer"
          : "baseline answer",
      };
    })(),
  );
  getPackageWithVersionIdMock.mockResolvedValue(createPackageContext());
});

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./db.js");
  vi.doUnmock("./llm-service.js");
  vi.doUnmock("./package-service.js");
});

describe("Arena answer run provenance", () => {
  it("saves compare answers and the exact version and skills used by the prompt", async () => {
    const { streamMessage } = await loadService();

    const events = await collectEvents(
      streamMessage("user-1", 101, "bullying response", undefined, "compare"),
    );

    const sharedInsert = queryMock.mock.calls.find((call) =>
      String(call[0]).startsWith("insert into arena_messages"),
    );
    expect(sharedInsert?.[1]).toEqual([
      101,
      "user-1",
      "shared",
      "user",
      "bullying response",
      expect.any(String),
    ]);

    const assistantInserts = transactionQueryMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("insert into arena_messages"),
    );
    expect(assistantInserts.map((call) => call[1]?.[2])).toEqual([
      "baseline",
      "enhanced",
    ]);

    const runCall = findTransactionCall("insert into arena_answer_runs");
    const runValues = runCall?.[1] as unknown[];
    expect(runValues.slice(0, 10)).toEqual([
      "user-1",
      101,
      "301",
      501,
      "1001",
      2002,
      2001,
      JSON.stringify(["skill-bullying"]),
      JSON.stringify([]),
      "resolved-enhanced-model",
    ]);

    const enhancedModelCall = streamTextPartsMock.mock.calls.find((call) =>
      String((call[0] as StreamTextInput).systemPrompt).includes("[agent.md]"),
    );
    const enhancedPrompt = (enhancedModelCall?.[0] as StreamTextInput)
      .systemPrompt;
    expect(enhancedPrompt).toContain("MATCHED_SKILL_BODY");
    expect(enhancedPrompt).not.toContain("UNRELATED_SKILL_BODY");
    expect((enhancedModelCall?.[0] as StreamTextInput).model).toBe(
      "resolved-enhanced-model",
    );
    expect(resolveEnhancedModelMock).toHaveBeenCalledOnce();
    expect(resolveEnhancedModelMock).toHaveBeenCalledWith(undefined);

    const done = events.find((event) => event.event === "done");
    expect(done?.event).toBe("done");
    if (done?.event === "done") {
      expect(done.data.messages.map((message) => message.side)).toEqual([
        "shared",
        "baseline",
        "enhanced",
      ]);
    }
  });

  it("creates enhanced-only provenance with a null baseline message", async () => {
    const { streamMessage } = await loadService();

    await collectEvents(
      streamMessage("user-1", 101, "bullying response", undefined, "agent"),
    );

    const runValues = (
      findTransactionCall("insert into arena_answer_runs")?.[1] ?? []
    ) as unknown[];
    expect(runValues[5]).toBe(2002);
    expect(runValues[6]).toBeNull();
  });

  it("records the exact enhanced-side history IDs and excludes baseline history", async () => {
    storedThreadMessages = [
      {
        id: "901",
        thread_id: "101",
        user_id: "user-1",
        side: "shared",
        role: "user",
        content: "A student reported repeated insults.",
        created_at: "2026-07-19T07:55:00.000Z",
      },
      {
        id: "902",
        thread_id: "101",
        user_id: "user-1",
        side: "baseline",
        role: "assistant",
        content: "Previous baseline answer.",
        created_at: "2026-07-19T07:56:00.000Z",
      },
      {
        id: "903",
        thread_id: "101",
        user_id: "user-1",
        side: "enhanced",
        role: "assistant",
        content: "Previous enhanced answer.",
        created_at: "2026-07-19T07:56:00.000Z",
      },
    ];
    const { streamMessage } = await loadService();

    await collectEvents(
      streamMessage("user-1", 101, "What should happen next?", undefined, "compare"),
    );

    const runValues = (
      findTransactionCall("insert into arena_answer_runs")?.[1] ?? []
    ) as unknown[];
    expect(runValues[8]).toBe(JSON.stringify([901, 903]));

    const enhancedCall = streamTextPartsMock.mock.calls.find((call) =>
      String((call[0] as StreamTextInput).systemPrompt).includes("[agent.md]"),
    );
    expect((enhancedCall?.[0] as StreamTextInput).userPrompt).toBe(
      [
        "User: A student reported repeated insults.",
        "Assistant: Previous enhanced answer.",
        "User: What should happen next?",
      ].join("\n"),
    );
    expect((enhancedCall?.[0] as StreamTextInput).userPrompt).not.toContain(
      "Previous baseline answer.",
    );
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("order by created_at asc, id asc"),
      [101, "user-1", 200],
    );
  });

  it("persists the same resolved default model passed to enhanced generation", async () => {
    resolveEnhancedModelMock.mockReturnValueOnce("resolved-default-model");
    const { streamMessage } = await loadService();

    await collectEvents(
      streamMessage("user-1", 101, "bullying response", undefined, "agent"),
    );

    const runValues = (
      findTransactionCall("insert into arena_answer_runs")?.[1] ?? []
    ) as unknown[];
    const enhancedCall = streamTextPartsMock.mock.calls[0]?.[0] as StreamTextInput;
    expect(resolveEnhancedModelMock).toHaveBeenCalledWith(undefined);
    expect(enhancedCall.model).toBe("resolved-default-model");
    expect(runValues[9]).toBe("resolved-default-model");
  });

  it("selects a relevant Skill from a natural Chinese question", async () => {
    getPackageWithVersionIdMock.mockResolvedValue(
      createPackageContext(
        503,
        createSnapshot([
          {
            id: "skill-family",
            dirName: "family-communication",
            name: "家长沟通与欺凌干预",
            description: "帮助班主任与遭遇欺凌学生的家长沟通",
            skillMd: "# FAMILY_COMMUNICATION\n提供家长沟通步骤。",
          },
          {
            id: "skill-unrelated",
            dirName: "lesson-planning",
            name: "lesson planning",
            description: "Prepare a classroom lesson",
            skillMd: "# UNRELATED_SKILL_BODY\nPlan a lesson.",
          },
        ]),
      ),
    );
    const { streamMessage } = await loadService();

    await collectEvents(
      streamMessage(
        "user-1",
        101,
        "那应该怎么和他的家长沟通？",
        undefined,
        "agent",
      ),
    );

    const runValues = (
      findTransactionCall("insert into arena_answer_runs")?.[1] ?? []
    ) as unknown[];
    expect(runValues[7]).toBe(JSON.stringify(["skill-family"]));
    const enhancedPrompt = (
      streamTextPartsMock.mock.calls[0]?.[0] as StreamTextInput
    ).systemPrompt;
    expect(enhancedPrompt).toContain("FAMILY_COMMUNICATION");
    expect(enhancedPrompt).not.toContain("UNRELATED_SKILL_BODY");
  });

  it("does not create provenance for baseline-only generation", async () => {
    const { streamMessage } = await loadService();

    await collectEvents(
      streamMessage("user-1", 101, "bullying response", undefined, "baseline"),
    );

    expect(findTransactionCall("insert into arena_answer_runs")).toBeUndefined();
    const assistantInserts = transactionQueryMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("insert into arena_messages"),
    );
    expect(assistantInserts).toHaveLength(1);
    expect(assistantInserts[0]?.[1]?.[2]).toBe("baseline");
  });

  it("stores an empty skill list when no skill matches", async () => {
    getPackageWithVersionIdMock.mockResolvedValue(
      createPackageContext(
        502,
        createSnapshot([
          {
            id: "skill-unrelated",
            dirName: "lesson-planning",
            name: "lesson planning",
            description: "Prepare a classroom lesson",
            skillMd: "# UNRELATED_SKILL_BODY\nPlan a lesson.",
          },
        ]),
      ),
    );
    const { streamMessage } = await loadService();

    const events = await collectEvents(
      streamMessage("user-1", 101, "quantum astronomy", undefined, "agent"),
    );

    const runValues = (
      findTransactionCall("insert into arena_answer_runs")?.[1] ?? []
    ) as unknown[];
    expect(runValues[7]).toBe(JSON.stringify([]));
    const enhancedPrompt = (streamTextPartsMock.mock.calls[0]?.[0] as StreamTextInput)
      .systemPrompt;
    expect(enhancedPrompt).not.toContain("UNRELATED_SKILL_BODY");
    expect(events.some((event) => event.event === "done")).toBe(true);
  });

  it("keeps the version captured before generation when current version changes", async () => {
    let simulatedCurrentVersionId = 700;
    getPackageWithVersionIdMock.mockImplementation(async () =>
      createPackageContext(simulatedCurrentVersionId),
    );
    streamTextPartsMock.mockImplementation((input: StreamTextInput) =>
      (async function* () {
        simulatedCurrentVersionId = 701;
        yield {
          type: "content",
          delta: input.systemPrompt.includes("[agent.md]")
            ? "enhanced answer"
            : "baseline answer",
        };
      })(),
    );
    const { streamMessage } = await loadService();

    await collectEvents(
      streamMessage("user-1", 101, "bullying response", undefined, "agent"),
    );

    const runValues = (
      findTransactionCall("insert into arena_answer_runs")?.[1] ?? []
    ) as unknown[];
    expect(simulatedCurrentVersionId).toBe(701);
    expect(runValues[3]).toBe(700);
    expect(getPackageWithVersionIdMock).toHaveBeenCalledOnce();
  });

  it("does not emit done when the final provenance transaction fails", async () => {
    transactionQueryMock.mockImplementation(
      async (sql: string, values: unknown[] = []) => {
        if (sql.startsWith("insert into arena_messages")) {
          return { rows: [{ id: Number(values[2] === "baseline" ? 2001 : 2002) }] };
        }
        if (sql.includes("insert into arena_answer_runs")) {
          throw new Error("answer run insert failed");
        }
        return { rows: [], rowCount: 1 };
      },
    );
    const { streamMessage } = await loadService();
    const events: Array<{ event: string }> = [];
    let failure: unknown;

    try {
      for await (const event of streamMessage(
        "user-1",
        101,
        "bullying response",
        undefined,
        "agent",
      )) {
        events.push(event);
      }
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(events.some((event) => event.event === "done")).toBe(false);
    const nonTransactionalAssistantWrites = queryMock.mock.calls.filter(
      (call) =>
        String(call[0]).startsWith("insert into arena_messages") &&
        call[1]?.[3] === "assistant",
    );
    expect(nonTransactionalAssistantWrites).toHaveLength(0);
  });

  it("reads an answer run only through its owner and enhanced message", async () => {
    const { getArenaAnswerRunByEnhancedMessage } = await loadService();
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9001,
            user_id: "user-1",
            thread_id: 101,
            package_id: 301,
            package_version_id: 501,
            question_message_id: 1001,
            enhanced_answer_message_id: 2002,
            baseline_answer_message_id: 2001,
            used_skill_ids: ["skill-bullying"],
            context_message_ids: [801, 802],
            enhanced_model: "resolved-enhanced-model",
            created_at: timestamp,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const run = await getArenaAnswerRunByEnhancedMessage("user-1", 2002);

    expect(run).toEqual({
      id: 9001,
      userId: "user-1",
      threadId: 101,
      packageId: 301,
      packageVersionId: 501,
      questionMessageId: 1001,
      enhancedAnswerMessageId: 2002,
      baselineAnswerMessageId: 2001,
      usedSkillIds: ["skill-bullying"],
      contextMessageIds: [801, 802],
      enhancedModel: "resolved-enhanced-model",
      baselineUsedSkillIds: [],
      baselineContextMessageIds: null,
      baselineModel: null,
      baselineSkillVersionId: null,
      enhancedSkillVersionId: null,
      createdAt: timestamp,
    });
    expect(queryMock).toHaveBeenNthCalledWith(1, expect.stringContaining("user_id = $1"), [
      "user-1",
      2002,
    ]);
    await expect(
      getArenaAnswerRunByEnhancedMessage("user-2", 2002),
    ).rejects.toThrow("Arena answer run not found");
  });

  it("finds the same answer provenance from either recorded side", async () => {
    const {
      getArenaAnswerRunByMessage,
      getArenaAnswerRunSideProvenance,
    } = await loadService();
    queryMock.mockReset();
    queryMock.mockResolvedValue({
      rows: [
        {
          id: 9001,
          user_id: "user-1",
          thread_id: 101,
          package_id: 301,
          package_version_id: 501,
          question_message_id: 1001,
          enhanced_answer_message_id: 2002,
          baseline_answer_message_id: 2001,
          used_skill_ids: ["skill-b"],
          context_message_ids: [801, 803],
          enhanced_model: "model-b",
          baseline_used_skill_ids: ["skill-a"],
          baseline_context_message_ids: [801, 802],
          baseline_model: "model-a",
          baseline_skill_version_id: 101,
          enhanced_skill_version_id: 202,
          created_at: timestamp,
        },
      ],
      rowCount: 1,
    });

    const baseline = await getArenaAnswerRunByMessage("user-1", 2001);
    const enhanced = await getArenaAnswerRunByMessage("user-1", 2002);

    expect(baseline.baselineSkillVersionId).toBe(101);
    expect(baseline.baselineUsedSkillIds).toEqual(["skill-a"]);
    expect(enhanced.enhancedSkillVersionId).toBe(202);
    expect(getArenaAnswerRunSideProvenance(baseline, "baseline")).toEqual({
      answerMessageId: 2001,
      usedSkillIds: ["skill-a"],
      contextMessageIds: [801, 802],
      model: "model-a",
      skillVersionId: 101,
    });
    expect(getArenaAnswerRunSideProvenance(enhanced, "enhanced")).toEqual({
      answerMessageId: 2002,
      usedSkillIds: ["skill-b"],
      contextMessageIds: [801, 803],
      model: "model-b",
      skillVersionId: 202,
    });
    expect(queryMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("baseline_answer_message_id = $2"),
      ["user-1", 2001],
    );
  });

  it("keeps legacy unknown context distinct from a recorded empty history", async () => {
    const {
      getAnswerOptimizationAvailability,
      getArenaAnswerRunByEnhancedMessage,
    } = await loadService();
    queryMock.mockReset();
    const baseRow = {
      id: 9001,
      user_id: "user-1",
      thread_id: 101,
      package_id: 301,
      package_version_id: 501,
      question_message_id: 1001,
      enhanced_answer_message_id: 2002,
      baseline_answer_message_id: null,
      used_skill_ids: [],
      created_at: timestamp,
    };
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            context_message_ids: null,
            enhanced_model: null,
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({
        rows: [
          {
            ...baseRow,
            id: 9002,
            enhanced_answer_message_id: 2003,
            context_message_ids: [],
            enhanced_model: "resolved-enhanced-model",
          },
        ],
        rowCount: 1,
      });

    const legacy = await getArenaAnswerRunByEnhancedMessage("user-1", 2002);
    const firstTurn = await getArenaAnswerRunByEnhancedMessage("user-1", 2003);

    expect(legacy.contextMessageIds).toBeNull();
    expect(legacy.enhancedModel).toBeNull();
    expect(firstTurn.contextMessageIds).toEqual([]);
    expect(firstTurn.enhancedModel).toBe("resolved-enhanced-model");
    expect(getAnswerOptimizationAvailability(null)).toEqual({
      available: false,
      reason: "missing_answer_run",
    });
    expect(getAnswerOptimizationAvailability(legacy)).toEqual({
      available: false,
      reason: "replay_context_unavailable",
    });
    expect(getAnswerOptimizationAvailability(firstTurn)).toEqual({
      available: true,
      reason: null,
    });
    expect(
      getAnswerOptimizationAvailability({
        contextMessageIds: [],
        enhancedModel: "   ",
      }),
    ).toEqual({
      available: false,
      reason: "replay_model_unavailable",
    });
  });
});
