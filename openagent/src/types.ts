import type { UIMessage } from 'ai';

export type OpenAgentMessage = UIMessage;

export interface OpenAgentLegacyMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface OpenAgentSuggestionState {
  suggestions: string[];
  loadingSuggestions: boolean;
}
