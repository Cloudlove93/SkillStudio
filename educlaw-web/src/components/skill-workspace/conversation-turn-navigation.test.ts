import { describe, expect, it } from 'vitest';
import {
  collectConversationTurns,
  findActiveConversationTurn,
} from './conversation-turn-navigation';

describe('conversation turn navigation', () => {
  it('creates navigation turns only for user messages', () => {
    expect(collectConversationTurns([
      { id: 'assistant-1', role: 'assistant', content: '先说说你的目标。' },
      { id: 'user-1', role: 'user', content: '我想设计浮力实验。' },
      { id: 'assistant-2', role: 'assistant', content: '主要在什么时候使用？' },
      { id: 'user-2', role: 'user', content: '学生实验过程中。' },
    ])).toEqual([
      { id: 'guided-turn-user-1', label: '我想设计浮力实验。' },
      { id: 'guided-turn-user-2', label: '学生实验过程中。' },
    ]);
  });

  it('uses the latest turn above the reading threshold as active', () => {
    expect(findActiveConversationTurn([24, 280, 640], 240, 400)).toBe(1);
    expect(findActiveConversationTurn([24, 280, 640], 610, 400)).toBe(2);
    expect(findActiveConversationTurn([], 0, 400)).toBe(-1);
  });
});
