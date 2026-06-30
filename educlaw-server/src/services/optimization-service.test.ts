import { afterEach, describe, expect, it, vi } from "vitest";

const getPackageMock = vi.fn();
const applyOptimizedSnapshotMock = vi.fn();
const listVersionsMock = vi.fn();
const getThreadDetailMock = vi.fn();
const generateJsonMock = vi.fn();

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
  vi.doMock("./arena-service.js", () => ({
    getThreadDetail: getThreadDetailMock,
  }));
  vi.doMock("./llm-service.js", () => ({
    generateJson: generateJsonMock,
  }));
  return import("./optimization-service.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./package-service.js");
  vi.doUnmock("./arena-service.js");
  vi.doUnmock("./llm-service.js");
  getPackageMock.mockReset();
  applyOptimizedSnapshotMock.mockReset();
  listVersionsMock.mockReset();
  getThreadDetailMock.mockReset();
  generateJsonMock.mockReset();
});

describe("optimizePackage", () => {
  it("rejects optimization before model work when rubric is missing", async () => {
    getPackageMock.mockResolvedValue({
      snapshot: {
        name: "No Rubric Agent",
        description: "Needs manual rubric",
        agentMd: "# Agent",
        rubricMd: "",
        skills: [],
      },
    });
    getThreadDetailMock.mockResolvedValue({
      thread: { packageId: "package-1" },
      messages: [],
    });

    const { optimizePackage } = await loadService();

    await expect(optimizePackage("user-1", "package-1", "thread-1")).rejects.toThrow("还没有配置 rubric");
    expect(generateJsonMock).not.toHaveBeenCalled();
    expect(applyOptimizedSnapshotMock).not.toHaveBeenCalled();
  });
});
