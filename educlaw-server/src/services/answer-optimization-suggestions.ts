import { ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS } from "@educlaw/shared";

export { ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS } from "@educlaw/shared";

const MAX_SUGGESTION_LENGTH = 72;

export function normalizeAnswerOptimizationSuggestions(
  value: unknown,
): [string, string, string] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [...ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS];
  }
  const suggestions = (value as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) {
    return [...ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS];
  }
  const normalized = suggestions
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().replace(/\s+/g, " "))
    .filter((item) => item.length > 0 && item.length <= MAX_SUGGESTION_LENGTH)
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 3);
  return normalized.length === 3
    ? [normalized[0]!, normalized[1]!, normalized[2]!]
    : [...ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS];
}

export function buildAnswerOptimizationSuggestionsPrompt(input: {
  question: string;
  answer: string;
  answerVersionNumber: number;
}): { systemPrompt: string; userPrompt: string } {
  return {
    systemPrompt: [
      "你是一名教育 Skill 质量评审助手。",
      "结合教学目标、对象与情境、引导性、准确性、安全边界和结果可执行性判断当前回答值得改进的地方。",
      "返回恰好 3 条用户可以直接采用的具体改进要求，每条不超过 36 个汉字。",
      "不要输出评分、维度名称、分析过程、模型或服务端信息，不要替用户自动提交修改。",
      '只返回 JSON：{"suggestions":["...","...","..."]}',
    ].join("\n"),
    userPrompt: [
      `回答版本：v${input.answerVersionNumber}`,
      `用户任务：\n${input.question.trim()}`,
      `Skill 回答：\n${input.answer.trim()}`,
    ].join("\n\n"),
  };
}
