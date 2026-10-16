import { describe, expect, it } from 'vitest';
import type { ArenaMessage, ArenaRunSnapshot } from '@educlaw/shared';
import { reconcileSkillRun } from './skill-run-recovery';

const question = {
  id: 1,
  threadId: 9,
  role: 'user',
  side: 'shared',
  content: 'question',
  createdAt: '2026-10-16',
} as ArenaMessage;
const answer = {
  ...question,
  id: 2,
  role: 'assistant',
  side: 'enhanced',
  content: 'answer',
} as ArenaMessage;
const run = {
  requestId: 'q1',
  createdAt: 1,
  updatedAt: 1,
  runId: 'r1',
  threadId: 9,
  revision: 2,
  status: 'running',
  shared: question,
  messages: [],
  content: 'partial',
  reasoningContent: 'reason',
  thinkingRequested: true,
  thinkingEnabled: true,
  thinkingSupported: true,
  error: null,
} as ArenaRunSnapshot;

describe('Skill run recovery reconciliation', () => {
  it('deduplicates saved question and completed answer by identity', () => {
    const result = reconcileSkillRun([question, answer], {
      ...run,
      status: 'succeeded',
      messages: [question, answer],
    });
    expect(result.messages.map((m) => m.messageId)).toEqual([1, 2]);
    expect(result.streaming).toBe('');
    expect(result.busy).toBe(false);
  });
  it('restores cumulative answer and reasoning without repeating the saved question', () => {
    const result = reconcileSkillRun([question], run);
    expect(result.messages).toHaveLength(1);
    expect(result.streaming).toBe('partial');
    expect(result.streamingReasoning).toBe('reason');
    expect(result.busy).toBe(true);
  });
  it('preserves failure truth and partial text', () => {
    const result = reconcileSkillRun([question], {
      ...run,
      status: 'failed',
      error: 'model failed',
    });
    expect(result.error).toBe('model failed');
    expect(result.streaming).toBe('partial');
    expect(result.busy).toBe(false);
  });
  it('canonicalizes bigint identities returned as either strings or numbers', () => {
    const result = reconcileSkillRun([question, answer], {
      ...run,
      status: 'succeeded',
      shared: { ...question, id: '1' as unknown as number },
      messages: [{ ...answer, id: '2' as unknown as number }],
    });
    expect(result.messages).toHaveLength(2);
  });
});
