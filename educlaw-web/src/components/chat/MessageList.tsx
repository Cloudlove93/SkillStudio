import { useEffect, useRef } from 'react';
import type { Message } from '../../stores/chat';
import MessageItem from './MessageItem';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Bot, Sparkles } from 'lucide-react';
import { useT } from '../../i18n';

export default function MessageList({
  messages,
  isStreaming,
  onDeleteMessage,
}: {
  messages: Message[];
  isStreaming?: boolean;
  onDeleteMessage?: (messageId: string) => void;
}) {
  const t = useT();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 min-h-0 items-center justify-center px-6 py-10">
        <div className="card-premium flex max-w-lg flex-col items-center gap-5 rounded-[28px] px-8 py-10 text-center text-muted-foreground">
          <div className="relative animate-float">
            <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/15 via-primary/5 to-amber-500/10 blur-xl" />
            <div className="relative flex size-[4.5rem] items-center justify-center rounded-[26px] border border-white/60 bg-white/70 shadow-warm dark:border-white/10 dark:bg-white/8">
              <Sparkles className="size-8 text-primary/70 dark:text-primary" />
            </div>
          </div>
          <div>
            <p className="text-lg font-semibold tracking-[-0.03em] text-foreground">{t('message.start')}</p>
            <p className="mt-2 text-sm leading-7 text-muted-foreground/70">{t('message.startHint')}</p>
          </div>
        </div>
      </div>
    );
  }

  // Determine if we need a "thinking" placeholder:
  // streaming is active but the last message is NOT an assistant message
  // (i.e., assistant hasn't started replying yet)
  const lastMsg = messages[messages.length - 1];
  const showThinkingPlaceholder = isStreaming && lastMsg?.role !== 'assistant';

  return (
    <ScrollArea className="flex-1 min-h-0 overflow-hidden [&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden" ref={scrollAreaRef}>
      <div className="mx-auto max-w-5xl space-y-6 overflow-hidden px-5 py-8 sm:px-7 lg:px-8">
        {messages.map((msg, idx) => (
          <MessageItem
            key={idx}
            message={msg}
            isStreaming={isStreaming && idx === messages.length - 1 && msg.role === 'assistant'}
            onDelete={onDeleteMessage ? () => onDeleteMessage(msg.id) : undefined}
          />
        ))}

        {/* Thinking placeholder — shown after user sends but before assistant message arrives */}
        {showThinkingPlaceholder && (
          <div className="animate-fade-in-up flex gap-3 rounded-[24px] border border-white/55 bg-white/45 px-4 py-4 shadow-sm dark:border-white/10 dark:bg-white/6">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 shadow-sm ring-2 ring-white dark:from-emerald-500/20 dark:to-teal-500/20 dark:ring-background">
              <Bot size={14} className="text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0 space-y-2">
              <span className="text-[11px] font-medium tracking-[0.24em] text-muted-foreground/60 uppercase">Assistant</span>
              <div className="flex items-center gap-1.5 py-2">
                <span className="size-1.5 rounded-full bg-emerald-500/60 animate-bounce [animation-delay:0ms]" />
                <span className="size-1.5 rounded-full bg-emerald-500/60 animate-bounce [animation-delay:150ms]" />
                <span className="size-1.5 rounded-full bg-emerald-500/60 animate-bounce [animation-delay:300ms]" />
                <span className="ml-2 text-xs text-muted-foreground/50">{t('message.thinking')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
