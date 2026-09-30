export type AnswerOptimizationSelection = {
  origin: 'run' | 'test' | 'arena';
  packageId: number;
  threadId: number;
  questionMessageId: number;
  enhancedAnswerMessageId: number;
  baselineAnswerMessageId: number | null;
  answerMessageId: number;
  answerSide: 'baseline' | 'enhanced';
  answerVersionNumber: number;
  currentPackageVersionId: number;
  question: string;
  answer: string;
  feedback: string;
};

export type AnswerOptimizationRerunRequest = {
  requestId: string;
  versionNumber: number;
  selection: AnswerOptimizationSelection;
};
