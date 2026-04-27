import { getOpenAgentMessageText } from '@openagent/core/messages';
import type { OpenAgentMessage } from '@openagent/core/types';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { LoaderCircle, User, MessageCircleQuestion } from 'lucide-react';
import { useT } from '../../i18n';
import { BASE } from '../../api/client';

export function MessageBubble({ msg, isStreaming }: { msg: OpenAgentMessage; isStreaming?: boolean }) {
  const isUser = msg.role === 'user';
  const text = getOpenAgentMessageText(msg);

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {isUser ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary shadow-sm">
          <User className="size-4 text-white" />
        </div>
      ) : (
        <div className="relative shrink-0">
          <div className="absolute -inset-2 rounded-full bg-primary/12 blur-lg" />
          <img src={`${BASE}/logo.png`} alt="" className="relative size-9 rounded-2xl drop-shadow-md" />
        </div>
      )}
      <div className={`min-w-0 max-w-[85%] ${isUser ? 'text-right' : ''}`}>
        <div className={`inline-block text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'rounded-[24px] rounded-tr-sm bg-primary px-4 py-3 text-primary-foreground shadow-sm'
            : 'rounded-[24px] rounded-tl-sm border border-border/70 bg-background/95 px-4 py-3 text-foreground shadow-sm'
        }`}>
          {isUser ? (
            <span className="whitespace-pre-wrap">{text}</span>
          ) : (
            <div className="prose prose-sm max-w-none dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_code]:text-[13px] [&_p]:leading-relaxed [&_pre]:rounded-2xl [&_pre]:border [&_pre]:border-border/70 [&_pre]:bg-muted/35">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{text}</ReactMarkdown>
              {isStreaming && <span className="inline-block w-1.5 h-4 ml-0.5 bg-foreground/60 animate-pulse rounded-sm align-text-bottom" />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SuggestionChips({
  suggestions,
  onSelect,
}: {
  suggestions: string[];
  onSelect: (text: string) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="ml-12 mt-3 flex flex-wrap gap-2">
      {suggestions.map((q, i) => (
        <button
          key={i}
          onClick={() => onSelect(q)}
          className="group flex max-w-[90%] items-center gap-1.5 rounded-full border border-border/70 bg-background/95 px-4 py-2 text-left text-xs text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-background hover:text-foreground"
        >
          <MessageCircleQuestion className="size-3 shrink-0 text-primary/50 group-hover:text-primary/70" />
          <span className="line-clamp-2">{q}</span>
        </button>
      ))}
    </div>
  );
}

export function LoadingSuggestions() {
  const t = useT();
  const widths = ['w-28', 'w-36', 'w-32'];

  return (
    <div className="ml-12 mt-3 max-w-[32rem] rounded-[24px] border border-border/70 bg-background/95 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground/80">
        <span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-primary">
          <LoaderCircle className="size-3.5 animate-spin" />
        </span>
        <span>{t('home.suggestionsLoading')}</span>
      </div>

      <p className="mt-2 text-xs leading-6 text-muted-foreground/65">
        {t('home.suggestionsLoadingHint')}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {widths.map((width, i) => (
          <div
            key={i}
            className="flex h-10 items-center gap-2 rounded-full border border-border/70 bg-background px-3"
          >
            <div className="size-4 shrink-0 rounded-full bg-primary/12" />
            <div
              className={`h-2.5 ${width} rounded-full bg-gradient-to-r from-muted/70 via-background to-muted/70 bg-[length:200%_100%] animate-[shimmer_1.8s_linear_infinite]`}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ThinkingDots() {
  return (
    <div className="mt-5 flex items-start gap-3">
      <img src={`${BASE}/logo.png`} alt="" className="size-9 shrink-0 rounded-2xl drop-shadow-sm" />
      <div className="rounded-[24px] rounded-tl-sm border border-border/70 bg-background/95 px-4 py-3 text-sm shadow-sm">
        <span className="inline-flex gap-1 text-muted-foreground">
          <span className="animate-pulse-dot">&bull;</span>
          <span className="animate-pulse-dot" style={{ animationDelay: '0.3s' }}>&bull;</span>
          <span className="animate-pulse-dot" style={{ animationDelay: '0.6s' }}>&bull;</span>
        </span>
      </div>
    </div>
  );
}
