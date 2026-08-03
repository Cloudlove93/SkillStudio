export type SkillRunMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type SkillRunState = {
  messages: SkillRunMessage[];
  draft: string;
  streaming: string;
  busy: boolean;
  error: string | null;
};

export type SkillRunEvent =
  | { type: 'draft'; value: string }
  | { type: 'submit'; content: string }
  | { type: 'delta'; side: 'baseline' | 'enhanced'; delta: string }
  | { type: 'done'; content: string }
  | { type: 'error'; message: string }
  | { type: 'reset' };

export function createSkillRunState(): SkillRunState {
  return {
    messages: [],
    draft: '',
    streaming: '',
    busy: false,
    error: null,
  };
}

export function skillRunReducer(state: SkillRunState, event: SkillRunEvent): SkillRunState {
  if (event.type === 'reset') return createSkillRunState();
  if (event.type === 'draft') return { ...state, draft: event.value };
  if (event.type === 'submit') {
    return {
      ...state,
      messages: [...state.messages, { role: 'user', content: event.content }],
      draft: '',
      streaming: '',
      busy: true,
      error: null,
    };
  }
  if (event.type === 'delta') {
    if (event.side !== 'enhanced') return state;
    return { ...state, streaming: `${state.streaming}${event.delta}` };
  }
  if (event.type === 'done') {
    return {
      ...state,
      messages: [...state.messages, { role: 'assistant', content: event.content }],
      streaming: '',
      busy: false,
      error: null,
    };
  }
  return { ...state, busy: false, streaming: '', error: event.message };
}
