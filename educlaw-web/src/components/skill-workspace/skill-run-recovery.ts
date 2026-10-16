import type { ArenaMessage, ArenaRunSnapshot } from '@educlaw/shared';
import {
  createSkillRunState,
  type SkillRunState,
  type SkillRunMessage,
} from './skill-run-state';

export function isArenaRunActive(run: ArenaRunSnapshot) {
  return run.status === 'running' || run.status === 'stopping';
}

/** Merge persisted history and a cumulative snapshot using database identities. */
export function reconcileSkillRun(
  history: ArenaMessage[],
  run: ArenaRunSnapshot | null,
  versionNumber?: number,
): SkillRunState {
  const byId = new Map(history.map((message) => [String(message.id), message]));
  if (run?.shared) byId.set(String(run.shared.id), run.shared);
  for (const message of run?.messages ?? [])
    byId.set(String(message.id), message);
  const sorted = [...byId.values()].sort((a, b) => a.id - b.id);
  const messages: SkillRunMessage[] = [];
  let questionId: number | undefined;
  let baselineId: number | null = null;
  for (const message of sorted) {
    if (message.side === 'shared' && message.role === 'user') {
      questionId = message.id;
      baselineId = null;
      messages.push({
        role: 'user',
        content: message.content,
        messageId: message.id,
      });
    } else if (message.side === 'baseline' && message.role === 'assistant') {
      baselineId = message.id;
    } else if (message.side === 'enhanced' && message.role === 'assistant') {
      messages.push({
        role: 'assistant',
        content: message.content,
        reasoningContent: message.reasoningContent,
        messageId: message.id,
        questionMessageId: questionId,
        threadId: message.threadId,
        enhancedAnswerMessageId: message.id,
        baselineAnswerMessageId: baselineId,
        skillVersionNumber: message.skillVersionNumber ?? versionNumber,
      });
    }
  }
  const state = { ...createSkillRunState(), messages };
  if (!run) return state;
  const savedAnswer = run.messages.some(
    (message) => message.side === 'enhanced' && message.role === 'assistant',
  );
  return {
    ...state,
    busy: isArenaRunActive(run),
    streaming: savedAnswer ? '' : run.content,
    streamingReasoning: savedAnswer ? '' : run.reasoningContent,
    thinkingRequested: run.thinkingRequested,
    thinkingEnabled: run.thinkingEnabled,
    thinkingSupported: run.thinkingSupported,
    thinkingNotice:
      run.thinkingRequested && run.thinkingSupported === false
        ? '当前模型不支持深度思考，将正常生成回答'
        : null,
    stopped: run.status === 'cancelled',
    error: run.status === 'failed' ? run.error || 'Skill 执行失败' : null,
  };
}
