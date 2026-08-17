import { beforeEach, describe, expect, it, vi } from "vitest";

const getRunMock = vi.fn();
const getThreadMock = vi.fn();
const generateJsonMock = vi.fn();

vi.mock("./arena-service.js", () => ({
  getArenaAnswerRunByMessage: getRunMock,
  getArenaThreadDetail: getThreadMock,
}));
vi.mock("./llm-service.js", () => ({ generateJson: generateJsonMock }));

const input = {
  userId: "user-1",
  packageId: 123,
  threadId: 456,
  questionMessageId: 1001,
  answerMessageId: 1002,
  answerSide: "enhanced" as const,
  answerVersionNumber: 2,
};

beforeEach(() => {
  getRunMock.mockReset().mockResolvedValue({
    userId: "user-1",
    packageId: 123,
    threadId: 456,
    questionMessageId: 1001,
    enhancedAnswerMessageId: 1002,
    baselineAnswerMessageId: null,
  });
  getThreadMock.mockReset().mockResolvedValue({
    messages: [
      { id: 1001, role: "user", side: "shared", content: "设计浮力实验" },
      { id: 1002, role: "assistant", side: "enhanced", content: "完整实验步骤" },
    ],
  });
  generateJsonMock.mockReset().mockResolvedValue({
    suggestions: ["先询问学生的预测", "补充安全提示", "明确观察记录"],
  });
});

describe("suggestAnswerOptimizationFeedback", () => {
  it("loads trusted messages and returns AI suggestions", async () => {
    const { suggestAnswerOptimizationFeedback } = await import(
      "./answer-optimization-suggestion-service.js"
    );
    await expect(suggestAnswerOptimizationFeedback(input)).resolves.toEqual({
      suggestions: ["先询问学生的预测", "补充安全提示", "明确观察记录"],
      source: "ai",
    });
    expect(generateJsonMock).toHaveBeenCalledOnce();
  });

  it("rejects IDs that do not match the recorded answer run", async () => {
    const { AnswerOptimizationSuggestionNotFoundError, suggestAnswerOptimizationFeedback } = await import(
      "./answer-optimization-suggestion-service.js"
    );
    getRunMock.mockResolvedValueOnce({
      userId: "user-1",
      packageId: 999,
      threadId: 456,
      questionMessageId: 1001,
      enhancedAnswerMessageId: 1002,
      baselineAnswerMessageId: null,
    });
    await expect(suggestAnswerOptimizationFeedback(input)).rejects.toBeInstanceOf(
      AnswerOptimizationSuggestionNotFoundError,
    );
    expect(generateJsonMock).not.toHaveBeenCalled();
  });

  it("returns fallback suggestions when the model fails", async () => {
    const { suggestAnswerOptimizationFeedback } = await import(
      "./answer-optimization-suggestion-service.js"
    );
    generateJsonMock.mockRejectedValueOnce(new Error("model unavailable"));
    const result = await suggestAnswerOptimizationFeedback(input);
    expect(result.source).toBe("fallback");
    expect(result.suggestions).toHaveLength(3);
  });
});
