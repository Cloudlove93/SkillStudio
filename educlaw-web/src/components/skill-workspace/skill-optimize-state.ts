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
  | { type: 'reset' }
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

export const ADOPTION_SUCCESS_REPLY =
  '已采纳本次优化建议，修改草稿已生成。你可以点击下方“查看本次改动”检查具体内容，确认后保存为新版本。';

export function resolveSkillOptimizeReply(
  content: string,
  adoptions: AdoptedChange[],
): string {
  const visibleContent = content.trim();
  if (visibleContent) return visibleContent;

  const hasValidDraft = adoptions.some(
    (change) =>
      change.target === 'skill' &&
      change.modified.trim().length > 0 &&
      change.modified.trim() !== change.original.trim(),
  );
  if (hasValidDraft) return ADOPTION_SUCCESS_REPLY;

  throw new Error('系统没有生成可用的回复或有效修改草稿，请重试。');
}

export function skillOptimizeReducer(
  state: SkillOptimizeState,
  event: SkillOptimizeEvent,
): SkillOptimizeState {
  if (event.type === 'reset') return createSkillOptimizeState();
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
    const content = event.content.trim();
    return {
      ...state,
      messages: content
        ? [...state.messages, { role: 'assistant', content }]
        : state.messages,
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
