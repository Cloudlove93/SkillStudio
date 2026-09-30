import { useState, useRef, useCallback, useEffect, useMemo, type KeyboardEvent, type ClipboardEvent } from 'react';
import { Send, Square, Sparkles, Loader2, Paperclip, Terminal } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useT } from '../../i18n';
import SlashPopover, { type SlashCommand } from './SlashPopover';
import { useImageAttachments, ImageDragOverlay, ImagePreviewStrip, ACCEPTED_IMAGE_TYPES } from './prompt/ImageAttachments';
import { usePromptHistory } from './prompt/PromptHistory';
import AgentSelector from './prompt/AgentSelector';
import ActionBar, { DiaryButton } from './prompt/ActionBar';

export interface ImageAttachment {
  id: string;
  filename: string;
  mime: string;
  dataUrl: string;
}

export interface AgentOption {
  name: string;
  description?: string;
  mode?: string;
  hidden?: boolean;
}

export interface CustomCommand {
  name: string;
  description?: string;
  source?: 'command' | 'mcp' | 'skill';
}

export type PromptMode = 'normal' | 'shell';

export default function PromptInput({
  onSend,
  onAbort,
  onSlashCommand,
  isStreaming,
  disabled,
  placeholder,
  agents,
  currentAgent,
  onAgentChange,
  customCommands,
  mode,
  onModeChange,
  diaryStatus,
  onSaveToDiary,
}: {
  onSend: (content: string, images?: ImageAttachment[], agent?: string) => void;
  onAbort: () => void;
  onSlashCommand?: (command: string) => void;
  isStreaming: boolean;
  disabled: boolean;
  placeholder?: string;
  agents?: AgentOption[];
  currentAgent?: string;
  onAgentChange?: (name: string) => void;
  customCommands?: CustomCommand[];
  mode?: PromptMode;
  onModeChange?: (mode: PromptMode) => void;
  diaryStatus?: 'idle' | 'loading' | 'success' | 'error';
  onSaveToDiary?: () => void;
}) {
  const t = useT();
  const [text, setText] = useState('');
  const [aborting, setAborting] = useState(false);
  const [showSlash, setShowSlash] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [slashActiveId, setSlashActiveId] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const currentMode = mode ?? 'normal';

  const { images, dragging, addImage, removeImage, clearImages } = useImageAttachments();
  const history = usePromptHistory();

  const hasSlashHandler = !!onSlashCommand;
  const builtinCommands: SlashCommand[] = useMemo(() => {
    if (!hasSlashHandler) return [];
    return [
      { id: 'new', trigger: 'new', title: t('slash.new'), description: t('slash.newDesc'), type: 'builtin' as const },
      { id: 'optimize-agent', trigger: 'optimize-agent', title: t('slash.optimizeAgent'), description: t('slash.optimizeAgentDesc'), type: 'builtin' as const },
      { id: 'optimize-profile', trigger: 'optimize-profile', title: t('slash.optimizeProfile'), description: t('slash.optimizeProfileDesc'), type: 'builtin' as const },
      { id: 'optimize-skill', trigger: 'optimize-skill', title: t('slash.optimizeSkill'), description: t('slash.optimizeSkillDesc'), type: 'builtin' as const },
    ];
  }, [hasSlashHandler, t]);

  const customSlashCommands: SlashCommand[] = useMemo(() => {
    if (!customCommands) return [];
    return customCommands.map((c) => ({ id: `custom:${c.name}`, trigger: c.name, title: c.name, description: c.description, type: 'custom' as const, source: c.source }));
  }, [customCommands]);

  const allSlashCommands = useMemo(() => [...builtinCommands, ...customSlashCommands], [builtinCommands, customSlashCommands]);

  const filteredSlash = useMemo(() => {
    if (!slashFilter) return allSlashCommands;
    const q = slashFilter.toLowerCase();
    return allSlashCommands.filter((c) => c.trigger.toLowerCase().includes(q) || c.title.toLowerCase().includes(q));
  }, [allSlashCommands, slashFilter]);

  useEffect(() => {
    if (filteredSlash.length > 0) {
      setSlashActiveId((prev) => (prev && filteredSlash.some((c) => c.id === prev)) ? prev : filteredSlash[0].id);
    } else {
      setSlashActiveId(null);
    }
  }, [filteredSlash]);

  useEffect(() => {
    if (text === '/') { setShowSlash(true); setSlashFilter(''); }
    else if (text.startsWith('/') && !text.includes(' ')) { setShowSlash(true); setSlashFilter(text.slice(1)); }
    else { setShowSlash(false); setSlashFilter(''); }
  }, [text]);

  function handleSlashSelect(cmd: SlashCommand) {
    setShowSlash(false);
    setSlashFilter('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    if (cmd.type === 'builtin') {
      if (cmd.id === 'new') {
        setText('');
        onSlashCommand?.(cmd.id);
        return;
      }
      const nextValue = cmd.id === 'optimize-skill' ? '/optimize-skill ' : `/${cmd.id}`;
      setText(nextValue);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    setText(`/${cmd.trigger} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleSend() {
    const trimmed = text.trim();
    if ((!trimmed && images.length === 0) || disabled) return;
    history.push(trimmed);
    onSend(trimmed, images.length > 0 ? images : undefined, currentAgent);
    setText('');
    clearImages();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }

  async function handleAbort() {
    setAborting(true);
    try { await onAbort(); } finally { setAborting(false); }
  }

  if (!isStreaming && aborting) setAborting(false);

  function handleKeyDown(e: KeyboardEvent) {
    if (showSlash && filteredSlash.length > 0) {
      if (e.key === 'ArrowUp') { e.preventDefault(); const idx = filteredSlash.findIndex((c) => c.id === slashActiveId); setSlashActiveId(filteredSlash[idx <= 0 ? filteredSlash.length - 1 : idx - 1].id); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); const idx = filteredSlash.findIndex((c) => c.id === slashActiveId); setSlashActiveId(filteredSlash[idx < 0 || idx >= filteredSlash.length - 1 ? 0 : idx + 1].id); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const active = filteredSlash.find((c) => c.id === slashActiveId); if (active) handleSlashSelect(active); return; }
      if (e.key === 'Escape') { e.preventDefault(); setShowSlash(false); return; }
    }

    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); return; }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const el = textareaRef.current;
      if (!el) return;
      const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
      const atEnd = el.selectionStart === text.length && el.selectionEnd === text.length;
      const newText = history.navigate(e.key === 'ArrowUp' ? 'up' : 'down', text, atStart, atEnd);
      if (newText !== null) { e.preventDefault(); setText(newText); }
    }
  }

  function handleInput() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && ACCEPTED_IMAGE_TYPES.includes(item.type)) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImage(file);
        return;
      }
    }
  }, [addImage]);

  const visibleAgents = useMemo(() => (agents ?? []).filter((a) => a.mode !== 'subagent' && !a.hidden), [agents]);
  const hasAgents = visibleAgents.length > 1;
  const hasModes = !!onModeChange;

  return (
    <div className="shrink-0 px-4 pb-4 pt-2">
      <div className="mx-auto max-w-5xl">
        {dragging && <ImageDragOverlay />}
        <ImagePreviewStrip images={images} onRemove={removeImage} />

        <div className="card-premium rounded-[20px] p-3 sm:p-4">
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              {showSlash && <SlashPopover commands={filteredSlash} activeId={slashActiveId} onSelect={handleSlashSelect} onActiveChange={setSlashActiveId} />}

              <div className="input-glow flex items-end gap-2 rounded-[16px] border border-border bg-card p-3 transition-all duration-150">
                {currentMode === 'shell' ? (
                  <Terminal size={16} className="mb-2.5 ml-1 shrink-0 text-[color:var(--warning)]" />
                ) : (
                  <Sparkles size={16} className="mb-2.5 ml-1 shrink-0 text-primary/60" />
                )}
                <Textarea
                  ref={textareaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onInput={handleInput}
                  onPaste={handlePaste}
                  placeholder={currentMode === 'shell' ? t('prompt.shellPlaceholder') : (placeholder ?? t('prompt.placeholder'))}
                  disabled={disabled}
                  rows={1}
                  className="min-h-0 flex-1 resize-none border-0 bg-transparent text-[15px] leading-7 shadow-none focus-visible:ring-0"
                />

                <label className="mb-1 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground hover:bg-card" title={t('prompt.attachImage')}>
                  <Paperclip className="size-3.5" />
                  <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} multiple className="hidden" onChange={(e) => { const files = e.target.files; if (files) for (const file of Array.from(files)) addImage(file); e.target.value = ''; }} />
                </label>

                {isStreaming ? (
                  <Button onClick={handleAbort} variant="destructive" size="icon" disabled={aborting} className="size-10 shrink-0 rounded-[10px]" title={t('prompt.stop')}>
                    {aborting ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
                  </Button>
                ) : (
                  <Button onClick={handleSend} disabled={disabled || (!text.trim() && images.length === 0)} size="icon" className="size-10 shrink-0 rounded-[10px]" title={t('prompt.send')}>
                    <Send className="size-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <DiaryButton diaryStatus={diaryStatus} onSaveToDiary={onSaveToDiary} />
          </div>

          <ActionBar
            hasModes={hasModes}
            hasAgents={hasAgents}
            currentMode={currentMode}
            onModeChange={onModeChange}
            agentSelector={hasAgents ? <AgentSelector agents={agents ?? []} currentAgent={currentAgent} onAgentChange={onAgentChange} /> : null}
          />
        </div>
      </div>
    </div>
  );
}
