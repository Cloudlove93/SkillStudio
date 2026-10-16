import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  HarnessEventEmitter,
  HarnessResult,
  HarnessRunRequest,
} from "../harness/contracts.js";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const streamTextPartsMock = vi.fn();
const runPiAgentMock = vi.fn();
const configMock = {
  piHarnessSkillRunEnabled: true,
  piHarnessMaxConcurrentRuns: 4,
};

async function collectEvents(
  stream: AsyncGenerator<unknown>,
): Promise<unknown[]> {
  const events: unknown[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function completedHarnessResult(request: HarnessRunRequest): HarnessResult {
  return {
    runId: request.runId,
    status: "completed",
    text: "Pi final answer",
    requestedModelId: request.model.modelId,
    providerRegistryId: "educlaw-configured",
    responseModelId: "actual-response-model",
    selectedSkillVersionId: request.selectedSkill.versionId,
    error: null,
    evidence: {
      skillInjected: true,
      historyMessageCount: request.history.length,
      modelRequestAttemptCount: 1,
      modelRequestCount: 1,
      toolCallCount: 0,
      toolNames: [],
      eventTypes: [],
      eventDeliveryFailureCount: 0,
      outputChars: 15,
      durationMs: 10,
      cleanupCompleted: true,
    },
  };
}

function failedHarnessResult(
  request: HarnessRunRequest,
  code: "MODEL_UNAVAILABLE" | "RUN_CANCELLED" = "MODEL_UNAVAILABLE",
): HarnessResult {
  return {
    ...completedHarnessResult(request),
    status: code === "RUN_CANCELLED" ? "cancelled" : "failed",
    text: "",
    responseModelId: null,
    error: {
      code,
      retryable: true,
      userMessage: code === "RUN_CANCELLED" ? "本次运行已取消。" : "模型服务暂时不可用。",
    },
    evidence: {
      ...completedHarnessResult(request).evidence,
      outputChars: 0,
    },
  };
}

async function loadService(enabled = true) {
  configMock.piHarnessSkillRunEnabled = enabled;
  vi.resetModules();
  vi.doMock("./db.js", () => ({
    query: queryMock,
    withTransaction: withTransactionMock,
  }));
  vi.doMock("./llm-service.js", () => ({
    generateJson: vi.fn(),
    generateText: vi.fn(),
    resolveBaselineModel: vi.fn((model?: string) => model || "baseline-model"),
    resolveEnhancedModel: vi.fn((model?: string) => model || "enhanced-model"),
    streamTextParts: streamTextPartsMock,
    supportsExplicitThinking: vi.fn(() => false),
  }));
  vi.doMock("./package-service.js", () => ({
    assertRubricConfigured: vi.fn(),
    getPackage: vi.fn(),
    getPackageWithVersionId: vi.fn(),
  }));
  vi.doMock("../config.js", () => ({ config: configMock }));
  vi.doMock("../harness/pi-core-adapter.js", () => ({ runPiAgent: runPiAgentMock }));
  vi.doMock("../lib/request-context.js", () => ({
    getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }));
  return import("./arena-service.js");
}

function installQueryFixture(surface: "run" | "test" | "arena" = "run") {
  let nextMessageId = 100;
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.startsWith("select * from arena_threads where id = $1 and user_id = $2")) {
      return {
        rows: [{
          id: 91,
          user_id: "user-1",
          package_id: 7,
          title: "Skill Run",
          model: "requested-model",
          arena_kind: "skill_arena",
          base_package_version_id: 33,
          arena_config_jsonb: {
            mode: "skill_arena",
            compositionMode: "skill_only",
            surface,
            basePackageVersionId: "33",
          },
          created_at: "2026-10-15T00:00:00.000Z",
          updated_at: "2026-10-15T00:00:00.000Z",
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1 and user_id = $2")) {
      return {
        rows: [
          {
            id: 10,
            thread_id: 91,
            user_id: "user-1",
            side: "shared",
            role: "user",
            content: "Earlier question",
            reasoning_content: null,
            created_at: "2026-10-15T00:00:01.000Z",
          },
          {
            id: 11,
            thread_id: 91,
            user_id: "user-1",
            side: "baseline",
            role: "assistant",
            content: "Baseline answer must be excluded",
            reasoning_content: null,
            created_at: "2026-10-15T00:00:02.000Z",
          },
          {
            id: 12,
            thread_id: 91,
            user_id: "user-1",
            side: "enhanced",
            role: "assistant",
            content: "Earlier enhanced answer",
            reasoning_content: null,
            created_at: "2026-10-15T00:00:03.000Z",
          },
        ],
        rowCount: 3,
      };
    }
    if (sql.startsWith("select * from agent_package_versions where id = $1 and package_id = $2")) {
      return {
        rows: [{
          id: 33,
          package_id: 7,
          version_number: 4,
          source: "manual",
          snapshot_json: {
            name: "Historic Package",
            description: "",
            versionLabel: "v4",
            agentMd: "Fixed package agent instructions",
            rubricMd: "Historic rubric",
            skills: [],
          },
          note: "",
          created_at: "2026-10-15T00:00:00.000Z",
        }],
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
              skillMd: "BOUND_SKILL_VERSION_BODY",
            },
          },
        ],
        rowCount: 2,
      };
    }
    if (sql.startsWith("insert into arena_messages")) {
      return { rows: [{ id: nextMessageId++ }], rowCount: 1 };
    }
    if (sql.includes("insert into arena_answer_runs")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.startsWith("update arena_threads set updated_at = $1")) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  withTransactionMock.mockImplementation(async (work) => work({ query: queryMock }));
}

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.doUnmock("./db.js");
  vi.doUnmock("./llm-service.js");
  vi.doUnmock("./package-service.js");
  vi.doUnmock("../config.js");
  vi.doUnmock("../harness/pi-core-adapter.js");
  vi.doUnmock("../lib/request-context.js");
});

describe("Arena Pi Harness integration", () => {
  it("routes an eligible Skill Run through Pi with the bound SkillVersion and enhanced history", async () => {
    installQueryFixture("run");
    runPiAgentMock.mockImplementation(async (
      request: HarnessRunRequest,
      emit: HarnessEventEmitter,
    ) => {
      await emit({ type: "text_delta", runId: request.runId, delta: "Pi final answer" });
      return completedHarnessResult(request);
    });
    const { streamMessage } = await loadService(true);
    const signal = new AbortController().signal;
    const events = [];

    for await (const event of streamMessage(
      "user-1",
      "91",
      "Current question",
      "requested-model",
      "agent",
      false,
      signal,
    )) {
      events.push(event);
    }

    expect(runPiAgentMock).toHaveBeenCalledTimes(1);
    expect(streamTextPartsMock).not.toHaveBeenCalled();
    const harnessRequest = runPiAgentMock.mock.calls[0]?.[0] as HarnessRunRequest;
    expect(harnessRequest.selectedSkill).toEqual({
      versionId: 202,
      skillMd: "BOUND_SKILL_VERSION_BODY",
    });
    expect(harnessRequest.agentInstructions).toContain("Fixed package agent instructions");
    expect(harnessRequest.history).toEqual([
      expect.objectContaining({ role: "user", content: "Earlier question" }),
      expect.objectContaining({ role: "assistant", content: "Earlier enhanced answer" }),
    ]);
    expect(JSON.stringify(harnessRequest.history)).not.toContain("Baseline answer must be excluded");
    expect(JSON.stringify(harnessRequest.history)).not.toContain("Current question");
    expect(harnessRequest.currentInput).toBe("Current question");
    expect(harnessRequest.signal).toBe(signal);
    expect(events).toContainEqual({
      event: "side_done",
      data: {
        side: "enhanced",
        content: "Pi final answer",
        reasoningContent: null,
        ok: true,
      },
    });
    const assistantInsert = queryMock.mock.calls.find((call) =>
      String(call[0]).startsWith("insert into arena_messages") && call[1]?.[3] === "assistant"
    );
    expect(assistantInsert?.[1]?.[4]).toBe("Pi final answer");
    const answerRunInsert = queryMock.mock.calls.find((call) =>
      String(call[0]).includes("insert into arena_answer_runs")
    );
    expect(answerRunInsert?.[1]?.[9]).toBe("actual-response-model");
    expect(answerRunInsert?.[1]?.[14]).toBe(202);
  });

  it("does not save an assistant or answer run when Pi fails", async () => {
    installQueryFixture("test");
    runPiAgentMock.mockImplementation(async (request: HarnessRunRequest) =>
      failedHarnessResult(request)
    );
    const { streamMessage } = await loadService(true);
    const events = [];

    await expect(async () => {
      for await (const event of streamMessage(
        "user-1",
        "91",
        "Current question",
        undefined,
        "agent",
      )) {
        events.push(event);
      }
    }).rejects.toThrow("模型服务暂时不可用");

    expect(events).toContainEqual(expect.objectContaining({
      event: "side_done",
      data: expect.objectContaining({ side: "enhanced", ok: false, content: "" }),
    }));
    expect(queryMock.mock.calls.some((call) =>
      String(call[0]).startsWith("insert into arena_messages") && call[1]?.[3] === "assistant"
    )).toBe(false);
    expect(queryMock.mock.calls.some((call) =>
      String(call[0]).includes("insert into arena_answer_runs")
    )).toBe(false);
  });

  it("does not publish a successful side_done when the persistence transaction fails", async () => {
    installQueryFixture("run");
    runPiAgentMock.mockImplementation(async (request: HarnessRunRequest) =>
      completedHarnessResult(request)
    );
    withTransactionMock.mockRejectedValueOnce(new Error("controlled transaction failure"));
    const { streamMessage } = await loadService(true);
    const events: unknown[] = [];

    await expect(async () => {
      for await (const event of streamMessage(
        "user-1",
        "91",
        "Current question",
        undefined,
        "agent",
      )) {
        events.push(event);
      }
    }).rejects.toMatchObject({ code: "SAVE_FAILED" });

    expect(events).not.toContainEqual(expect.objectContaining({
      event: "side_done",
      data: expect.objectContaining({ ok: true }),
    }));
    expect(events).not.toContainEqual(expect.objectContaining({ event: "done" }));
  });

  it("rejects a concurrent Pi run for the same thread before inserting another user message", async () => {
    installQueryFixture("run");
    let finishFirst: (() => void) | undefined;
    runPiAgentMock.mockImplementationOnce((request: HarnessRunRequest) =>
      new Promise<HarnessResult>((resolve) => {
        finishFirst = () => resolve(completedHarnessResult(request));
      })
    );
    const { streamMessage } = await loadService(true);
    const first = collectEvents(streamMessage(
      "user-1",
      "91",
      "First concurrent question",
      undefined,
      "agent",
    ));
    await vi.waitFor(() => expect(runPiAgentMock).toHaveBeenCalledTimes(1));

    await expect(collectEvents(streamMessage(
      "user-1",
      "91",
      "Second concurrent question",
      undefined,
      "agent",
    ))).rejects.toMatchObject({ code: "RUN_BUSY", status: 409 });
    expect(runPiAgentMock).toHaveBeenCalledTimes(1);
    const sharedUserInserts = queryMock.mock.calls.filter((call) =>
      String(call[0]).startsWith("insert into arena_messages")
      && call[1]?.[2] === "shared"
      && call[1]?.[3] === "user"
    );
    expect(sharedUserInserts).toHaveLength(1);

    finishFirst?.();
    await first;
  });

  it("does not persist a completed Adapter result if cancellation won before persistence", async () => {
    installQueryFixture("run");
    const controller = new AbortController();
    runPiAgentMock.mockImplementation(async (request: HarnessRunRequest) => {
      controller.abort();
      return completedHarnessResult(request);
    });
    const { streamMessage } = await loadService(true);

    await expect(collectEvents(streamMessage(
      "user-1",
      "91",
      "Current question",
      undefined,
      "agent",
      false,
      controller.signal,
    ))).rejects.toMatchObject({ code: "RUN_CANCELLED" });

    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some((call) =>
      String(call[0]).startsWith("insert into arena_messages") && call[1]?.[3] === "assistant"
    )).toBe(false);
  });

  it("propagates cancellation to Pi and does not persist a fake success", async () => {
    installQueryFixture("run");
    runPiAgentMock.mockImplementation((request: HarnessRunRequest) =>
      new Promise<HarnessResult>((resolve) => {
        const finish = () => resolve(failedHarnessResult(request, "RUN_CANCELLED"));
        if (request.signal?.aborted) finish();
        else request.signal?.addEventListener("abort", finish, { once: true });
      })
    );
    const { streamMessage } = await loadService(true);
    const controller = new AbortController();
    const events: unknown[] = [];
    const pending = (async () => {
      for await (const event of streamMessage(
        "user-1",
        "91",
        "Current question",
        undefined,
        "agent",
        false,
        controller.signal,
      )) {
        events.push(event);
      }
    })();

    await vi.waitFor(() => expect(runPiAgentMock).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toThrow("本次运行已取消");
    expect((runPiAgentMock.mock.calls[0]?.[0] as HarnessRunRequest).signal?.aborted).toBe(true);
    expect(events).toContainEqual(expect.objectContaining({ event: "side_start" }));
    expect(queryMock.mock.calls.some((call) =>
      String(call[0]).startsWith("insert into arena_messages") && call[1]?.[3] === "assistant"
    )).toBe(false);
  });

  it.each([
    [false, "run", "agent"],
    [true, "arena", "agent"],
    [true, "run", "compare"],
  ] as const)(
    "keeps Legacy streaming when enabled=%s, surface=%s, and mode=%s",
    async (enabled, surface, mode) => {
      installQueryFixture(surface);
      streamTextPartsMock.mockImplementation(async function* () {
        yield { type: "content", delta: "Legacy answer" };
      });
      const { streamMessage } = await loadService(enabled);
      const events = [];

      for await (const event of streamMessage(
        "user-1",
        "91",
        "Current question",
        undefined,
        mode,
      )) {
        events.push(event);
      }

      expect(runPiAgentMock).not.toHaveBeenCalled();
      expect(streamTextPartsMock).toHaveBeenCalledTimes(mode === "compare" ? 2 : 1);
      expect(events).toContainEqual({
        event: "side_done",
        data: {
          side: "enhanced",
          content: "Legacy answer",
          reasoningContent: null,
          ok: true,
        },
      });
    },
  );
});
