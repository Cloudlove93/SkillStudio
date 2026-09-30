import type {
  AnswerOptimizationSuggestionsRequest,
  AnswerOptimizationSuggestionsResult,
} from "@educlaw/shared";
import {
  getArenaAnswerRunByMessage,
  getArenaThreadDetail,
} from "./arena-service.js";
import { generateJson } from "./llm-service.js";
import {
  ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS,
  buildAnswerOptimizationSuggestionsPrompt,
  normalizeAnswerOptimizationSuggestions,
} from "./answer-optimization-suggestions.js";

export class AnswerOptimizationSuggestionNotFoundError extends Error {
  constructor() {
    super("Answer context not found");
    this.name = "AnswerOptimizationSuggestionNotFoundError";
  }
}

export interface SuggestAnswerOptimizationFeedbackInput
  extends AnswerOptimizationSuggestionsRequest {
  userId: string;
}

export async function suggestAnswerOptimizationFeedback(
  input: SuggestAnswerOptimizationFeedbackInput,
): Promise<AnswerOptimizationSuggestionsResult> {
  const run = await getArenaAnswerRunByMessage(input.userId, input.answerMessageId)
    .catch(() => {
      throw new AnswerOptimizationSuggestionNotFoundError();
    });
  const expectedAnswerId = input.answerSide === "baseline"
    ? run.baselineAnswerMessageId
    : run.enhancedAnswerMessageId;
  if (
    run.userId !== input.userId ||
    run.packageId !== input.packageId ||
    run.threadId !== input.threadId ||
    run.questionMessageId !== input.questionMessageId ||
    expectedAnswerId !== input.answerMessageId
  ) {
    throw new AnswerOptimizationSuggestionNotFoundError();
  }

  const thread = await getArenaThreadDetail({
    authUserId: input.userId,
    packageId: String(input.packageId),
    threadId: String(input.threadId),
  }).catch(() => {
    throw new AnswerOptimizationSuggestionNotFoundError();
  });
  const question = thread.messages.find((message) => message.id === input.questionMessageId);
  const answer = thread.messages.find((message) => message.id === input.answerMessageId);
  if (
    !question || question.role !== "user" ||
    !answer || answer.role !== "assistant" ||
    answer.side !== input.answerSide
  ) {
    throw new AnswerOptimizationSuggestionNotFoundError();
  }

  const prompt = buildAnswerOptimizationSuggestionsPrompt({
    question: question.content,
    answer: answer.content,
    answerVersionNumber: input.answerVersionNumber,
  });
  try {
    const raw = await generateJson<unknown>({
      ...prompt,
      temperature: 0.2,
      maxTokens: 900,
    }, 0, false);
    const suggestions = normalizeAnswerOptimizationSuggestions(raw);
    const source = suggestions.every(
      (suggestion, index) => suggestion === ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS[index],
    ) ? "fallback" : "ai";
    return { suggestions, source };
  } catch {
    return {
      suggestions: [...ANSWER_OPTIMIZATION_SUGGESTION_FALLBACKS],
      source: "fallback",
    };
  }
}
