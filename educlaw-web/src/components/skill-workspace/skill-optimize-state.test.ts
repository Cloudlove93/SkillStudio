import { describe, expect, it } from 'vitest';
import { createSkillOptimizeState, skillOptimizeReducer } from './skill-optimize-state';

describe('interactive Skill optimization state', () => {
  it('keeps the conversation and accumulates adopted changes before save', () => {
    let state = createSkillOptimizeState();
    state = skillOptimizeReducer(state, { type: 'submit', content: '让输出更具体' });
    state = skillOptimizeReducer(state, {
      type: 'reply',
      content: '建议增加可检查的成果标准。',
      adoptions: [{
        id: 'change-1',
        target: 'skill',
        targetId: 'lesson',
        original: '旧内容',
        modified: '新内容',
        reason: '更具体',
      }],
    });

    expect(state.messages).toHaveLength(2);
    expect(state.changes).toHaveLength(1);
    expect(state.busy).toBe(false);
  });

  it('clears pending changes after a new version is saved', () => {
    let state = createSkillOptimizeState();
    state = skillOptimizeReducer(state, { type: 'saved', versionNumber: 4 });

    expect(state.savedVersionNumber).toBe(4);
    expect(state.changes).toEqual([]);
  });
});
