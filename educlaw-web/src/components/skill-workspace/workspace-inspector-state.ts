export type InspectorOwner =
  | 'workspace'
  | 'guided'
  | 'document'
  | 'structured'
  | 'multimodal'
  | 'repository'
  | 'skill';

export type InspectorView =
  | 'summary'
  | 'versions'
  | 'optimization'
  | 'document-materials'
  | 'structured-summary'
  | 'repository-selection'
  | 'multimodal-progress'
  | 'multimodal-transcript'
  | 'multimodal-evidence'
  | 'multimodal-diagnostics'
  | 'multimodal-overview'
  | 'multimodal-candidate'
  | 'multimodal-skill';

export type InspectorDescriptor = {
  owner: InspectorOwner;
  view: InspectorView;
  title: string;
  description?: string;
  itemId?: string;
  preferredWidth?: number;
};

export type WorkspaceInspectorState = {
  open: boolean;
  descriptor: InspectorDescriptor | null;
  dirty: boolean;
  fullscreen: boolean;
};

export type WorkspaceInspectorEvent =
  | { type: 'open'; descriptor: InspectorDescriptor }
  | { type: 'close' }
  | { type: 'set-dirty'; dirty: boolean }
  | { type: 'toggle-fullscreen' }
  | { type: 'clear-owner'; owner: InspectorOwner };

const INSPECTOR_DEFINITIONS: readonly InspectorDescriptor[] = [
  { owner: 'workspace', view: 'summary', title: '当前任务' },
  { owner: 'guided', view: 'summary', title: '需求摘要' },
  { owner: 'document', view: 'document-materials', title: '文档与生成状态' },
  { owner: 'structured', view: 'structured-summary', title: '填写摘要' },
  { owner: 'repository', view: 'repository-selection', title: '仓库选择' },
  { owner: 'skill', view: 'summary', title: '当前 Skill' },
  { owner: 'skill', view: 'versions', title: '最近版本' },
  { owner: 'skill', view: 'optimization', title: '改进这条回答' },
  { owner: 'multimodal', view: 'multimodal-progress', title: '处理状态' },
  { owner: 'multimodal', view: 'multimodal-transcript', title: '完整转录' },
  { owner: 'multimodal', view: 'multimodal-evidence', title: '证据库' },
  { owner: 'multimodal', view: 'multimodal-diagnostics', title: '处理诊断' },
  { owner: 'multimodal', view: 'multimodal-overview', title: '内容概览' },
  { owner: 'multimodal', view: 'multimodal-candidate', title: '编辑候选' },
  { owner: 'multimodal', view: 'multimodal-skill', title: 'Skill 内容' },
];

export function createWorkspaceInspectorState(): WorkspaceInspectorState {
  return {
    open: false,
    descriptor: null,
    dirty: false,
    fullscreen: false,
  };
}

export function workspaceInspectorReducer(
  state: WorkspaceInspectorState,
  event: WorkspaceInspectorEvent,
): WorkspaceInspectorState {
  if (event.type === 'open') {
    const sameTarget =
      state.descriptor?.owner === event.descriptor.owner &&
      state.descriptor.view === event.descriptor.view &&
      state.descriptor.itemId === event.descriptor.itemId;
    return {
      open: true,
      descriptor: event.descriptor,
      dirty: sameTarget ? state.dirty : false,
      fullscreen: sameTarget ? state.fullscreen : false,
    };
  }
  if (event.type === 'set-dirty') {
    return state.open ? { ...state, dirty: event.dirty } : state;
  }
  if (event.type === 'toggle-fullscreen') {
    return state.open ? { ...state, fullscreen: !state.fullscreen } : state;
  }
  if (event.type === 'clear-owner' && state.descriptor?.owner !== event.owner) {
    return state;
  }
  return createWorkspaceInspectorState();
}

export function requiresInspectorCloseConfirmation(
  state: WorkspaceInspectorState,
) {
  return state.open && state.dirty;
}

export function parseInspectorSearch(
  search: string,
): InspectorDescriptor | null {
  const params = new URLSearchParams(trimQuestionMark(search));
  const target = params.get('inspector');
  if (!target) return null;
  const separator = target.indexOf(':');
  if (separator <= 0) return null;
  const owner = target.slice(0, separator);
  const view = target.slice(separator + 1);
  const definition = INSPECTOR_DEFINITIONS.find(
    (item) => item.owner === owner && item.view === view,
  );
  if (!definition) return null;
  const itemId = params.get('inspectorItem')?.trim();
  return itemId ? { ...definition, itemId } : { ...definition };
}

export function writeInspectorSearch(
  search: string,
  descriptor: InspectorDescriptor | null,
) {
  const params = new URLSearchParams(trimQuestionMark(search));
  if (descriptor) {
    params.set('inspector', `${descriptor.owner}:${descriptor.view}`);
    if (descriptor.itemId) params.set('inspectorItem', descriptor.itemId);
    else params.delete('inspectorItem');
  } else {
    params.delete('inspector');
    params.delete('inspectorItem');
  }
  const value = params.toString();
  return value ? `?${value}` : '';
}

function trimQuestionMark(search: string) {
  return search.startsWith('?') ? search.slice(1) : search;
}
