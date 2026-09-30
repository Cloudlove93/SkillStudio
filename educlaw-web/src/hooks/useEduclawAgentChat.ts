import { useChat, type UseChatHelpers } from '@ai-sdk/react';
import {
  createOpenAgentTransport,
  fetchOpenAgentSuggestions,
  type OpenAgentRuntimeContext,
  type ResolvableValue,
} from '@openagent/core/runtime';
import type { OpenAgentMessage } from '@openagent/core/types';
import { useCallback, useMemo, useRef, useState } from 'react';

export interface UseEduclawAgentChatOptions {
  id: string;
  api: string;
  suggestionsApi?: string;
  getContext?: ResolvableValue<OpenAgentRuntimeContext>;
  onSuggestions?: (suggestions: string[]) => void;
}

export interface UseEduclawAgentChatResult {
  messages: OpenAgentMessage[];
  setMessages: UseChatHelpers<OpenAgentMessage>['setMessages'];
  sendTextMessage: (text: string) => Promise<void>;
  stop: () => void;
  status: UseChatHelpers<OpenAgentMessage>['status'];
  error: Error | undefined;
  suggestions: string[];
  setSuggestions: (suggestions: string[]) => void;
  loadingSuggestions: boolean;
}

export function useEduclawAgentChat({
  id,
  api,
  suggestionsApi,
  getContext,
  onSuggestions,
}: UseEduclawAgentChatOptions): UseEduclawAgentChatResult {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const optionsRef = useRef({ suggestionsApi, getContext, onSuggestions });
  optionsRef.current = { suggestionsApi, getContext, onSuggestions };

  const transport = useMemo(
    () =>
      createOpenAgentTransport({
        api,
        getContext: () => {
          const current = optionsRef.current.getContext;
          if (typeof current === 'function') {
            return Promise.resolve(current()).then((value) => value ?? {});
          }
          return current ?? {};
        },
      }),
    [api],
  );

  const chat = useChat<OpenAgentMessage>({
    id,
    transport,
    onFinish: async ({ messages, isAbort, isDisconnect, isError }) => {
      if (
        isAbort
        || isDisconnect
        || isError
        || !optionsRef.current.suggestionsApi
        || messages.length === 0
      ) {
        return;
      }

      setLoadingSuggestions(true);
      try {
        const nextSuggestions = await fetchOpenAgentSuggestions({
          api: optionsRef.current.suggestionsApi,
          messages,
          getContext: optionsRef.current.getContext,
        });
        setSuggestions(nextSuggestions);
        optionsRef.current.onSuggestions?.(nextSuggestions);
      } catch {
        setSuggestions([]);
        optionsRef.current.onSuggestions?.([]);
      } finally {
        setLoadingSuggestions(false);
      }
    },
  });

  const sendTextMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      setSuggestions([]);
      await chat.sendMessage({ text: trimmed });
    },
    [chat],
  );

  return {
    messages: chat.messages,
    setMessages: chat.setMessages,
    sendTextMessage,
    stop: chat.stop,
    status: chat.status,
    error: chat.error,
    suggestions,
    setSuggestions,
    loadingSuggestions,
  };
}
