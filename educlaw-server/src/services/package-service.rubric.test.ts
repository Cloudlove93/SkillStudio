import { describe, expect, it } from "vitest";

import {
  buildSourceRubricExcerpt,
  hasConfiguredRubricText,
  normalizeStoredRubricMarkdown,
  sanitizeGeneratedRubricMarkdown,
  validateRubricMarkdown,
} from "./package-service.js";

describe("rubric extraction and validation", () => {
  it("prefers the actual 5、评价准则 section over earlier generic evaluation prose", () => {
    const source = [
      "### 3、问题评估",
      "- 课堂评价容易流于形式。",
      "- 新教师容易把失控归因于个人威严不足。",
      "",
      "### 4、解决方案",
      "- 双轨采集 -> 行为切片 -> 差异标注 -> 策略生成。",
      "",
      "### 5、评价准则",
      "| 维度 | 权重 | 优秀（A） | 合格（B） | 不合格（C） |",
      "|------|------|-----------|-----------|-------------|",
      "| 经验提取的系统性 | 30% | 能系统提取课堂经验 | 能提取主要经验 | 提取不完整 |",
      "| 知识显化的有效性 | 25% | 能转为可执行策略 | 有显化但不够具体 | 仍停留抽象描述 |",
    ].join("\n");

    const excerpt = buildSourceRubricExcerpt([{ name: "doc.md", content: source }]);

    expect(excerpt).toContain("5、评价准则");
    expect(excerpt).toContain("| 维度 | 权重 | 优秀（A） |");
    expect(excerpt).not.toContain("### 4、解决方案");
    expect(excerpt).not.toContain("课堂评价容易流于形式");
  });

  it("stops extraction before support-only sections like 分级描述 and 案例对比", () => {
    const source = [
      "5、评价准则",
      "维度\t权重\t优秀（A）\t合格（B）\t不合格（C）",
      "沟通策略的针对性\t30%\t准确识别家长心理防御\t基本识别问题\t建议过于通用",
      "",
      "分级描述（以汇报质量为例）：",
      "- 优秀：能解释代码逻辑",
      "",
      "6、案例对比",
      "正面案例：先让学生独立完成，再用 AI 对照。",
    ].join("\n");

    const excerpt = buildSourceRubricExcerpt([{ name: "task.docx", content: source }]);

    expect(excerpt).toContain("5、评价准则");
    expect(excerpt).toContain("沟通策略的针对性");
    expect(excerpt).not.toContain("分级描述");
    expect(excerpt).not.toContain("案例对比");
  });

  it("accepts a user rubric with one real evaluation dimension as scorable", () => {
    const rubric = [
      "5、评价准则",
      "",
      "维度\t权重\t优秀（A）\t合格（B）\t不合格（C）",
      "沟通策略的针对性\t30%\t准确识别家长心理防御机制\t基本识别问题\t建议过于通用",
    ].join("\n");

    expect(hasConfiguredRubricText(rubric)).toBe(true);
    expect(validateRubricMarkdown(rubric)).toEqual([]);
  });

  it("normalizes stored rubric content by trimming support-only tail sections", () => {
    const rubric = [
      "5、评价准则",
      "",
      "维度\t权重\t优秀（A）\t合格（B）\t不合格（C）",
      "证据呈现的有效性\t25%\t强调具体行为记录\t有证据思维\t仍依赖主观描述",
      "",
      "7、规范依据",
      "《家庭教育促进法》",
    ].join("\n");

    expect(normalizeStoredRubricMarkdown(rubric)).toBe(
      [
        "5、评价准则",
        "",
        "维度\t权重\t优秀（A）\t合格（B）\t不合格（C）",
        "证据呈现的有效性\t25%\t强调具体行为记录\t有证据思维\t仍依赖主观描述",
      ].join("\n"),
    );
  });

  it("sanitizes generated rubric into a directly scorable stored form", () => {
    const rubric = [
      "5、评价准则",
      "",
      "维度\t权重\t优秀（A）\t合格（B）\t不合格（C）",
      "学生融入与差异适配\t25%\t为基础差学生设计阶梯角色\t基本考虑学生差异\t未考虑学生差异",
      "",
      "8、测试情景",
      "情景1：课堂管理困境",
    ].join("\n");

    expect(sanitizeGeneratedRubricMarkdown(rubric)).toBe(
      [
        "5、评价准则",
        "",
        "维度\t权重\t优秀（A）\t合格（B）\t不合格（C）",
        "学生融入与差异适配\t25%\t为基础差学生设计阶梯角色\t基本考虑学生差异\t未考虑学生差异",
      ].join("\n"),
    );
  });
});
