import { useEffect, useRef } from 'react';
import { fromLegacyOpenAgentMessages } from '@openagent/core/messages';
import type { OpenAgentMessage } from '@openagent/core/types';
import { fetchChatMessages } from '../api/chat';

interface UseHomeChatSessionLifecycleOptions {
  sessionId: string;
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  modelsReady: boolean;
  setMessages: (messages: OpenAgentMessage[]) => void;
  setSuggestions: (suggestions: string[]) => void;
  resetDiaryStatus: () => void;
  consumePendingMessage: () => string | null;
  sendMessage: (text: string) => Promise<void>;
}

export function useHomeChatSessionLifecycle({
  sessionId,
  status,
  modelsReady,
  setMessages,
  setSuggestions,
  resetDiaryStatus,
  consumePendingMessage,
  sendMessage,
}: UseHomeChatSessionLifecycleOptions) {
  const prevSessionRef = useRef<string | null>(null);
  const initialMsgSent = useRef(false);

  useEffect(() => {
    if (sessionId === prevSessionRef.current) return;

    prevSessionRef.current = sessionId;
    initialMsgSent.current = false;
    resetDiaryStatus();

    if (!sessionId) {
      setMessages([]);
      setSuggestions([]);
      return;
    }

    let cancelled = false;

    fetchChatMessages(sessionId)
      .then((msgs) => {
        if (cancelled) return;

        const chatMessages: { id: string; role: 'user' | 'assistant'; content: string }[] = [];
        let savedSuggestions: string[] = [];

        for (const message of msgs) {
          if ((message.role as string) === 'suggestions') {
            try {
              savedSuggestions = JSON.parse(message.content);
            } catch {
              savedSuggestions = [];
            }
            continue;
          }

          chatMessages.push({
            id: message.id,
            role: message.role as 'user' | 'assistant',
            content: message.content,
          });
        }

        setMessages(fromLegacyOpenAgentMessages(chatMessages));
        setSuggestions(savedSuggestions);
      })
      .catch(() => {
        if (cancelled) return;
        setMessages([]);
        setSuggestions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, resetDiaryStatus, setMessages, setSuggestions]);

  useEffect(() => {
    if (initialMsgSent.current || !modelsReady || !sessionId || status !== 'ready') return;

    const pending = consumePendingMessage();
    if (!pending) return;

    initialMsgSent.current = true;
    void sendMessage(pending);
  }, [modelsReady, sessionId, status, consumePendingMessage, sendMessage]);
}
