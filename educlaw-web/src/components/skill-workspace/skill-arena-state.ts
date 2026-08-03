export type SkillArenaState = {
  draft: string;
  question: string;
  baseline: string;
  enhanced: string;
  baselineDone: boolean;
  enhancedDone: boolean;
  busy: boolean;
  error: string | null;
};

export type SkillArenaEvent =
  | { type: 'draft'; value: string }
  | { type: 'submit'; content: string }
  | { type: 'delta'; side: 'baseline' | 'enhanced'; delta: string }
  | { type: 'side_done'; side: 'baseline' | 'enhanced'; content: string }
  | { type: 'error'; message: string }
  | { type: 'reset' };

export function createSkillArenaState(): SkillArenaState {
  return {
    draft: '',
    question: '',
    baseline: '',
    enhanced: '',
    baselineDone: false,
    enhancedDone: false,
    busy: false,
    error: null,
  };
}

export function skillArenaReducer(state: SkillArenaState, event: SkillArenaEvent): SkillArenaState {
  if (event.type === 'reset') return createSkillArenaState();
  if (event.type === 'draft') return { ...state, draft: event.value };
  if (event.type === 'submit') {
    return {
      ...createSkillArenaState(),
      question: event.content,
      busy: true,
    };
  }
  if (event.type === 'delta') {
    return { ...state, [event.side]: `${state[event.side]}${event.delta}` };
  }
  if (event.type === 'side_done') {
    const doneKey = event.side === 'baseline' ? 'baselineDone' : 'enhancedDone';
    const otherDone = event.side === 'baseline' ? state.enhancedDone : state.baselineDone;
    return {
      ...state,
      [event.side]: event.content,
      [doneKey]: true,
      busy: !otherDone,
    };
  }
  return { ...state, busy: false, error: event.message };
}
