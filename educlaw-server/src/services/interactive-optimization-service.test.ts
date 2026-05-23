import { afterEach, describe, expect, it, vi } from "vitest";

const getPackageMock = vi.fn();
const applyOptimizedSnapshotMock = vi.fn();
const listVersionsMock = vi.fn();

async function loadService() {
  vi.resetModules();
  vi.doMock("./package-service.js", () => ({
    getPackage: getPackageMock,
    applyOptimizedSnapshot: applyOptimizedSnapshotMock,
    listVersions: listVersionsMock,
  }));
  vi.doMock("./db.js", () => ({
    newId: () => "test-id",
    query: vi.fn(),
  }));
  vi.doMock("./arena-service.js", () => ({
    getThreadDetail: vi.fn(),
  }));
  vi.doMock("./llm-service.js", () => ({
    generateChat: vi.fn(),
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
});

describe("interactive-optimization-service", () => {
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
    expect(snapshot.skills[0].name).toBe("skill-one");
    expect(snapshot.skills[0].description).toBe("仅补充触发条件");
    expect(snapshot.skills[0].skillMd).toContain("更新后的技能正文");
  });
});
