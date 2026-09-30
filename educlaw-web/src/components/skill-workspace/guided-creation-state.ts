import type { GuidedCreationSessionDetail } from '@educlaw/shared';
import type { GuidedCreationSseEvent } from '../../api/lite-api';

export interface GuidedStreamState {
  phase: string | null;
  previews: Array<{ path: string; content: string }>;
  busy: boolean;
  error: { code: string; message: string; retryable: boolean } | null;
  active_session_id: string | null;
  session: GuidedCreationSessionDetail | null;
  open_skill_id: string | null;
  completed_in_background: {
    session_id: string;
    skill_id: string;
  } | null;
}

export function createGuidedStreamState(): GuidedStreamState {
  return {
    phase: null,
    previews: [],
    busy: true,
    error: null,
    active_session_id: null,
    session: null,
    open_skill_id: null,
    completed_in_background: null,
  };
}

export function isGuidedRunVisible(
  selectedSessionId: string | null,
  runSessionId: string | null,
  activeRunId?: string,
  runId?: string,
): boolean {
  const isCurrentRun = !runId || activeRunId === runId;
  return isCurrentRun && selectedSessionId === runSessionId;
}

export function isGuidedFinalizationStale(
  updatedAt: string,
  now = Date.now(),
): boolean {
  return now - new Date(updatedAt).getTime() >= 10 * 60 * 1_000;
}

export function applyGuidedStreamEvent(
  state: GuidedStreamState,
  event: GuidedCreationSseEvent,
): GuidedStreamState {
  if (event.event === 'phase') {
    return { ...state, phase: event.data.phase, busy: true, error: null };
  }
  if (event.event === 'preview') {
    const previews = [...state.previews];
    for (const file of event.data.files) {
      const index = previews.findIndex((preview) => preview.path === file.path);
      if (index >= 0) previews[index] = file;
      else previews.push(file);
    }
    return { ...state, previews };
  }
  if (event.event === 'confirmation') {
    return {
      ...state,
      session: event.data.session,
      active_session_id: event.data.session.id,
    };
  }
  if (event.event === 'done') {
    const session = event.data.session;
    const completed = session.status === 'completed' && session.skill_id;
    const isStillActive =
      state.active_session_id === null || state.active_session_id === session.id;
    return {
      ...state,
      session,
      busy: false,
      phase: null,
      open_skill_id: completed && isStillActive ? session.skill_id : null,
      completed_in_background:
        completed && !isStillActive
          ? { session_id: session.id, skill_id: session.skill_id! }
          : null,
    };
  }
  if (event.event === 'error') {
    return { ...state, error: event.data, busy: false, phase: null };
  }
  return state;
}
