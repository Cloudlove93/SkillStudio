type ReportMessageLike = {
  side: 'shared' | 'baseline' | 'enhanced';
  role: 'user' | 'assistant';
};

export type ReportReadinessReason =
  | 'missing_rubric'
  | 'missing_messages'
  | 'generating_reply'
  | null;

export function canOpenReportAction(
  hasThread: boolean,
  canGenerateReport: boolean,
): boolean {
  return hasThread && canGenerateReport;
}

export function getReportReadiness(
  messages: ReportMessageLike[],
  hasRubricContent: boolean,
  replyGenerating = false,
): { canGenerateReport: boolean; reason: ReportReadinessReason } {
  if (!hasRubricContent) {
    return { canGenerateReport: false, reason: 'missing_rubric' };
  }

  if (replyGenerating) {
    return { canGenerateReport: false, reason: 'generating_reply' };
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
