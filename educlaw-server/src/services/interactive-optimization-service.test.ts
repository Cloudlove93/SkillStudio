import { afterEach, describe, expect, it, vi } from "vitest";

const getPackageMock = vi.fn();
const applyOptimizedSnapshotMock = vi.fn();
const listVersionsMock = vi.fn();
const getThreadDetailMock = vi.fn();
const generateChatMock = vi.fn();

async function loadService() {
  vi.resetModules();
  vi.doMock("./package-service.js", () => ({
    getPackage: getPackageMock,
    applyOptimizedSnapshot: applyOptimizedSnapshotMock,
    listVersions: listVersionsMock,
    assertRubricConfigured: (rubricMd: string | undefined | null, feature: string) => {
      if (!String(rubricMd || "").trim()) {
        throw new Error(`当前智能体还没有配置 rubric。请先在 Rubric 标签中补充评分规则后再使用${feature}。`);
      }
    },
  }));
  vi.doMock("./db.js", () => ({
    newId: () => "test-id",
    query: vi.fn(),
  }));
  vi.doMock("./arena-service.js", () => ({
    getThreadDetail: getThreadDetailMock,
  }));
  vi.doMock("./llm-service.js", () => ({
    generateChat: generateChatMock,
    generateJson: vi.fn(),
  }));
  return import("./interactive-optimization-service.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./package-service.js");
  vi.doUnmock("./db.js");
  vi.doUnmock("./arena-service.js");
  vi.doUnmock("./llm-service.js");
  getPackageMock.mockReset();
  applyOptimizedSnapshotMock.mockReset();
  listVersionsMock.mockReset();
  getThreadDetailMock.mockReset();
  generateChatMock.mockReset();
});

describe("interactive-optimization-service", () => {
  it("rejects diagnosis before model work when rubric is missing", async () => {
    getPackageMock.mockResolvedValue({
      name: "No Rubric Agent",
      snapshot: {
        name: "No Rubric Agent",
        description: "Needs manual rubric",
        versionLabel: "v1",
        agentMd: "# Agent",
        rubricMd: "",
        skills: [],
      },
    });
    getThreadDetailMock.mockResolvedValue({
      thread: { packageId: "package-1" },
      messages: [],
    });

    const { diagnosePackage } = await loadService();

    await expect(diagnosePackage("user-1", "package-1", "thread-1")).rejects.toThrow("还没有配置 rubric");
    expect(generateChatMock).not.toHaveBeenCalled();
  });

  it("rejects chat optimization before model work when rubric is missing", async () => {
    getPackageMock.mockResolvedValue({
      snapshot: {
        name: "No Rubric Agent",
        description: "Needs manual rubric",
        versionLabel: "v1",
        agentMd: "# Agent",
        rubricMd: "",
        skills: [],
      },
    });

    const { chatOptimize } = await loadService();

    await expect(
      chatOptimize("user-1", "package-1", {
        messages: [{ role: "user", content: "帮我优化" }],
        adoptedChanges: [],
      }),
    ).rejects.toThrow("还没有配置 rubric");
    expect(generateChatMock).not.toHaveBeenCalled();
  });

  it("keeps untouched package metadata when saving adopted changes", async () => {
    getPackageMock.mockResolvedValue({
      snapshot: {
        name: "原始智能体",
        description: "这是一段较完整的 package description，保存时不应被压短。",
        versionLabel: "v3",
        agentMd: "---\nname: original-agent\n---\n\n# Agent\n原始内容",
        rubricMd: "# Rubric\n原始评分标准",
        skills: [
          {
            id: "skill-1",
            dirName: "skill-one",
            name: "技能一",
            description: "原始技能描述",
            skillMd: "---\nname: skill-one\ndescription: 原始技能描述\n---\n\n# Skill\n原始技能正文",
          },
        ],
      },
    });
    listVersionsMock.mockResolvedValue([
      { id: "version-9", versionNumber: 9 },
    ]);

    const { applyInteractiveChanges } = await loadService();

    const result = await applyInteractiveChanges("user-1", "package-1", [
      {
        id: "adopt-1",
        target: "skill",
        targetId: "skill-one",
        original: "---\nname: skill-one\ndescription: 原始技能描述\n---\n\n# Skill\n原始技能正文",
        modified: "---\nname: skill-one\ndescription: 仅补充触发条件\n---\n\n# Skill\n更新后的技能正文",
        reason: "补充技能说明",
      },
    ]);

    expect(result).toEqual({ versionId: "version-9", versionNumber: 9 });
    expect(applyOptimizedSnapshotMock).toHaveBeenCalledTimes(1);

    const snapshot = applyOptimizedSnapshotMock.mock.calls[0]![2];
    expect(snapshot.description).toBe("这是一段较完整的 package description，保存时不应被压短。");
    expect(snapshot.name).toBe("原始智能体");
    // skill 中文名不应被 frontmatter 的 name(目录名格式)覆盖
    expect(snapshot.skills[0].name).toBe("技能一");
    expect(snapshot.skills[0].description).toBe("仅补充触发条件");
    expect(snapshot.skills[0].skillMd).toContain("更新后的技能正文");
  });

  it("auto-adopts <MODIFIED> blocks even when LLM omits [ADOPT] markers", async () => {
    getPackageMock.mockResolvedValue({
      snapshot: {
        name: "原始智能体",
        description: "原始 package description",
        versionLabel: "v1",
        agentMd: "---\nname: original-agent\n---\n\n# Agent\n原始内容",
        rubricMd: "# Rubric\n原始评分标准",
        skills: [
          {
            id: "skill-1",
            dirName: "immediate-control",
            name: "immediate-control",
            description: "原始技能描述",
            skillMd: "---\nname: immediate-control\ndescription: 原始技能描述\n---\n\n# Skill\n原始技能正文",
          },
        ],
      },
    });
    generateChatMock.mockResolvedValue(
      [
        "我已经调整了 immediate-control,把反应时长从 15 秒缩短到 3-5 秒。",
        "",
        "<MODIFIED target=\"skill\" targetId=\"immediate-control\">",
        "```markdown",
        "---",
        "name: immediate-control",
        "description: 原始技能描述",
        "---",
        "",
        "# Skill",
        "更新后的技能正文,反应时长 3-5 秒",
        "```",
        "</MODIFIED>",
        "",
        "[NEXT]",
      ].join("\n"),
    );

    const { chatOptimize } = await loadService();

    const result = await chatOptimize("user-1", "package-1", {
      messages: [{ role: "user", content: "缩短反应时长" }],
      adoptedChanges: [],
    });

    expect(result.newAdoptions).toHaveLength(1);
    const adoption = result.newAdoptions[0]!;
    expect(adoption.target).toBe("skill");
    expect(adoption.targetId).toBe("immediate-control");
    expect(adoption.modified).toContain("更新后的技能正文");
    expect(adoption.modified).not.toContain("原始技能正文");
    expect(adoption.original).toContain("原始技能正文");
    expect(result.isDone).toBe(false);
    // cleanReply 不应包含 <MODIFIED> 块或 [NEXT] 标记(都被 parseMarkers 过滤)
    expect(result.reply).not.toContain("<MODIFIED");
    expect(result.reply).not.toContain("更新后的技能正文");
    expect(result.reply).not.toContain("[NEXT]");
    expect(result.reply).toContain("缩短到 3-5 秒");
  });

  it("skips [ADOPT] markers without matching <MODIFIED> blocks", async () => {
    getPackageMock.mockResolvedValue({
      snapshot: {
        name: "原始智能体",
        description: "原始 package description",
        versionLabel: "v1",
        agentMd: "---\nname: original-agent\n---\n\n# Agent\n原始内容",
        rubricMd: "# Rubric\n原始评分标准",
        skills: [],
      },
    });
    // LLM 只输出 [ADOPT] 标记但没有 <MODIFIED> 块
    generateChatMock.mockResolvedValue("[ADOPT:agent::优化了角色定义]\n\n[NEXT]");

    const { chatOptimize } = await loadService();

    const result = await chatOptimize("user-1", "package-1", {
      messages: [{ role: "user", content: "优化 agent" }],
      adoptedChanges: [],
    });

    // 没有实际修改内容,不应产生 adoption
    expect(result.newAdoptions).toHaveLength(0);
  });

  it("preserves existing skill frontmatter when adopted change only provides body content", async () => {
    getPackageMock.mockResolvedValue({
      snapshot: {
        name: "原始智能体",
        description: "原始 package description",
        versionLabel: "v2",
        agentMd: "---\nname: original-agent\n---\n\n# Agent\n原始内容",
        rubricMd: "# Rubric\n原始评分标准",
        skills: [
          {
            id: "skill-1",
            dirName: "skill-one",
            name: "skill-one",
            description: "原始技能描述",
            skillMd: "---\nname: skill-one\ndescription: 原始技能描述\n---\n\n# Skill\n原始技能正文",
          },
        ],
      },
    });
    listVersionsMock.mockResolvedValue([{ id: "version-10", versionNumber: 10 }]);

    const { applyInteractiveChanges } = await loadService();

    await applyInteractiveChanges("user-1", "package-1", [
      {
        id: "adopt-2",
        target: "skill",
        targetId: "skill-one",
        original: "---\nname: skill-one\ndescription: 原始技能描述\n---\n\n# Skill\n原始技能正文",
        modified: "# Skill\n更新后的正文\n\n## Workflow\n- 新增步骤",
        reason: "补充 workflow",
      },
    ]);

    const snapshot = applyOptimizedSnapshotMock.mock.calls[0]![2];
    expect(snapshot.skills[0].name).toBe("skill-one");
    expect(snapshot.skills[0].description).toBe("原始技能描述");
    expect(snapshot.skills[0].skillMd).toContain("name: skill-one");
    expect(snapshot.skills[0].skillMd).toContain("description: 原始技能描述");
    expect(snapshot.skills[0].skillMd).toContain("更新后的正文");
  });
});
