import { describe, expect, it } from "vitest";
import {
  ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS,
  buildAnswerOptimizationSuggestionsPrompt,
  normalizeAnswerOptimizationSuggestions,
} from "./answer-optimization-suggestions.js";

describe("answer optimization suggestions", () => {
  it("normalizes exactly three concise suggestions", () => {
    expect(normalizeAnswerOptimizationSuggestions({
      suggestions: [
        "  先让学生表达预测，再根据回答逐步提示。 ",
        "补充实验器材的安全提醒。",
        "明确观察结果和完成标准。",
        "这一条不应展示。",
      ],
    })).toEqual([
      "先让学生表达预测，再根据回答逐步提示。",
      "补充实验器材的安全提醒。",
      "明确观察结果和完成标准。",
    ]);
  });

  it.each([
    null,
    {},
    { suggestions: [] },
    { suggestions: ["重复", "重复", "只有两条"] },
    { suggestions: ["", 1, null] },
  ])("falls back when model output is unusable", (value) => {
    expect(normalizeAnswerOptimizationSuggestions(value)).toEqual(
      ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS,
    );
  });

  it("asks the model to judge education quality without exposing scores", () => {
    const prompt = buildAnswerOptimizationSuggestionsPrompt({
      question: "设计浮力实验",
      answer: "直接给出完整实验步骤。",
      answerVersionNumber: 2,
    });

    expect(prompt.systemPrompt).toContain("教学目标");
    expect(prompt.systemPrompt).toContain("引导性");
    expect(prompt.systemPrompt).toContain("准确性");
    expect(prompt.systemPrompt).toContain("安全边界");
    expect(prompt.systemPrompt).toContain("可执行性");
    expect(prompt.systemPrompt).toContain("不要输出评分");
    expect(prompt.userPrompt).toContain("设计浮力实验");
    expect(prompt.userPrompt).toContain("直接给出完整实验步骤");
  });
});
