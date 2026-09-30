import { useEffect, useState, useRef, useCallback } from 'react';
import type { OpenAgentMessage } from '@openagent/core/types';
import { apiFetch } from '../../api/client';
import { useHomeChatStore } from '../../stores/home-chat';
import { useHomeChatSessionChat } from '../../hooks/useHomeChatSessionChat';
import { useHomeChatModels } from '../../hooks/useHomeChatModels';
import { useHomeChatSessionLifecycle } from '../../hooks/useHomeChatSessionLifecycle';
import HomeChatInput from './HomeChatInput';
import { useDiaryAction, useDeepStudyAction } from './HomeChatActions';
import HomeChatHeader from './HomeChatHeader';
import HomeChatConversation from './HomeChatConversation';
import DeepStudyMatchDialog from './DeepStudyMatchDialog';

interface HomeChatProps {
  sessionId: string;
}

export default function HomeChat({ sessionId }: HomeChatProps) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const updateSessionTitle = useHomeChatStore((s) => s.updateSessionTitle);
  const consumePendingMessage = useHomeChatStore((s) => s.consumePendingMessage);
  const currentSessionModel = useHomeChatStore((s) => s.sessions.find((session) => session.id === sessionId)?.model ?? '');
  const { models, selectedModel, setSelectedModel, hasModels } = useHomeChatModels();
  const messagesRef = useRef<OpenAgentMessage[]>([]);
  const {
    messages,
    setMessages,
    getCurrentMessages,
    sendTextMessage,
    stop,
    status,
  } = useHomeChatSessionChat(sessionId);
  messagesRef.current = messages;
  const streaming = status === 'streaming';
  const submitting = status === 'submitted';

  const { diaryStatus, handleSaveToDiary, resetDiaryStatus } = useDiaryAction(sessionId, getCurrentMessages);
  const { deepStudyOpen, setDeepStudyOpen, deepStudyLoading, deepStudyProfiles, deepStudyChatText, handleDeepStudy } = useDeepStudyAction(getCurrentMessages);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  useEffect(() => {
    if (currentSessionModel && models.some((model) => model.name === currentSessionModel)) {
      setSelectedModel(currentSessionModel);
    }
  }, [currentSessionModel, models, setSelectedModel]);

  const refreshSuggestions = useCallback(async () => {
    const currentMessages = getCurrentMessages()
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => ({
        role: message.role,
        content: message.parts
          .filter((part) => part.type === 'text')
          .map((part) => part.text ?? '')
          .join(''),
      }))
      .filter((message) => message.content.trim().length > 0);

    if (currentMessages.length === 0) {
      setSuggestions([]);
      return;
    }

    setLoadingSuggestions(true);
    try {
      const response = await apiFetch('/api/chat/suggestions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: currentMessages, sessionId }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const nextSuggestions = await response.json() as string[];
      setSuggestions(Array.isArray(nextSuggestions) ? nextSuggestions : []);
    } catch {
      setSuggestions([]);
    } finally {
      setLoadingSuggestions(false);
    }
  }, [getCurrentMessages, sessionId]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || streaming || submitting || !hasModels || !sessionId) return;

    setInput('');
    setSuggestions([]);

    if (messagesRef.current.length === 0) {
      updateSessionTitle(sessionId, text.replace(/\n/g, ' ').slice(0, 50));
    }

    await sendTextMessage(text, selectedModel || undefined);
    await refreshSuggestions();
  }, [
    streaming,
    submitting,
    hasModels,
    sessionId,
    updateSessionTitle,
    sendTextMessage,
    selectedModel,
    refreshSuggestions,
  ]);

  useHomeChatSessionLifecycle({
    sessionId,
    status,
    modelsReady: hasModels,
    setMessages,
    setSuggestions,
    resetDiaryStatus,
    consumePendingMessage,
    sendMessage,
  });

  return (
    <div className="flex h-full w-full flex-col">
      <HomeChatHeader
        models={models}
        selectedModel={selectedModel}
        onSelectModel={setSelectedModel}
      />

      <HomeChatConversation
        messages={messages}
        status={status}
        streaming={streaming}
        submitting={submitting}
        suggestions={suggestions}
        loadingSuggestions={loadingSuggestions}
        onSelectSuggestion={sendMessage}
        diaryStatus={diaryStatus}
        onSaveToDiary={handleSaveToDiary}
        onDeepStudy={handleDeepStudy}
        bottomRef={bottomRef}
      />

      <HomeChatInput
        input={input}
        setInput={setInput}
        streaming={streaming || submitting}
        onSend={sendMessage}
        onAbort={stop}
        modelsAvailable={hasModels}
      />

      <DeepStudyMatchDialog
        open={deepStudyOpen}
        onOpenChange={setDeepStudyOpen}
        profiles={deepStudyProfiles}
        loading={deepStudyLoading}
        chatText={deepStudyChatText}
      />
    </div>
  );
}
