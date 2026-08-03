import { describe, expect, it } from 'vitest';
import { createSkillArenaState, skillArenaReducer } from './skill-arena-state';

describe('Skill Arena stream state', () => {
  it('keeps both fixed-version answers for one comparison request', () => {
    let state = createSkillArenaState();
    state = skillArenaReducer(state, { type: 'submit', content: '生成课堂活动' });
    state = skillArenaReducer(state, { type: 'delta', side: 'baseline', delta: 'v2 结果' });
    state = skillArenaReducer(state, { type: 'side_done', side: 'baseline', content: 'v2 结果' });
    state = skillArenaReducer(state, { type: 'side_done', side: 'enhanced', content: 'v3 结果' });

    expect(state.question).toBe('生成课堂活动');
    expect(state.baseline).toBe('v2 结果');
    expect(state.enhanced).toBe('v3 结果');
    expect(state.busy).toBe(false);
  });
});
