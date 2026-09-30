import { useState, useCallback } from 'react';
import { Bot, User, Trash2, Copy, Check, Sparkles } from 'lucide-react';
import type { Message } from '../../stores/chat';
import PartRenderer from './PartRenderer';
import { useT } from '../../i18n';
import { copyToClipboard } from '../../lib/utils';
import { PremiumPill } from '@/components/ui/premium';

function CopyMessageButton({ message }: { message: Message }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const text = message.parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('\n\n')
      .trim();
    if (text) {
      copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [message.parts]);

  return (
    <button
      onClick={handleCopy}
      className="rounded-full border border-transparent px-2 py-1 text-[11px] text-muted-foreground/45 opacity-0 transition-all duration-200 group-hover:opacity-100 hover:border-white/55 hover:bg-white/65 hover:text-foreground dark:hover:border-white/10 dark:hover:bg-white/8"
      title={t('message.copy')}
    >
      <span className="inline-flex items-center gap-1">
        {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
        {copied ? t('message.copied') : t('shared.copy')}
      </span>
    </button>
  );
}

export default function MessageItem({
  message,
  isStreaming,
  onDelete,
}: {
  message: Message;
  isStreaming?: boolean;
  onDelete?: () => void;
}) {
  const t = useT();
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="group flex gap-3 justify-end animate-fade-in-up">
        <div className="relative max-w-[78%] min-w-0">
          <div className="ring-luxury surface-noise rounded-[24px] rounded-tr-[10px] bg-[linear-gradient(135deg,oklch(0.44_0.12_249)_0%,oklch(0.67_0.11_210)_58%,oklch(0.78_0.11_82)_100%)] px-4 py-3 text-sm text-white shadow-[0_28px_60px_-32px_oklch(0.44_0.12_249_/_0.6)] [&_.prose]:text-white [&_.prose_*]:text-white">
            {message.parts.map((part, i) => (
              <PartRenderer key={part.id || i} part={part} />
            ))}
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              className="absolute -left-9 top-4 rounded-full border border-white/55 bg-white/72 p-1.5 text-muted-foreground/55 opacity-0 shadow-sm backdrop-blur-sm transition-all duration-200 group-hover:opacity-100 hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive dark:border-white/10 dark:bg-white/10"
              title={t('message.delete')}
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 dark:from-indigo-400 dark:to-indigo-500 shadow-md shadow-indigo-500/20 ring-2 ring-white dark:ring-background">
          <User size={14} className="text-white" />
        </div>
      </div>
    );
  }

  // Hide reasoning parts from end-users. If a message has no text parts at all,
  // fall back to rendering reasoning as plain text so the user isn't left with empty bubbles.
  const hasTextPart = message.parts.some((p) => p.type === 'text');
  const displayParts = hasTextPart
    ? message.parts.filter((p) => p.type !== 'reasoning')
    : message.parts.map((p) =>
        p.type === 'reasoning' ? { ...p, type: 'text' as const } : p
      );

  // Find the last "content" part — the one actively being written to
  const lastPartIdx = displayParts.length - 1;

  return (
    <div className="group flex gap-3 animate-fade-in-up">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 shadow-sm ring-2 ring-white dark:from-emerald-500/20 dark:to-teal-500/20 dark:ring-background">
        <Bot size={14} className="text-emerald-600 dark:text-emerald-400" />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-[0.16em] text-muted-foreground/60 uppercase">Assistant</span>
          {isStreaming ? (
            <PremiumPill accent="emerald" icon={Sparkles}>{t('message.streaming')}</PremiumPill>
          ) : null}
          <CopyMessageButton message={message} />
        </div>
        <div className="min-w-0 space-y-1.5 rounded-[24px] border border-white/55 bg-[linear-gradient(180deg,oklch(1_0_0_/_0.7),oklch(1_0_0_/_0.48))] px-4 py-3 shadow-warm backdrop-blur-xl dark:border-white/10 dark:bg-[linear-gradient(180deg,oklch(0.24_0.02_252_/_0.88),oklch(0.2_0.018_252_/_0.76))]">
          {displayParts.map((part, i) => (
            <PartRenderer
              key={part.id || i}
              part={part}
              isStreaming={isStreaming && i === lastPartIdx}
            />
          ))}
          {/* Show a waiting indicator when streaming but no parts yet */}
          {isStreaming && message.parts.length === 0 && (
            <div className="flex items-center gap-2 py-1.5">
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:0ms]" />
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:150ms]" />
              <span className="size-2 rounded-full bg-primary/60 animate-bounce [animation-delay:300ms]" />
              <span className="text-xs text-muted-foreground">{t('message.thinking')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
