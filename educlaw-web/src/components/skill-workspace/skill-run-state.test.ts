import { describe, expect, it } from 'vitest';
import {
  createSkillRunState,
  skillRunReducer,
} from './skill-run-state';

describe('Skill run stream state', () => {
  it('collects the fixed-version enhanced response and persists completed messages', () => {
    let state = createSkillRunState();
    state = skillRunReducer(state, { type: 'submit', content: '设计一节阅读课' });
    state = skillRunReducer(state, {
      type: 'delta',
      side: 'enhanced',
      delta: '第一步',
    });
    state = skillRunReducer(state, {
      type: 'done',
      content: '第一步：明确目标',
    });

    expect(state.busy).toBe(false);
    expect(state.draft).toBe('');
    expect(state.messages).toEqual([
      { role: 'user', content: '设计一节阅读课' },
      { role: 'assistant', content: '第一步：明确目标' },
    ]);
  });

  it('ignores baseline deltas in single Skill mode and exposes errors', () => {
    let state = createSkillRunState();
    state = skillRunReducer(state, { type: 'delta', side: 'baseline', delta: '旧回答' });
    state = skillRunReducer(state, { type: 'error', message: '执行失败' });

    expect(state.streaming).toBe('');
    expect(state.error).toBe('执行失败');
    expect(state.busy).toBe(false);
  });
});
