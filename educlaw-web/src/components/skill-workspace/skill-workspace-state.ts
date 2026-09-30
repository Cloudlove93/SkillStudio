export type SkillWorkspaceView =
  | 'create'
  | 'repository'
  | 'overview'
  | 'run'
  | 'test'
  | 'arena'
  | 'optimize'
  | 'versions'
  | 'report';

export interface SkillPinnedUpdate {
  id: string;
  title: string;
  message: string;
  actionLabel?: string;
}

export interface SkillWorkspaceState {
  activeView: SkillWorkspaceView;
  pinnedUpdate: SkillPinnedUpdate | null;
}

export type SkillWorkspaceEvent =
  | { type: 'navigate'; view: SkillWorkspaceView }
  | { type: 'publish-update'; update: SkillPinnedUpdate }
  | { type: 'dismiss-update' };

export function createSkillWorkspaceState(
  activeView: SkillWorkspaceView = 'create',
): SkillWorkspaceState {
  return {
    activeView,
    pinnedUpdate: null,
  };
}

export function skillWorkspaceReducer(
  state: SkillWorkspaceState,
  event: SkillWorkspaceEvent,
): SkillWorkspaceState {
  if (event.type === 'navigate') {
    if (event.view === 'run' || event.view === 'test' || event.view === 'arena' || event.view === 'versions') {
      return {
        ...state,
        activeView: event.view,
        pinnedUpdate: null,
      };
    }
    return {
      ...state,
      activeView: event.view,
      pinnedUpdate: event.view === 'versions' || event.view === 'overview' ? null : state.pinnedUpdate,
    };
  }
  if (event.type === 'publish-update') {
    return {
      ...state,
      pinnedUpdate: event.update,
    };
  }
  return { ...state, pinnedUpdate: null };
}
