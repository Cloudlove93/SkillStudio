import { useRef, useEffect, type KeyboardEvent } from 'react';
import { Send, Square } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../i18n';

export default function HomeChatInput({
  input,
  setInput,
  streaming,
  onSend,
  onAbort,
  modelsAvailable,
}: {
  input: string;
  setInput: (v: string) => void;
  streaming: boolean;
  onSend: (text: string) => void;
  onAbort: () => void;
  modelsAvailable: boolean;
}) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, [input]);

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend(input.trim());
    }
  }

  return (
    <div className="px-4 pb-4 pt-2 sm:px-6">
      <div className="card-premium mx-auto max-w-4xl rounded-[28px] p-3">
        <div className="input-glow flex items-end gap-2.5 rounded-[24px] border border-border/70 bg-background/95 px-4 py-3 shadow-sm transition-all duration-200">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('home.chatPlaceholder')}
            rows={1}
            className="min-h-[24px] max-h-[160px] flex-1 resize-none bg-transparent text-sm leading-7 placeholder:text-muted-foreground/40 focus:outline-none"
            disabled={!modelsAvailable}
          />
          {streaming ? (
            <Button type="button" variant="destructive" size="icon-sm" onClick={onAbort} className="shrink-0 rounded-2xl">
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button type="button" size="icon-sm" disabled={!input.trim() || !modelsAvailable} onClick={() => onSend(input.trim())} className="btn-premium shrink-0 rounded-2xl">
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground/35">{t('prompt.disclaimer')}</p>
      </div>
    </div>
  );
}
