import { afterEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const generateJsonMock = vi.fn();
const streamTextMock = vi.fn();

async function loadService() {
  vi.resetModules();

  const ids = ["skill-1", "package-1", "version-1"];
  let storedPackage: Record<string, unknown> | null = null;
  let storedVersion: Record<string, unknown> | null = null;

  vi.doMock("./db.js", () => ({
    newId: () => ids.shift() || `id-${Math.random().toString(36).slice(2, 8)}`,
    query: queryMock.mockImplementation(async (sql: string, args: unknown[]) => {
      if (sql.startsWith("insert into agent_package_versions")) {
        storedVersion = {
          id: args[0],
          package_id: args[1],
          version_number: args[2],
          source: args[3],
          snapshot_json: args[4],
          created_at: args[5],
          note: "",
        };
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("insert into agent_packages")) {
        storedPackage = {
          id: args[0],
          user_id: args[1],
          name: args[2],
          description: args[3],
          current_version_id: args[4],
          created_at: args[5],
          updated_at: args[6],
        };
        return { rows: [], rowCount: 1 };
      }

      if (sql.startsWith("select * from agent_packages where id = $1")) {
        return { rows: storedPackage ? [storedPackage] : [], rowCount: storedPackage ? 1 : 0 };
      }

      if (sql.startsWith("select * from agent_package_versions where id = $1")) {
        return { rows: storedVersion ? [storedVersion] : [], rowCount: storedVersion ? 1 : 0 };
      }

      throw new Error(`Unexpected query: ${sql}`);
    }),
  }));

  vi.doMock("./llm-service.js", () => ({
    generateJson: generateJsonMock,
    generateText: vi.fn(),
    generateChat: vi.fn(),
    streamText: streamTextMock,
  }));

  return import("./package-service.js");
}

function makeLongSkillMarkdown() {
  return [
    "# 核心任务处理",
    "## When to use",
    "- 当用户需要执行核心任务时使用。",
    "- 如果请求需要结构化方案时使用。",
    "## When not to use",
    "- 如果只是闲聊，不要使用。",
    "- 如果请求超出边界，转交其他流程。",
    "## Instructions",
    "- 先判断用户目标。",
    "- 再给出结构化方案和注意事项。",
    "## Workflow",
    "1. 识别问题。",
    "2. 输出步骤。",
    "3. 检查边界与风险。",
    "## Output Format",
    "- 场景判断",
    "- 处理方案",
    "- 风险提示",
    "- 后续建议",
    "## Examples",
    "- 示例一：给出一套清晰步骤。",
    "- 示例二：说明什么时候需要补充信息。",
    "## Common Issues",
    "- 信息不足时先追问。",
    "- 请求越界时要明确说明边界。",
    "",
    "为了通过长度校验，这里补充一些详细说明：该 Skill 需要保持回答清晰、分步骤、可执行，并在必要时提醒用户补充上下文。".repeat(4),
  ].join("\n");
}

function makeSkillMarkdownMissingSections() {
  return [
    "# 核心任务处理",
    "## When to use",
    "- 当用户需要完成核心任务时使用。",
    "- 如果请求需要结构化方案时使用。",
    "## When not to use",
    "- 如果只是闲聊，不要使用。",
    "- 如果请求超出边界，交给其他流程。",
    "## Instructions",
    "- 先判断用户目标。",
    "- 再给出结构化方案和注意事项。",
    "- 回答时保持清楚、可执行，并在必要时提醒用户补充上下文。",
    "- 如果信息不足，先补问关键条件，再继续输出方案。",
    "## Output Format",
    "- 场景判断",
    "- 处理方案",
    "- 风险提示",
    "- 后续建议",
    "",
    "这里故意漏掉 Workflow、Examples、Common Issues 三个章节，用来验证后端会自动补齐缺失结构，而不是直接报校验失败。为了通过长度校验，这里再补充一些正文内容，说明这个技能需要保持边界清晰、步骤明确、表达稳定，并且让输出可以直接拿去执行。".repeat(3),
  ].join("\n");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./db.js");
  vi.doUnmock("./llm-service.js");
  queryMock.mockReset();
  generateJsonMock.mockReset();
  streamTextMock.mockReset();
});

describe("generatePackage", () => {
  it("allows an empty rubricMd and still creates the package", async () => {
    generateJsonMock.mockResolvedValue({
      name: "测试智能体",
      description: "用于处理测试任务",
      skills: [
        {
          dirName: "core-task",
          name: "核心任务处理",
          description: "用于当用户提出核心任务时，分析需求并输出结构化结果。",
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield "# 测试智能体\n\n这是一个用于处理测试任务的 agent 说明。".repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {})();
      }
      return (async function* () {
        yield makeLongSkillMarkdown();
      })();
    });

    const { generatePackage } = await loadService();
    const detail = await generatePackage("user-1", "请生成一个测试智能体");

    expect(detail.name).toBe("测试智能体");
    expect(detail.snapshot.rubricMd).toBe("");
    expect(detail.snapshot.skills).toHaveLength(1);
    expect(queryMock).toHaveBeenCalled();
  });

  it("autofills missing skill sections before validation", async () => {
    generateJsonMock.mockResolvedValue({
      name: "测试智能体",
      description: "用于处理测试任务",
      skills: [
        {
          dirName: "core-task",
          name: "核心任务处理",
          description: "用于当用户提出核心任务时，分析需求并输出结构化结果。",
        },
      ],
    });

    let streamCall = 0;
    streamTextMock.mockImplementation(() => {
      streamCall += 1;
      if (streamCall === 1) {
        return (async function* () {
          yield "# 测试智能体\n\n这是一个用于处理测试任务的 agent 说明。".repeat(20);
        })();
      }
      if (streamCall === 2) {
        return (async function* () {})();
      }
      return (async function* () {
        yield makeSkillMarkdownMissingSections();
      })();
    });

    const { generatePackage } = await loadService();
    const detail = await generatePackage("user-1", "请生成一个测试智能体");
    const skillMd = detail.snapshot.skills[0]!.skillMd;

    expect(skillMd).toContain("## Workflow");
    expect(skillMd).toContain("## Examples");
    expect(skillMd).toContain("## Common Issues");
  });
});
