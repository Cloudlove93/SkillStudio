export type SkillRunMessage = {
  role: 'user' | 'assistant';
  content: string;
  messageId?: number;
  questionMessageId?: number;
  threadId?: number;
  enhancedAnswerMessageId?: number;
  baselineAnswerMessageId?: number | null;
  skillVersionNumber?: number;
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
  | {
      type: 'attach-provenance';
      questionMessageId: number;
      answerMessageId: number;
      threadId: number;
      baselineAnswerMessageId: number | null;
      skillVersionNumber: number;
    }
  | { type: 'error'; message: string }
  | { type: 'hydrate'; messages: SkillRunMessage[] }
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
  if (event.type === 'hydrate') {
    return { messages: event.messages, draft: '', streaming: '', busy: false, error: null };
  }
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
  if (event.type === 'attach-provenance') {
    let userAttached = false;
    let answerAttached = false;
    const messages = [...state.messages].reverse().map((message) => {
      if (!answerAttached && message.role === 'assistant') {
        answerAttached = true;
        return {
          ...message,
          messageId: event.answerMessageId,
          questionMessageId: event.questionMessageId,
          threadId: event.threadId,
          enhancedAnswerMessageId: event.answerMessageId,
          baselineAnswerMessageId: event.baselineAnswerMessageId,
          skillVersionNumber: event.skillVersionNumber,
        };
      }
      if (!userAttached && message.role === 'user') {
        userAttached = true;
        return { ...message, messageId: event.questionMessageId };
      }
      return message;
    }).reverse();
    return { ...state, messages };
  }
  return { ...state, busy: false, streaming: '', error: event.message };
}
