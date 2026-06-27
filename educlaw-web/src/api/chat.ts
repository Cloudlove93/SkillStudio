import type {
  HomeChatCreateSessionInput,
  HomeChatMessage,
  HomeChatSession,
  HomeChatUpdateSessionInput,
} from '@educlaw/shared';
import { apiFetch, apiFetchJson, apiPost, apiPatch } from './client';

export type ChatSession = HomeChatSession;
export type ChatMessage = HomeChatMessage;

export function fetchChatSessions(): Promise<ChatSession[]> {
  return apiFetchJson(`/api/chat/sessions`);
}

export function createChatSession(title: string, model: string): Promise<ChatSession> {
  const input: HomeChatCreateSessionInput = { title, model };
  return apiPost(`/api/chat/sessions`, input);
}

export function deleteChatSession(id: string): Promise<{ ok: boolean }> {
  return apiFetchJson(`/api/chat/sessions/${id}`, { method: 'DELETE' });
}

export function updateChatSession(id: string, updates: HomeChatUpdateSessionInput): Promise<{ ok: boolean }> {
  return apiPatch(`/api/chat/sessions/${id}`, updates);
}

export function fetchChatMessages(sessionId: string): Promise<ChatMessage[]> {
  return apiFetchJson(`/api/chat/sessions/${sessionId}/messages`);
}

export interface HomeChatStreamEvent {
  event: 'accepted' | 'delta' | 'message.completed' | 'done' | 'cancelled' | 'error';
  data: Record<string, unknown>;
}

function parseEventChunk(chunk: string): HomeChatStreamEvent | null {
  const lines = chunk.split('\n');
  const eventLine = lines.find((line) => line.startsWith('event:'));
  const dataLine = lines.find((line) => line.startsWith('data:'));
  if (!eventLine || !dataLine) {
    return null;
  }

  try {
    return {
      event: eventLine.slice('event:'.length).trim() as HomeChatStreamEvent['event'],
      data: JSON.parse(dataLine.slice('data:'.length).trim()) as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export async function streamChatMessage(
  sessionId: string,
  input: {
    content: string;
    model?: string;
    signal?: AbortSignal;
    onEvent?: (event: HomeChatStreamEvent) => void;
  },
): Promise<void> {
  const response = await apiFetch(`/api/chat/sessions/${sessionId}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: input.content,
      ...(input.model ? { model: input.model } : {}),
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Missing response body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      const event = parseEventChunk(part);
      if (!event) {
        continue;
      }
      input.onEvent?.(event);
    }
  }

  if (buffer.trim()) {
    const trailingEvent = parseEventChunk(buffer);
    if (trailingEvent) {
      input.onEvent?.(trailingEvent);
    }
  }
}

export function abortChatSession(sessionId: string): Promise<{ ok: boolean }> {
  return apiPost(`/api/chat/sessions/${sessionId}/abort`);
}
