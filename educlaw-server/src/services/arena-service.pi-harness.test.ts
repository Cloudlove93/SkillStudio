import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArenaChatStreamEvent } from "./arena-service.js";
import type {
  HarnessEventEmitter,
  HarnessResult,
  HarnessRunRequest,
} from "../harness/contracts.js";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const streamTextPartsMock = vi.fn();
const runPiAgentMock = vi.fn();
const supportsThinkingMock = vi.fn(() => false);
const configMock = {
  piHarnessSkillRunEnabled: true,
  piHarnessMaxConcurrentRuns: 4,
};

async function collectEvents(
  stream: AsyncGenerator<ArenaChatStreamEvent>,
): Promise<ArenaChatStreamEvent[]> {
  const events: ArenaChatStreamEvent[] = [];
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
    supportsExplicitThinking: supportsThinkingMock,
  }));
  vi.doMock("./package-service.js", () => ({
    assertRubricConfigured: vi.fn(),
    getPackage: vi.fn(),
    getPackageWithVersionId: vi.fn(),
  }));
  vi.doMock("../config.js", () => ({ config: configMock }));
  vi.doMock("../harness/pi-core-adapter.js", async () => ({
    ...await vi.importActual("../harness/pi-core-adapter.js"),
    runPiAgent: runPiAgentMock,
  }));
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
  supportsThinkingMock.mockReturnValue(false);
  vi.doUnmock("./db.js");
  vi.doUnmock("./llm-service.js");
  vi.doUnmock("./package-service.js");
  vi.doUnmock("../config.js");
  vi.doUnmock("../harness/pi-core-adapter.js");
  vi.doUnmock("../lib/request-context.js");
});

describe("Arena Pi Harness integration", () => {
  it("Legacy and managed entry points share the same Run/Test thread reservation", async () => {
    installQueryFixture();
    const { streamMessage } = await loadService(false);
    const { reserveArenaThread } = await import("./arena-thread-lifecycle.js");
    const release = reserveArenaThread("user-1", "91");
    try { await expect(collectEvents(streamMessage("user-1", "91", "blocked", undefined, "agent"))).rejects.toMatchObject({ code: "RUN_BUSY" }); }
    finally { release(); }
    expect(queryMock.mock.calls.some(([sql]) => sql.startsWith("insert into arena_messages"))).toBe(false);
    const oldStream = streamMessage("user-1", "91", "old request", undefined, "agent");
    while ((await oldStream.next()).value?.event !== "shared") { /* reach admission */ }
    expect(() => reserveArenaThread("user-1", "91")).toThrow("active operation");
    await oldStream.return(); const next = reserveArenaThread("user-1", "91"); next();
  });
  it("managed Legacy forwards cancellation and never persists a cancelled answer", async () => {
    installQueryFixture(); const controller = new AbortController();
    streamTextPartsMock.mockImplementation(async function* (input) {
      expect(input.signal).toBe(controller.signal);
      yield { type: "content", delta: "partial" }; controller.abort();
    });
    const { streamMessage } = await loadService(false);
    await expect(collectEvents(streamMessage("user-1", "91", "Question", undefined, "agent", false, controller.signal, { managedLifecycle: true }))).rejects.toMatchObject({ code: "RUN_CANCELLED" });
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
  it("managed Legacy provider failure cannot save a fake success", async () => {
    installQueryFixture();
    streamTextPartsMock.mockImplementation(async function* () { yield* []; throw new Error("Legacy provider failed"); });
    const { streamMessage } = await loadService(false);
    await expect(collectEvents(streamMessage("user-1", "91", "Question", undefined, "agent", false, undefined, { managedLifecycle: true }))).rejects.toThrow("Legacy provider failed");
    expect(withTransactionMock).not.toHaveBeenCalled();
  });
  it("managed Legacy checks cancellation after waiting for the persistence connection", async () => {
    installQueryFixture(); const controller = new AbortController();
    streamTextPartsMock.mockImplementation(async function* () { yield { type: "content", delta: "answer" }; });
    withTransactionMock.mockImplementation(async (work) => { controller.abort(); return work({ query: queryMock }); });
    const { streamMessage } = await loadService(false);
    await expect(collectEvents(streamMessage("user-1", "91", "Question", undefined, "agent", false, controller.signal, { managedLifecycle: true }))).rejects.toMatchObject({ code: "RUN_CANCELLED" });
    expect(queryMock.mock.calls.some(([sql, args]) => sql.startsWith("insert into arena_messages") && args[3] === "assistant")).toBe(false);
  });
  it("deletion and managed execution reservations reject one another without a check race", async () => {
    installQueryFixture();
    const { deleteArenaThread } = await loadService(false);
    const { reserveArenaThread } = await import("./arena-thread-lifecycle.js");
    const release = reserveArenaThread("user-1", "91");
    try { await expect(deleteArenaThread({ authUserId: "user-1", packageId: "7", threadId: "91" })).rejects.toMatchObject({ code: "RUN_BUSY", status: 409 }); expect(withTransactionMock).not.toHaveBeenCalled(); }
    finally { release(); }
    let finish!: () => void;
    withTransactionMock.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ ok: true }); }));
    const deletion = deleteArenaThread({ authUserId: "user-1", packageId: "7", threadId: "91" });
    await Promise.resolve();
    expect(() => reserveArenaThread("user-1", "91")).toThrow("active operation");
    finish(); await deletion; const released = reserveArenaThread("user-1", "91"); released();
  });
  it.each([[false, true], [true, false]])("discards unexpected reasoning when requested=%s and supported=%s", async (requested, supported) => {
    installQueryFixture();
    supportsThinkingMock.mockReturnValue(supported);
    runPiAgentMock.mockImplementation(async (request: HarnessRunRequest, emit: HarnessEventEmitter) => {
      await emit({ type: "reasoning_delta", runId: request.runId, delta: "must stay hidden" });
      return completedHarnessResult(request);
    });
    const { streamMessage } = await loadService();
    const events = await collectEvents(streamMessage("user-1", "91", "Question", "kimi-k2.6", "agent", requested));
    expect(events.some((event) => event.event === "reasoning_delta")).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ event: "side_done", data: expect.objectContaining({ reasoningContent: null }) }));
    const assistant = queryMock.mock.calls.find(([sql, args]) => sql.startsWith("insert into arena_messages") && args[3] === "assistant");
    expect(assistant?.[1][5]).toBeNull();
  });

  it.each([false, true])("gates native SDK reasoning in SSE and persistence when enabled=%s", async (enabled) => {
    installQueryFixture();
    supportsThinkingMock.mockReturnValue(true);
    const { streamMessage } = await loadService();
    const { sdkFixture } = await import("../../test-utils/pi-sdk-fixture.js");
    const fixture = sdkFixture();
    runPiAgentMock.mockImplementation(fixture.run);
    const events = await collectEvents(streamMessage("user-1", "91", "Question", "kimi-k2.6", "agent", enabled));
    expect(fixture.nativeEvents).toContain("thinking_delta");
    expect(events.filter((event) => event.event === "reasoning_delta")).toEqual(enabled ? [{
      event: "reasoning_delta", data: { side: "enhanced", delta: "Visible reasoning." },
    }] : []);
    expect(events).toContainEqual({ event: "side_done", data: {
      side: "enhanced", content: "SDK final answer", reasoningContent: enabled ? "Visible reasoning." : null, ok: true,
    } });
    const assistant = queryMock.mock.calls.find(([sql, args]) => sql.startsWith("insert into arena_messages") && args[3] === "assistant");
    expect(assistant?.[1][5]).toBe(enabled ? "Visible reasoning." : null);
  });

  it.each(["error", "cancel"] as const)("does not save reasoning or answers after native SDK %s", async (outcome) => {
    installQueryFixture();
    supportsThinkingMock.mockReturnValue(true);
    const { streamMessage } = await loadService();
    const { sdkFixture } = await import("../../test-utils/pi-sdk-fixture.js");
    const fixture = sdkFixture({ failAfterReasoning: outcome === "error" });
    const controller = new AbortController();
    runPiAgentMock.mockImplementation((request, emit) => fixture.run(request, async (event) => {
      await emit(event);
      if (outcome === "cancel" && event.type === "reasoning_delta") controller.abort();
    }));
    const events: ArenaChatStreamEvent[] = [];
    const stream = streamMessage("user-1", "91", "Question", "kimi-k2.6", "agent", true, controller.signal);
    await expect(async () => { for await (const event of stream) events.push(event); }).rejects.toThrow();
    expect(fixture.nativeEvents).toContain("thinking_delta");
    expect(events).toContainEqual({ event: "reasoning_delta", data: { side: "enhanced", delta: "Visible reasoning." } });
    expect(events).toContainEqual(expect.objectContaining({ event: "side_done", data: expect.objectContaining({ ok: false, reasoningContent: null }) }));
    expect(withTransactionMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql, args]) => sql.startsWith("insert into arena_messages") && args[3] === "assistant")).toBe(false);
    expect(queryMock.mock.calls.some(([sql]) => sql.includes("insert into arena_answer_runs"))).toBe(false);
    // A subsequent request proves the lease was released on both terminal paths.
    runPiAgentMock.mockImplementation(async (request) => completedHarnessResult(request));
    await collectEvents(streamMessage("user-1", "91", "Retry", "kimi-k2.6", "agent"));
  });

  it("releases the lease after the authoritative history reload fails", async () => {
    installQueryFixture();
    const fixtureQuery = queryMock.getMockImplementation()!;
    let historyReads = 0;
    queryMock.mockImplementation(async (sql: string, args: unknown[]) => {
      if (sql.includes("from arena_messages") && ++historyReads === 2) throw new Error("controlled reload failure");
      return fixtureQuery(sql, args);
    });
    const { streamMessage } = await loadService();
    await expect(collectEvents(streamMessage("user-1", "91", "Question", undefined, "agent"))).rejects.toThrow("controlled reload failure");
    expect(runPiAgentMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql]) => sql.startsWith("insert into arena_messages"))).toBe(false);
    runPiAgentMock.mockImplementation(async (request) => completedHarnessResult(request));
    await collectEvents(streamMessage("user-1", "91", "Retry", undefined, "agent"));
  });

  it("checks cancellation after waiting for a transaction connection and releases the lease", async () => {
    installQueryFixture();
    runPiAgentMock.mockImplementation(async (request) => completedHarnessResult(request));
    const transactionEntered = Promise.withResolvers<void>();
    const transactionGate = Promise.withResolvers<void>();
    withTransactionMock.mockImplementationOnce(async (work) => {
      transactionEntered.resolve();
      await transactionGate.promise;
      return work({ query: queryMock });
    });
    const { streamMessage } = await loadService();
    const controller = new AbortController();
    const pending = collectEvents(streamMessage("user-1", "91", "Question", undefined, "agent", false, controller.signal));
    const rejected = expect(pending).rejects.toMatchObject({ code: "RUN_CANCELLED" });
    await transactionEntered.promise;
    controller.abort();
    transactionGate.resolve();
    await rejected;
    expect(queryMock.mock.calls.some(([sql, args]) => sql.startsWith("insert into arena_messages") && args[3] === "assistant")).toBe(false);
    await collectEvents(streamMessage("user-1", "91", "Retry", undefined, "agent"));
  });

  it("checks cancellation after the locked history read and releases the lease", async () => {
    installQueryFixture();
    const fixtureQuery = queryMock.getMockImplementation()!;
    const historyEntered = Promise.withResolvers<void>();
    const historyGate = Promise.withResolvers<void>();
    let historyReads = 0;
    queryMock.mockImplementation(async (sql: string, args: unknown[]) => {
      if (sql.includes("from arena_messages") && ++historyReads === 2) {
        historyEntered.resolve();
        await historyGate.promise;
      }
      return fixtureQuery(sql, args);
    });
    const { streamMessage } = await loadService();
    const controller = new AbortController();
    const pending = collectEvents(streamMessage("user-1", "91", "Question", undefined, "agent", false, controller.signal));
    const rejected = expect(pending).rejects.toMatchObject({ code: "RUN_CANCELLED" });
    await historyEntered.promise;
    controller.abort();
    historyGate.resolve();
    await rejected;
    expect(runPiAgentMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls.some(([sql]) => sql.startsWith("insert into arena_messages"))).toBe(false);
    runPiAgentMock.mockImplementation(async (request) => completedHarnessResult(request));
    await collectEvents(streamMessage("user-1", "91", "Retry", undefined, "agent"));
  });

  it("reloads authoritative history after a delayed request acquires the lease", async () => {
    installQueryFixture();
    const fixtureQuery = queryMock.getMockImplementation()!;
    const runtimeEntered = Promise.withResolvers<void>();
    const runtimeGate = Promise.withResolvers<void>();
    const firstEntered = Promise.withResolvers<void>();
    const firstGate = Promise.withResolvers<void>();
    const savedRows: unknown[] = [];
    let packageReads = 0;
    queryMock.mockImplementation(async (sql: string, args: unknown[]) => {
      const result = await fixtureQuery(sql, args);
      if (sql.startsWith("select * from agent_package_versions") && ++packageReads === 2) {
        runtimeEntered.resolve();
        await runtimeGate.promise;
      }
      if (sql.startsWith("insert into arena_messages")) {
        savedRows.push({ id: result.rows[0].id, thread_id: 91, user_id: "user-1", side: args[2], role: args[3], content: args[4], created_at: args.at(-1) });
      }
      if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1 and user_id = $2")) {
        result.rows = [...result.rows, ...savedRows];
      }
      return result;
    });
    runPiAgentMock.mockImplementation(async (request: HarnessRunRequest) => completedHarnessResult(request));
    runPiAgentMock.mockImplementationOnce(async (request: HarnessRunRequest) => {
      firstEntered.resolve();
      await firstGate.promise;
      return completedHarnessResult(request);
    });
    const { streamMessage } = await loadService();
    const first = collectEvents(streamMessage("user-1", "91", "First question", undefined, "agent"));
    await firstEntered.promise;
    const second = collectEvents(streamMessage("user-1", "91", "Second question", undefined, "agent"));
    await runtimeEntered.promise;
    firstGate.resolve();
    await first;
    runtimeGate.resolve();
    await second;
    const request = runPiAgentMock.mock.calls[1][0] as HarnessRunRequest;
    expect(request.history.map((message) => message.content)).toEqual([
      "Earlier question", "Earlier enhanced answer", "First question", "Pi final answer",
    ]);
    const answerRuns = queryMock.mock.calls.filter(([sql]) => sql.includes("insert into arena_answer_runs"));
    expect(JSON.parse(answerRuns[1][1][8])).toEqual([10, 12, 100, 101]);
  });

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
