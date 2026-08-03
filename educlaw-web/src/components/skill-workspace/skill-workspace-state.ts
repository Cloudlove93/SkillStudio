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

export type SkillContextView = 'summary' | 'versions';

export interface SkillPinnedUpdate {
  id: string;
  title: string;
  message: string;
  actionLabel?: string;
}

export interface SkillWorkspaceState {
  activeView: SkillWorkspaceView;
  contextOpen: boolean;
  contextView: SkillContextView;
  pinnedUpdate: SkillPinnedUpdate | null;
}

export type SkillWorkspaceEvent =
  | { type: 'navigate'; view: SkillWorkspaceView }
  | { type: 'open-context'; view: SkillContextView }
  | { type: 'close-context' }
  | {
      type: 'publish-update';
      update: SkillPinnedUpdate;
      contextView?: SkillContextView;
      autoOpen?: boolean;
    }
  | { type: 'dismiss-update' };

const optimizationUpdate: SkillPinnedUpdate = {
  id: 'optimization-draft',
  title: '优化草案有新修改',
  message: '新的修改会先暂存，保存后再生成 Skill 新版本。',
  actionLabel: '查看右侧修改',
};

export function createSkillWorkspaceState(): SkillWorkspaceState {
  return {
    activeView: 'create',
    contextOpen: false,
    contextView: 'summary',
    pinnedUpdate: null,
  };
}

export function skillWorkspaceReducer(
  state: SkillWorkspaceState,
  event: SkillWorkspaceEvent,
): SkillWorkspaceState {
  if (event.type === 'navigate') {
    if (event.view === 'optimize') {
      return {
        ...state,
        activeView: event.view,
        contextOpen: true,
        contextView: 'summary',
        pinnedUpdate: optimizationUpdate,
      };
    }
    if (event.view === 'run' || event.view === 'test' || event.view === 'arena' || event.view === 'versions') {
      return {
        ...state,
        activeView: event.view,
        contextOpen: false,
        pinnedUpdate: null,
      };
    }
    return {
      ...state,
      activeView: event.view,
      pinnedUpdate: event.view === 'versions' || event.view === 'overview' ? null : state.pinnedUpdate,
    };
  }
  if (event.type === 'open-context') {
    return { ...state, contextOpen: true, contextView: event.view };
  }
  if (event.type === 'close-context') {
    return { ...state, contextOpen: false };
  }
  if (event.type === 'publish-update') {
    return {
      ...state,
      pinnedUpdate: event.update,
      contextOpen: event.autoOpen ? true : state.contextOpen,
      contextView: event.contextView ?? state.contextView,
    };
  }
  return { ...state, pinnedUpdate: null };
}
