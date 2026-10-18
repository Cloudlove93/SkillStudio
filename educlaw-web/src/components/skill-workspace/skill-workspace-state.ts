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
    activeView: activeView === 'test' ? 'run' : activeView,
    pinnedUpdate: null,
  };
}

export function skillWorkspaceReducer(
  state: SkillWorkspaceState,
  event: SkillWorkspaceEvent,
): SkillWorkspaceState {
  if (event.type === 'navigate') {
    const view = event.view === 'test' ? 'run' : event.view;
    if (view === 'run' || view === 'arena' || view === 'versions') {
      return {
        ...state,
        activeView: view,
        pinnedUpdate: null,
      };
    }
    return {
      ...state,
      activeView: view,
      pinnedUpdate: view === 'versions' || view === 'overview' ? null : state.pinnedUpdate,
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
