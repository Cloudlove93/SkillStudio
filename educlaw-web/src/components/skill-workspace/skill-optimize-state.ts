import type { AdoptedChange, InteractiveOptimizationMessage } from '../../api/lite-api';

export type SkillOptimizeState = {
  draft: string;
  messages: InteractiveOptimizationMessage[];
  changes: AdoptedChange[];
  busy: boolean;
  saving: boolean;
  error: string | null;
  savedVersionNumber: number | null;
};

export type SkillOptimizeEvent =
  | { type: 'draft'; value: string }
  | { type: 'initialize'; content: string }
  | { type: 'submit'; content: string }
  | { type: 'reply'; content: string; adoptions: AdoptedChange[] }
  | { type: 'saving' }
  | { type: 'saved'; versionNumber: number }
  | { type: 'error'; message: string };

export function createSkillOptimizeState(): SkillOptimizeState {
  return {
    draft: '',
    messages: [],
    changes: [],
    busy: false,
    saving: false,
    error: null,
    savedVersionNumber: null,
  };
}

export function skillOptimizeReducer(
  state: SkillOptimizeState,
  event: SkillOptimizeEvent,
): SkillOptimizeState {
  if (event.type === 'draft') return { ...state, draft: event.value };
  if (event.type === 'initialize') {
    return {
      ...state,
      messages: [{ role: 'assistant', content: event.content }],
      busy: false,
      error: null,
    };
  }
  if (event.type === 'submit') {
    return {
      ...state,
      draft: '',
      messages: [...state.messages, { role: 'user', content: event.content }],
      busy: true,
      error: null,
      savedVersionNumber: null,
    };
  }
  if (event.type === 'reply') {
    return {
      ...state,
      messages: [...state.messages, { role: 'assistant', content: event.content }],
      changes: [...state.changes, ...event.adoptions],
      busy: false,
      error: null,
    };
  }
  if (event.type === 'saving') return { ...state, saving: true, error: null };
  if (event.type === 'saved') {
    return {
      ...state,
      changes: [],
      saving: false,
      savedVersionNumber: event.versionNumber,
    };
  }
  return { ...state, busy: false, saving: false, error: event.message };
}
