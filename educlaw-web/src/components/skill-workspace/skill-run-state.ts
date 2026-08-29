export type SkillRunMessage = {
  role: 'user' | 'assistant';
  content: string;
  reasoningContent?: string | null;
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
  streamingReasoning: string;
  busy: boolean;
  error: string | null;
  thinkingRequested: boolean;
  thinkingEnabled: boolean;
  thinkingSupported: boolean | null;
  thinkingNotice: string | null;
  stopped: boolean;
};

export type SkillRunEvent =
  | { type: 'draft'; value: string }
  | { type: 'submit'; content: string; thinkingRequested?: boolean }
  | { type: 'delta'; side: 'baseline' | 'enhanced'; delta: string }
  | {
      type: 'reasoning_delta';
      side: 'baseline' | 'enhanced';
      delta: string;
    }
  | {
      type: 'thinking_status';
      requested: boolean;
      enabled: boolean;
      supported: boolean;
    }
  | { type: 'done'; content: string; reasoningContent?: string | null }
  | {
      type: 'attach-provenance';
      questionMessageId: number;
      answerMessageId: number;
      threadId: number;
      baselineAnswerMessageId: number | null;
      skillVersionNumber: number;
    }
  | { type: 'error'; message: string }
  | { type: 'stop' }
  | { type: 'hydrate'; messages: SkillRunMessage[] }
  | { type: 'reset' };

export function createSkillRunState(): SkillRunState {
  return {
    messages: [],
    draft: '',
    streaming: '',
    streamingReasoning: '',
    busy: false,
    error: null,
    thinkingRequested: false,
    thinkingEnabled: false,
    thinkingSupported: null,
    thinkingNotice: null,
    stopped: false,
  };
}

export function skillRunReducer(state: SkillRunState, event: SkillRunEvent): SkillRunState {
  if (event.type === 'reset') return createSkillRunState();
  if (event.type === 'hydrate') {
    return { ...createSkillRunState(), messages: event.messages };
  }
  if (event.type === 'draft') return { ...state, draft: event.value };
  if (event.type === 'submit') {
    return {
      ...state,
      messages: [...state.messages, { role: 'user', content: event.content }],
      draft: '',
      streaming: '',
      streamingReasoning: '',
      busy: true,
      error: null,
      thinkingRequested: event.thinkingRequested === true,
      thinkingEnabled: false,
      thinkingSupported: null,
      thinkingNotice: null,
      stopped: false,
    };
  }
  if (event.type === 'thinking_status') {
    return {
      ...state,
      thinkingRequested: event.requested,
      thinkingEnabled: event.enabled,
      thinkingSupported: event.supported,
      thinkingNotice:
        event.requested && !event.supported
          ? '当前模型不支持深度思考，将正常生成回答'
          : null,
    };
  }
  if (event.type === 'reasoning_delta') {
    if (event.side !== 'enhanced') return state;
    return {
      ...state,
      streamingReasoning: `${state.streamingReasoning}${event.delta}`,
    };
  }
  if (event.type === 'delta') {
    if (event.side !== 'enhanced') return state;
    return { ...state, streaming: `${state.streaming}${event.delta}` };
  }
  if (event.type === 'done') {
    const hasServerReasoning = event.reasoningContent !== undefined;
    const reasoningContent = hasServerReasoning
      ? event.reasoningContent
      : state.streamingReasoning || undefined;
    const assistant: SkillRunMessage = {
      role: 'assistant',
      content: event.content,
      ...(hasServerReasoning || reasoningContent
        ? { reasoningContent: reasoningContent ?? null }
        : {}),
    };
    return {
      ...state,
      messages: [...state.messages, assistant],
      streaming: '',
      streamingReasoning: '',
      busy: false,
      error: null,
      thinkingNotice:
        state.thinkingEnabled && !reasoningContent
          ? '当前模型未返回可显示的思考过程'
          : state.thinkingNotice,
      stopped: false,
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
  if (event.type === 'stop') {
    return { ...state, busy: false, error: null, stopped: true };
  }
  return { ...state, busy: false, error: event.message, stopped: false };
}
