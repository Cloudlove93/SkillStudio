import { describe, expect, it } from 'vitest';
import {
  ADOPTION_SUCCESS_REPLY,
  createSkillOptimizeState,
  resolveSkillOptimizeReply,
  skillOptimizeReducer,
} from './skill-optimize-state';

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

  it('keeps a valid draft after an operation fails and resets it for a new Skill', () => {
    let state = createSkillOptimizeState();
    state = skillOptimizeReducer(state, {
      type: 'reply',
      content: '草稿已生成。',
      adoptions: [
        {
          id: 'change-1',
          target: 'skill',
          targetId: 'lesson',
          original: '旧内容',
          modified: '新内容',
          reason: '补充步骤',
        },
      ],
    });
    state = skillOptimizeReducer(state, {
      type: 'error',
      message: '保存失败',
    });

    expect(state.changes).toHaveLength(1);
    expect(state.error).toBe('保存失败');

    state = skillOptimizeReducer(state, { type: 'reset' });
    expect(state).toEqual(createSkillOptimizeState());
  });

  it('uses a controlled confirmation only for a real changed Skill draft', () => {
    const adoption = {
      id: 'change-1',
      target: 'skill' as const,
      targetId: 'lesson',
      original: '旧内容',
      modified: '新内容',
      reason: '补充步骤',
    };

    expect(resolveSkillOptimizeReply('', [adoption])).toBe(
      ADOPTION_SUCCESS_REPLY,
    );
    expect(resolveSkillOptimizeReply('后端自然语言回复', [adoption])).toBe(
      '后端自然语言回复',
    );
  });

  it('rejects empty replies without a valid draft and never appends blank messages', () => {
    expect(() => resolveSkillOptimizeReply('', [])).toThrow(
      '没有生成可用的回复或有效修改草稿',
    );
    expect(() =>
      resolveSkillOptimizeReply('', [
        {
          id: 'change-1',
          target: 'skill',
          targetId: 'lesson',
          original: '相同内容',
          modified: '相同内容',
          reason: '无效修改',
        },
      ]),
    ).toThrow('没有生成可用的回复或有效修改草稿');

    const state = skillOptimizeReducer(createSkillOptimizeState(), {
      type: 'reply',
      content: '   ',
      adoptions: [],
    });
    expect(state.messages).toEqual([]);
  });
});
