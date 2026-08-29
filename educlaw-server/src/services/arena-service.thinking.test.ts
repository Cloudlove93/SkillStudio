import { afterEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const withTransactionMock = vi.fn();
const streamTextPartsMock = vi.fn();
const supportsExplicitThinkingMock = vi.fn();

async function loadService() {
  vi.resetModules();
  vi.doMock("./db.js", () => ({
    query: queryMock,
    withTransaction: withTransactionMock,
  }));
  vi.doMock("./llm-service.js", () => ({
    generateJson: vi.fn(),
    generateText: vi.fn(),
    resolveBaselineModel: vi.fn((model?: string) => model || "baseline-model"),
    resolveEnhancedModel: vi.fn((model?: string) => model || "kimi-k2.5"),
    streamText: vi.fn(),
    streamTextParts: streamTextPartsMock,
    supportsExplicitThinking: supportsExplicitThinkingMock,
  }));
  vi.doMock("./package-service.js", () => ({
    assertRubricConfigured: vi.fn(),
    getPackage: vi.fn(),
    getPackageWithVersionId: vi.fn(),
  }));
  return import("./arena-service.js");
}

function createQueryFixture(input: {
  surface: "run" | "test" | "arena" | "optimize";
  existingReasoning?: string | null;
}) {
  let nextMessageId = 50;
  return async (sql: string) => {
    if (sql.startsWith("select * from arena_threads where id = $1 and user_id = $2")) {
      return {
        rows: [{
          id: 91,
          user_id: "user-1",
          package_id: 7,
          title: "Skill 对话",
          model: "kimi-k2.5",
          arena_kind: "skill_arena",
          base_package_version_id: 33,
          arena_config_jsonb: {
            mode: "skill_arena",
            compositionMode: "skill_only",
            surface: input.surface,
            basePackageVersionId: "33",
          },
          created_at: "2026-08-27T00:00:00.000Z",
          updated_at: "2026-08-27T00:00:00.000Z",
        }],
        rowCount: 1,
      };
    }
    if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1")) {
      return {
        rows: input.existingReasoning
          ? [{
              id: 40,
              thread_id: 91,
              user_id: "user-1",
              side: "enhanced",
              role: "assistant",
              content: "上一轮公开答案",
              reasoning_content: input.existingReasoning,
              created_at: "2026-08-27T00:00:00.000Z",
            }]
          : [],
        rowCount: input.existingReasoning ? 1 : 0,
      };
    }
    if (sql.startsWith("select * from agent_package_versions where id = $1")) {
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
            agentMd: "Historic agent",
            rubricMd: "Historic rubric",
            skills: [],
          },
          note: "",
          created_at: "2026-08-27T00:00:00.000Z",
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
            created_at: "2026-08-27T00:00:00.000Z",
          },
          {
            id: 102,
            thread_id: 91,
            package_id: 7,
            side: "right",
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
            created_at: "2026-08-27T00:00:00.000Z",
          },
        ],
        rowCount: 2,
      };
    }
    if (sql.startsWith("select atv.side,")) {
      return {
        rows: [
          { side: "left", bound_version_number: 1, latest_version_number: 1 },
          { side: "right", bound_version_number: 1, latest_version_number: 1 },
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
  };
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./db.js");
  vi.doUnmock("./llm-service.js");
  vi.doUnmock("./package-service.js");
  queryMock.mockReset();
  withTransactionMock.mockReset();
  streamTextPartsMock.mockReset();
  supportsExplicitThinkingMock.mockReset();
});

describe("Skill chat thinking stream", () => {
  it("streams and persists reasoning for an enabled run conversation", async () => {
    queryMock.mockImplementation(createQueryFixture({
      surface: "run",
      existingReasoning: "PRIVATE_HISTORY_REASONING",
    }));
    withTransactionMock.mockImplementation(async (work) =>
      work({ query: queryMock }),
    );
    supportsExplicitThinkingMock.mockReturnValue(true);
    streamTextPartsMock.mockImplementation(async function* () {
      yield { type: "reasoning", delta: "先分析" };
      yield { type: "reasoning", delta: "再验证" };
      yield { type: "content", delta: "最终答案" };
    });
    const { streamMessage } = await loadService();

    const events = [];
    for await (const event of streamMessage(
      "user-1",
      "91",
      "继续提问",
      "kimi-k2.5",
      "agent",
      true,
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      event: "thinking_status",
      data: { requested: true, enabled: true, supported: true },
    });
    expect(events).toContainEqual({
      event: "reasoning_delta",
      data: { side: "enhanced", delta: "先分析" },
    });
    expect(events).toContainEqual({
      event: "side_done",
      data: {
        side: "enhanced",
        content: "最终答案",
        reasoningContent: "先分析再验证",
        ok: true,
      },
    });
    expect(streamTextPartsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "kimi-k2.5",
        thinkingMode: "enabled",
      }),
    );
    const prompt = streamTextPartsMock.mock.calls[0]?.[0]?.userPrompt;
    expect(prompt).toContain("上一轮公开答案");
    expect(prompt).not.toContain("PRIVATE_HISTORY_REASONING");

    const assistantInsert = queryMock.mock.calls.find((call) =>
      String(call[0]).startsWith("insert into arena_messages")
      && call[1]?.[3] === "assistant",
    );
    expect(String(assistantInsert?.[0])).toContain("reasoning_content");
    expect(assistantInsert?.[1]?.[5]).toBe("先分析再验证");

    const done = events.find((event) => event.event === "done");
    expect(done?.data.messages.at(-1)?.reasoningContent).toBe("先分析再验证");
  });

  it("forces thinking off for Arena even when the client requests it", async () => {
    queryMock.mockImplementation(createQueryFixture({ surface: "arena" }));
    withTransactionMock.mockImplementation(async (work) =>
      work({ query: queryMock }),
    );
    supportsExplicitThinkingMock.mockReturnValue(true);
    streamTextPartsMock.mockImplementation(async function* () {
      yield { type: "content", delta: "普通答案" };
    });
    const { streamMessage } = await loadService();

    const events = [];
    for await (const event of streamMessage(
      "user-1",
      "91",
      "对比问题",
      "kimi-k2.5",
      "compare",
      true,
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      event: "thinking_status",
      data: { requested: true, enabled: false, supported: true },
    });
    expect(streamTextPartsMock).toHaveBeenCalledTimes(2);
    for (const call of streamTextPartsMock.mock.calls) {
      expect(call[0]).toMatchObject({ thinkingMode: "disabled" });
    }
    expect(events.some((event) => event.event === "reasoning_delta")).toBe(false);
  });

  it("degrades to a normal answer when the selected model lacks thinking support", async () => {
    queryMock.mockImplementation(createQueryFixture({ surface: "test" }));
    withTransactionMock.mockImplementation(async (work) =>
      work({ query: queryMock }),
    );
    supportsExplicitThinkingMock.mockReturnValue(false);
    streamTextPartsMock.mockImplementation(async function* () {
      yield { type: "content", delta: "仍然回答" };
    });
    const { streamMessage } = await loadService();

    const events = [];
    for await (const event of streamMessage(
      "user-1",
      "91",
      "测试问题",
      "gpt-compatible",
      "agent",
      true,
    )) {
      events.push(event);
    }

    expect(events).toContainEqual({
      event: "thinking_status",
      data: { requested: true, enabled: false, supported: false },
    });
    expect(events).toContainEqual({
      event: "side_done",
      data: {
        side: "enhanced",
        content: "仍然回答",
        reasoningContent: null,
        ok: true,
      },
    });
  });
});
