type ReportMessageLike = {
  side: 'shared' | 'baseline' | 'enhanced';
  role: 'user' | 'assistant';
};

export type ReportReadinessReason =
  | 'missing_rubric'
  | 'missing_messages'
  | null;

export function canOpenReportAction(
  hasThread: boolean,
  hasRubricContent: boolean,
): boolean {
  void hasRubricContent;
  return hasThread;
}

export function getReportReadiness(
  messages: ReportMessageLike[],
  hasRubricContent: boolean,
): { canGenerateReport: boolean; reason: ReportReadinessReason } {
  if (!hasRubricContent) {
    return { canGenerateReport: false, reason: 'missing_rubric' };
  }

  const hasUserMessage = messages.some(
    (message) => message.side === 'shared' && message.role === 'user',
  );
  const hasBaselineReply = messages.some(
    (message) => message.side === 'baseline' && message.role === 'assistant',
  );
  const hasEnhancedReply = messages.some(
    (message) => message.side === 'enhanced' && message.role === 'assistant',
  );

  if (!hasUserMessage || !hasBaselineReply || !hasEnhancedReply) {
    return { canGenerateReport: false, reason: 'missing_messages' };
  }

  return { canGenerateReport: true, reason: null };
}
