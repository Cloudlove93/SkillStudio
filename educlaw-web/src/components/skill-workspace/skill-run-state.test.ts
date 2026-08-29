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

  it('binds the completed answer to the exact Skill version that generated it', () => {
    let state = createSkillRunState();
    state = skillRunReducer(state, { type: 'submit', content: '设计实验' });
    state = skillRunReducer(state, { type: 'done', content: '实验步骤' });
    state = skillRunReducer(state, {
      type: 'attach-provenance',
      questionMessageId: 11,
      answerMessageId: 12,
      threadId: 7,
      baselineAnswerMessageId: null,
      skillVersionNumber: 3,
    });

    expect(state.messages[0]).toMatchObject({ messageId: 11 });
    expect(state.messages[1]).toMatchObject({
      messageId: 12,
      questionMessageId: 11,
      threadId: 7,
      skillVersionNumber: 3,
    });
  });

  it('keeps reasoning separate from the final answer and commits both on completion', () => {
    let state = createSkillRunState();
    state = skillRunReducer(state, {
      type: 'submit',
      content: '问题',
      thinkingRequested: true,
    });
    state = skillRunReducer(state, {
      type: 'thinking_status',
      requested: true,
      enabled: true,
      supported: true,
    });
    state = skillRunReducer(state, {
      type: 'reasoning_delta',
      side: 'enhanced',
      delta: '分析',
    });
    state = skillRunReducer(state, {
      type: 'delta',
      side: 'enhanced',
      delta: '答案',
    });
    state = skillRunReducer(state, {
      type: 'done',
      content: '最终答案',
      reasoningContent: '完整分析',
    });

    expect(state.messages.at(-1)).toEqual({
      role: 'assistant',
      content: '最终答案',
      reasoningContent: '完整分析',
    });
    expect(state.streaming).toBe('');
    expect(state.streamingReasoning).toBe('');
  });

  it('ignores baseline reasoning and preserves partial output on failure or stop', () => {
    const baselineIgnored = skillRunReducer(createSkillRunState(), {
      type: 'reasoning_delta',
      side: 'baseline',
      delta: '旧侧分析',
    });
    expect(baselineIgnored.streamingReasoning).toBe('');

    let state = skillRunReducer(createSkillRunState(), {
      type: 'submit',
      content: '问题',
      thinkingRequested: true,
    });
    state = skillRunReducer(state, {
      type: 'reasoning_delta',
      side: 'enhanced',
      delta: '已收到分析',
    });
    state = skillRunReducer(state, { type: 'error', message: '网络中断' });
    expect(state).toMatchObject({
      busy: false,
      streamingReasoning: '已收到分析',
      error: '网络中断',
    });

    state = skillRunReducer(state, { type: 'stop' });
    expect(state).toMatchObject({
      busy: false,
      streamingReasoning: '已收到分析',
      error: null,
      stopped: true,
    });
  });

  it('reports thinking capability fallbacks and clears temporary state on hydrate', () => {
    let state = skillRunReducer(createSkillRunState(), {
      type: 'submit',
      content: '问题',
      thinkingRequested: true,
    });
    state = skillRunReducer(state, {
      type: 'thinking_status',
      requested: true,
      enabled: false,
      supported: false,
    });
    expect(state.thinkingNotice).toBe(
      '当前模型不支持深度思考，将正常生成回答',
    );

    state = skillRunReducer(state, {
      type: 'hydrate',
      messages: [
        { role: 'assistant', content: '旧答案', reasoningContent: null },
      ],
    });
    expect(state.streamingReasoning).toBe('');
    expect(state.messages[0]?.reasoningContent).toBeNull();
    expect(state.thinkingNotice).toBeNull();
  });
});
