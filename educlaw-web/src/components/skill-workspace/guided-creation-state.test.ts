import { describe, expect, it } from 'vitest';
import type { GuidedCreationSessionDetail } from '@educlaw/shared';
import {
  applyGuidedStreamEvent,
  createGuidedStreamState,
  isGuidedRunVisible,
  isGuidedFinalizationStale,
} from './guided-creation-state';

const completedSession = {
  id: '10',
  status: 'completed',
  skill_id: '22',
  skill_version_id: '33',
  package_id: '44',
  messages: [],
} as unknown as GuidedCreationSessionDetail;

describe('guided creation UI state', () => {
  it('keeps background stream events away from the selected draft', () => {
    expect(isGuidedRunVisible('draft-b', 'draft-a')).toBe(false);
    expect(isGuidedRunVisible('draft-a', 'draft-a')).toBe(true);
    expect(isGuidedRunVisible(null, null)).toBe(true);
    expect(isGuidedRunVisible(null, 'draft-a')).toBe(false);
    expect(isGuidedRunVisible(null, null, 'run-2', 'run-1')).toBe(false);
    expect(isGuidedRunVisible(null, null, 'run-2', 'run-2')).toBe(true);
  });

  it('tracks generation phase and file previews', () => {
    let state = createGuidedStreamState();
    state = applyGuidedStreamEvent(state, {
      event: 'phase',
      data: { phase: 'generating' },
    });
    state = applyGuidedStreamEvent(state, {
      event: 'preview',
      data: { files: [{ path: 'SKILL.md', content: '# Skill' }] },
    });

    expect(state.phase).toBe('generating');
    expect(state.previews).toEqual([{ path: 'SKILL.md', content: '# Skill' }]);
  });

  it('opens the Skill only when the completed session is still active', () => {
    const active = applyGuidedStreamEvent(
      { ...createGuidedStreamState(), active_session_id: '10' },
      { event: 'done', data: { session: completedSession } },
    );
    const inactive = applyGuidedStreamEvent(
      { ...createGuidedStreamState(), active_session_id: '99' },
      { event: 'done', data: { session: completedSession } },
    );

    expect(active.open_skill_id).toBe('22');
    expect(inactive.open_skill_id).toBeNull();
    expect(inactive.completed_in_background).toEqual({
      session_id: '10',
      skill_id: '22',
    });
  });

  it('keeps retryable errors inline', () => {
    const state = applyGuidedStreamEvent(createGuidedStreamState(), {
      event: 'error',
      data: { code: 'MODEL_UNAVAILABLE', message: '模型暂时不可用', retryable: true },
    });

    expect(state.error).toEqual({
      code: 'MODEL_UNAVAILABLE',
      message: '模型暂时不可用',
      retryable: true,
    });
    expect(state.busy).toBe(false);
  });

  it('marks a finalization lease stale after ten minutes', () => {
    const now = Date.parse('2026-08-03T10:20:00.000Z');
    expect(isGuidedFinalizationStale('2026-08-03T10:09:59.000Z', now)).toBe(true);
    expect(isGuidedFinalizationStale('2026-08-03T10:15:00.000Z', now)).toBe(false);
  });
});
