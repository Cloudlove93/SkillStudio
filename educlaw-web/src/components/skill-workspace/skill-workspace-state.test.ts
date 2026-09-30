import { describe, expect, it } from 'vitest';
import {
  createSkillWorkspaceState,
  skillWorkspaceReducer,
  type SkillPinnedUpdate,
} from './skill-workspace-state';

const comparisonUpdate: SkillPinnedUpdate = {
  id: 'comparison-ready',
  title: '版本对比已完成',
  message: 'v3 在课堂可执行性方面领先 v2。',
  actionLabel: '查看对比摘要',
};

describe('Skill workspace navigation state', () => {
  it('starts on creation without a pinned update', () => {
    const state = createSkillWorkspaceState();

    expect(state.activeView).toBe('create');
    expect(state.pinnedUpdate).toBeNull();
  });

  it('navigates independently of supporting inspector content', () => {
    const state = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'navigate',
      view: 'optimize',
    });

    expect(state.activeView).toBe('optimize');
    expect(state.pinnedUpdate).toBeNull();
  });

  it('pins new information without owning presentation state', () => {
    const state = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'publish-update',
      update: comparisonUpdate,
    });

    expect(state.pinnedUpdate).toEqual(comparisonUpdate);
  });

  it('dismisses a pinned update', () => {
    const opened = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'publish-update',
      update: comparisonUpdate,
    });
    const dismissed = skillWorkspaceReducer(opened, { type: 'dismiss-update' });

    expect(dismissed.pinnedUpdate).toBeNull();
  });

  it('supports direct Skill run and Arena destinations', () => {
    const optimizing = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'navigate',
      view: 'optimize',
    });
    const running = skillWorkspaceReducer(optimizing, {
      type: 'navigate',
      view: 'run',
    });
    const arena = skillWorkspaceReducer(running, {
      type: 'navigate',
      view: 'arena',
    });

    expect(running.activeView).toBe('run');
    expect(running.pinnedUpdate).toBeNull();
    expect(arena.activeView).toBe('arena');
  });
});
