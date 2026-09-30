import { afterEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const generateJsonMock = vi.fn();
const getPackageMock = vi.fn();
const getPackageWithVersionIdMock = vi.fn();

async function loadService() {
  vi.resetModules();

  vi.doMock("./db.js", () => ({
    newId: () => "id-1",
    query: queryMock,
  }));

  vi.doMock("./llm-service.js", () => ({
    generateJson: generateJsonMock,
    resolveBaselineModel: vi.fn(),
    streamText: vi.fn(),
  }));

  vi.doMock("./package-service.js", () => ({
    getPackage: getPackageMock,
    getPackageWithVersionId: getPackageWithVersionIdMock,
    assertRubricConfigured: (rubricMd: string | undefined | null, feature: string) => {
      if (!String(rubricMd || "").trim()) {
        throw new Error(`当前智能体还没有配置 rubric。请先在 Rubric 标签中补充评分规则后再使用${feature}。`);
      }
    },
  }));

  return import("./arena-service.js");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("./db.js");
  vi.doUnmock("./llm-service.js");
  vi.doUnmock("./package-service.js");
  queryMock.mockReset();
  generateJsonMock.mockReset();
  getPackageMock.mockReset();
  getPackageWithVersionIdMock.mockReset();
});

describe("generateReport", () => {
  it("rejects report generation when rubric is missing", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select * from arena_threads where id = $1 and user_id = $2")) {
        return {
          rows: [
            {
              id: 1,
              user_id: "user-1",
              package_id: "package-1",
              title: "Arena Thread",
              model: null,
              created_at: "2026-06-27T00:00:00.000Z",
              updated_at: "2026-06-27T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1 and user_id = $2")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });
    getPackageWithVersionIdMock.mockResolvedValue({
      versionId: 1,
      package: {
      id: "package-1",
      snapshot: {
        name: "No Rubric Agent",
        rubricMd: "",
      },
      },
    });

    const { generateReport } = await loadService();

    await expect(generateReport("user-1", "1")).rejects.toThrow("还没有配置 rubric");
    expect(generateJsonMock).not.toHaveBeenCalled();
  });

  it("fills missing summaries and recommendation with readable fallbacks", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.startsWith("select * from arena_threads where id = $1 and user_id = $2")) {
        return {
          rows: [
            {
              id: 1,
              user_id: "user-1",
              package_id: "package-1",
              title: "Arena Thread",
              model: null,
              created_at: "2026-06-27T00:00:00.000Z",
              updated_at: "2026-06-27T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes("from arena_messages") && sql.includes("where thread_id = $1 and user_id = $2")) {
        return {
          rows: [
            {
              id: 1,
              thread_id: "1",
              user_id: "user-1",
              side: "shared",
              role: "user",
              content: "请帮我给出一个中职家校冲突处置方案。",
              created_at: "2026-06-27T00:00:01.000Z",
            },
            {
              id: 2,
              thread_id: "1",
              user_id: "user-1",
              side: "baseline",
              role: "assistant",
              content: "给出了一些通用建议，但比较泛。",
              created_at: "2026-06-27T00:00:02.000Z",
            },
            {
              id: 3,
              thread_id: "1",
              user_id: "user-1",
              side: "enhanced",
              role: "assistant",
              content: "给出了风险分级、话术模板和升级路径。",
              created_at: "2026-06-27T00:00:03.000Z",
            },
          ],
          rowCount: 3,
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    });

    getPackageWithVersionIdMock.mockResolvedValue({
      versionId: 1,
      package: {
      id: "package-1",
      snapshot: {
        name: "中职家校冲突处置顾问",
        rubricMd: "中职家校冲突处置顾问 - 评估量表",
      },
      },
    });

    generateJsonMock.mockResolvedValue({
      baseline: {
        total: 18,
        dimensions: [
          {
            key: "risk",
            name: "风险识别",
            score: 6,
            maxScore: 10,
            reason: "提到了冲突风险，但升级路径仍比较笼统。",
          },
          {
            key: "script",
            name: "话术可用性",
            score: 3,
            maxScore: 10,
            reason: "",
          },
        ],
      },
      enhanced: {
        total: 32,
        dimensions: [
          {
            key: "risk",
            name: "风险识别",
            score: 9,
            maxScore: 10,
            reason: "明确区分红色风险和常规冲突，升级路径清楚。",
          },
          {
            key: "script",
            name: "话术可用性",
            score: 8,
            maxScore: 10,
            reason: "给出了教师可以直接复用的话术模板。",
          },
        ],
      },
      winningSide: "enhanced",
    });

    const { generateReport } = await loadService();
    const report = await generateReport("user-1", "1");

    expect(report.baseline.summary).toContain("Baseline当前总分为 18.00");
    expect(report.enhanced.summary).toContain("中职家校冲突处置顾问当前总分为 32.00");
    expect(report.recommendation).toContain("这次更推荐 中职家校冲突处置顾问");
    expect(report.recommendation).toContain("下一步最值得优先改进的方向");
    expect(report.baseline.dimensions[1]?.reason).toBe("");
  });
});
