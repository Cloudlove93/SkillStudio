import type { RefObject } from 'react';
import type { OpenAgentMessage } from '@openagent/core/types';
import { ScrollArea } from '../ui/scroll-area';
import { useT } from '../../i18n';
import { BASE } from '../../api/client';
import { MessageBubble, SuggestionChips, LoadingSuggestions } from './HomeChatMessages';
import { HomeChatActionButtons } from './HomeChatActions';
import type { DiaryStatus } from '../../stores/home-chat';

interface HomeChatConversationProps {
  messages: OpenAgentMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  streaming: boolean;
  submitting: boolean;
  suggestions: string[];
  loadingSuggestions: boolean;
  onSelectSuggestion: (text: string) => void;
  diaryStatus: DiaryStatus;
  onSaveToDiary: () => void;
  onDeepStudy: () => void;
  bottomRef: RefObject<HTMLDivElement | null>;
}

export default function HomeChatConversation({
  messages,
  status,
  streaming,
  submitting,
  suggestions,
  loadingSuggestions,
  onSelectSuggestion,
  diaryStatus,
  onSaveToDiary,
  onDeepStudy,
  bottomRef,
}: HomeChatConversationProps) {
  const t = useT();

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        {messages.length === 0 && status === 'ready' && (
          <div className="card-premium mx-auto flex max-w-2xl flex-col items-center justify-center rounded-[30px] px-8 py-14 text-center">
            <div className="relative mb-6">
              <div className="absolute -inset-5 rounded-full bg-gradient-to-br from-primary/15 via-cyan-500/10 to-amber-500/10 blur-2xl" />
              <img src={`${BASE}/logo.png`} alt="" className="relative size-16 rounded-[24px] drop-shadow-lg" />
            </div>
            <div className="rounded-full border border-border/70 bg-background/95 px-3 py-1 text-[11px] font-medium tracking-[0.16em] text-muted-foreground/70 shadow-sm">
              {t('home.chatTitle')}
            </div>
            <p className="mt-5 max-w-xl text-[1.75rem] font-semibold tracking-[-0.04em] text-foreground sm:text-[2rem]">
              {t('home.chatEmptyLead')}
            </p>
            <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground/60">
              {t('home.chatEmptyHint')}
            </p>
          </div>
        )}

        <div className="space-y-5">
          {messages.map((message, idx) => (
            <div key={message.id}>
              <MessageBubble msg={message} isStreaming={(streaming || submitting) && idx === messages.length - 1} />
              {message.role === 'assistant' && idx === messages.length - 1 && status === 'ready' && (
                <SuggestionChips suggestions={suggestions} onSelect={onSelectSuggestion} />
              )}
              {message.role === 'assistant' && idx === messages.length - 1 && status === 'ready' && loadingSuggestions && (
                <LoadingSuggestions />
              )}
            </div>
          ))}
        </div>

        {messages.length > 0 && status === 'ready' && (
          <HomeChatActionButtons
            diaryStatus={diaryStatus}
            onSaveToDiary={onSaveToDiary}
            onDeepStudy={onDeepStudy}
          />
        )}

        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
