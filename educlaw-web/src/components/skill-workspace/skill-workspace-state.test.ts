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

describe('Skill workspace layout state', () => {
  it('starts with the fixed right sidebar closed', () => {
    const state = createSkillWorkspaceState();

    expect(state.contextOpen).toBe(false);
    expect(state.contextView).toBe('summary');
    expect(state.pinnedUpdate).toBeNull();
  });

  it('opens and closes a selected right-sidebar view manually', () => {
    const opened = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'open-context',
      view: 'versions',
    });
    const closed = skillWorkspaceReducer(opened, { type: 'close-context' });

    expect(opened.contextOpen).toBe(true);
    expect(opened.contextView).toBe('versions');
    expect(closed.contextOpen).toBe(false);
    expect(closed.contextView).toBe('versions');
  });

  it('automatically opens supporting information for optimization without a layout-shifting banner', () => {
    const state = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'navigate',
      view: 'optimize',
    });

    expect(state.activeView).toBe('optimize');
    expect(state.contextOpen).toBe(true);
    expect(state.contextView).toBe('summary');
    expect(state.pinnedUpdate).toBeNull();
  });

  it('pins new information and opens its supporting sidebar', () => {
    const state = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'publish-update',
      update: comparisonUpdate,
      contextView: 'summary',
      autoOpen: true,
    });

    expect(state.contextOpen).toBe(true);
    expect(state.pinnedUpdate).toEqual(comparisonUpdate);
  });

  it('dismisses a pinned update without unexpectedly closing the sidebar', () => {
    const opened = skillWorkspaceReducer(createSkillWorkspaceState(), {
      type: 'publish-update',
      update: comparisonUpdate,
      contextView: 'summary',
      autoOpen: true,
    });
    const dismissed = skillWorkspaceReducer(opened, { type: 'dismiss-update' });

    expect(dismissed.pinnedUpdate).toBeNull();
    expect(dismissed.contextOpen).toBe(true);
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
    expect(running.contextOpen).toBe(false);
    expect(running.pinnedUpdate).toBeNull();
    expect(arena.activeView).toBe('arena');
  });
});
