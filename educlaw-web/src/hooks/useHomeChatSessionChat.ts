import { useCallback, useEffect, useRef, useState } from 'react';
import { createOpenAgentTextMessage } from '@openagent/core/messages';
import type { OpenAgentMessage } from '@openagent/core/types';
import { abortChatSession, streamChatMessage } from '../api/chat';

type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

function createMessageId(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) {
    return webCrypto.randomUUID();
  }

  if (webCrypto?.getRandomValues) {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    return `msg-${hex}`;
  }

  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function textMessage(id: string, role: 'user' | 'assistant', content: string): OpenAgentMessage {
  return createOpenAgentTextMessage({ id, role, content });
}

function updateAssistantMessage(
  messages: OpenAgentMessage[],
  assistantId: string,
  content: string,
): OpenAgentMessage[] {
  return messages.map((message) => (
    message.id === assistantId
      ? textMessage(assistantId, 'assistant', content)
      : message
  ));
}

export function useHomeChatSessionChat(sessionId: string) {
  const [messages, setMessagesState] = useState<OpenAgentMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>('ready');
  const [error, setError] = useState<Error | undefined>(undefined);
  const messagesRef = useRef<OpenAgentMessage[]>([]);
  const activeAbortRef = useRef<AbortController | null>(null);

  const setMessages = useCallback((next: OpenAgentMessage[]) => {
    messagesRef.current = next;
    setMessagesState(next);
  }, []);

  const mutateMessages = useCallback((updater: (current: OpenAgentMessage[]) => OpenAgentMessage[]) => {
    const next = updater(messagesRef.current);
    messagesRef.current = next;
    setMessagesState(next);
    return next;
  }, []);

  const getCurrentMessages = useCallback(() => messagesRef.current, []);

  useEffect(() => {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    setStatus('ready');
    setError(undefined);
  }, [sessionId]);

  const stop = useCallback(() => {
    activeAbortRef.current?.abort();
    activeAbortRef.current = null;
    setStatus('ready');
    void abortChatSession(sessionId).catch(() => undefined);
  }, [sessionId]);

  const sendTextMessage = useCallback(async (text: string, model?: string) => {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }

    const userMessageId = createMessageId();
    const assistantMessageId = createMessageId();
    let assistantText = '';
    let failed = false;
    const controller = new AbortController();
    activeAbortRef.current = controller;
    setError(undefined);
    setStatus('submitted');
    mutateMessages((current) => [
      ...current,
      textMessage(userMessageId, 'user', trimmed),
      textMessage(assistantMessageId, 'assistant', ''),
    ]);

    try {
      await streamChatMessage(sessionId, {
        content: trimmed,
        ...(model ? { model } : {}),
        signal: controller.signal,
        onEvent: (event) => {
          if (event.event === 'accepted') {
            setStatus('streaming');
            return;
          }

          if (event.event === 'delta' && typeof event.data.delta === 'string') {
            assistantText += event.data.delta;
            mutateMessages((current) => updateAssistantMessage(current, assistantMessageId, assistantText));
            return;
          }

          if (event.event === 'message.completed' && typeof event.data.content === 'string') {
            if (event.data.content || !assistantText) {
              assistantText = event.data.content;
            }
            mutateMessages((current) => updateAssistantMessage(current, assistantMessageId, assistantText));
            return;
          }

          if (event.event === 'cancelled') {
            if (!assistantText) {
              mutateMessages((current) => current.filter((message) => message.id !== assistantMessageId));
            }
            setStatus('ready');
            return;
          }

          if (event.event === 'error') {
            failed = true;
            if (!assistantText) {
              mutateMessages((current) => current.filter((message) => message.id !== assistantMessageId));
            }
            const nextError = new Error(
              typeof event.data.message === 'string' ? event.data.message : 'Chat stream failed',
            );
            setError(nextError);
            setStatus('error');
            return;
          }

          if (event.event === 'done') {
            setStatus('ready');
          }
        },
      });

      if (!controller.signal.aborted && !failed) {
        setStatus('ready');
      }
    } catch (streamError) {
      if (controller.signal.aborted) {
        if (!assistantText) {
          mutateMessages((current) => current.filter((message) => message.id !== assistantMessageId));
        }
        setStatus('ready');
        return;
      }

      if (!assistantText) {
        mutateMessages((current) => current.filter((message) => message.id !== assistantMessageId));
      }
      const nextError = streamError instanceof Error ? streamError : new Error('Chat stream failed');
      setError(nextError);
      setStatus('error');
    } finally {
      if (activeAbortRef.current === controller) {
        activeAbortRef.current = null;
      }
    }
  }, [mutateMessages, sessionId]);

  return {
    messages,
    setMessages,
    getCurrentMessages,
    sendTextMessage,
    stop,
    status,
    error,
  };
}
