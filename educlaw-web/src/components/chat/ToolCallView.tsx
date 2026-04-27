import { useState, useCallback } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Loader2, CircleCheck, CircleX, Clock,
  FileText, Pencil, Terminal, FilePlus, FolderSearch, Search, Wrench, MessageCircleQuestion } from 'lucide-react';
import DiffView from '../editor/DiffView';
import { useT } from '../../i18n';
import { copyToClipboard } from '../../lib/utils';
import { PremiumPill } from '@/components/ui/premium';

const toolIcons: Record<string, React.ElementType> = {
  Read: FileText,
  Edit: Pencil,
  Bash: Terminal,
  Write: FilePlus,
  Glob: FolderSearch,
  Grep: Search,
  question: MessageCircleQuestion,
};

const pathTools = new Set(['Read', 'Edit', 'Write', 'Glob', 'Grep']);

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function formatInput(toolName: string, input: unknown): string {
  if (!input) return '';
  if (typeof input === 'string') return input;
  const inputRecord = toRecord(input);
  if (pathTools.has(toolName)) {
    const path = inputRecord.file_path ?? inputRecord.path ?? inputRecord.pattern;
    if (path) return String(path);
  }
  if (toolName === 'Bash') {
    const cmd = inputRecord.command ?? inputRecord.cmd;
    if (cmd) return String(cmd);
  }
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

/** Check if toolInput is "empty" (undefined, null, or {}) */
function isEmptyInput(input: unknown): boolean {
  if (!input) return true;
  if (typeof input === 'object' && Object.keys(input).length === 0) return true;
  return false;
}

function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); handleCopy(); }}
      className="rounded-full border border-transparent px-2 py-1 text-[11px] text-muted-foreground/60 transition-all duration-200 hover:border-white/55 hover:bg-white/65 hover:text-foreground dark:hover:border-white/10 dark:hover:bg-white/8"
      title={t('shared.copy')}
    >
      <span className="inline-flex items-center gap-1">
        {copied ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
        {copied ? t('shared.copied') : t('shared.copy')}
      </span>
    </button>
  );
}

export default function ToolCallView({
  toolName,
  input,
  output,
  state,
}: {
  toolName: string;
  input?: unknown;
  output?: unknown;
  state?: string;
}) {
  const t = useT();
  const isActive = state === 'running' || state === 'pending';
  const [expanded, setExpanded] = useState(false);
  const [outputExpanded, setOutputExpanded] = useState(false);

  const stateConfig: Record<string, { label: string; icon: React.ElementType; color: string; bgColor: string }> = {
    pending:   { label: t('tool.pending'),   icon: Clock,       color: 'text-muted-foreground', bgColor: 'bg-muted/50' },
    running:   { label: t('tool.running'),   icon: Loader2,     color: 'text-yellow-600 dark:text-yellow-400', bgColor: 'bg-yellow-500/10' },
    completed: { label: t('tool.completed'), icon: CircleCheck, color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10' },
    error:     { label: t('tool.error'),     icon: CircleX,     color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10' },
  };

  const Icon = toolIcons[toolName] ?? Wrench;
  const isDiff = toolName === 'Edit' && typeof output === 'string' && output.includes('@@');
  const formattedInput = formatInput(toolName, input);
  const fullInputStr = input
    ? typeof input === 'string' ? input : JSON.stringify(input, null, 2)
    : '';
  const outputStr = output !== undefined
    ? typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    : '';
  const outputIsLong = outputStr.length > 1000;
  const config = state ? stateConfig[state] : undefined;
  const StateIcon = config?.icon;

  // Determine what to display as tool input during active state
  const hasInputToShow = isActive && !isEmptyInput(input);
  const isPendingEmpty = isActive && !hasInputToShow;

  // During streaming (running/pending) — show input when available
  if (isActive) {
    return (
      <div className="animate-fade-in">
        <div className="flex min-w-0 items-center gap-2 rounded-full border border-white/55 bg-[linear-gradient(90deg,oklch(1_0_0_/_0.7),oklch(1_0_0_/_0.5))] px-2.5 py-1.5 text-xs shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[linear-gradient(90deg,oklch(0.24_0.02_252_/_0.88),oklch(0.2_0.018_252_/_0.72))]">
          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full ${config?.bgColor ?? 'bg-muted/50'}`}>
            <Icon size={11} className={config?.color ?? 'text-muted-foreground'} />
          </span>
          <span className="shrink-0 font-mono font-medium text-foreground/85">{toolName}</span>
          {isPendingEmpty ? (
            <span className="min-w-0 truncate text-[11px] text-muted-foreground/50 italic animate-pulse">
              {t('tool.generating')}
            </span>
          ) : formattedInput ? (
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/60">{formattedInput}</span>
          ) : null}
          {StateIcon && (
            <StateIcon size={12} className={`ml-auto shrink-0 ${config?.color ?? ''} ${state === 'running' ? 'animate-spin' : ''}`} />
          )}
        </div>
        {hasInputToShow && (
          <pre className="mt-1.5 max-h-64 overflow-x-auto overflow-y-auto rounded-2xl border border-white/55 bg-white/68 p-3 text-[11px] font-mono leading-relaxed text-foreground/72 whitespace-pre-wrap break-all shadow-sm dark:border-white/10 dark:bg-white/8">
            {fullInputStr}
          </pre>
        )}
      </div>
    );
  }

  // Completed/error — full expandable card
  return (
    <div className="my-2 min-w-0 overflow-hidden rounded-[22px] border border-white/55 bg-[linear-gradient(180deg,oklch(1_0_0_/_0.7),oklch(1_0_0_/_0.48))] shadow-warm backdrop-blur-xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-warm-lg dark:border-white/10 dark:bg-[linear-gradient(180deg,oklch(0.24_0.02_252_/_0.88),oklch(0.2_0.018_252_/_0.76))] animate-fade-in">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex min-w-0 w-full items-center gap-2 px-3 py-3 text-xs transition-colors hover:bg-white/45 dark:hover:bg-white/6"
      >
        <span className="shrink-0 text-muted-foreground/60 transition-transform duration-200" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
          <ChevronRight size={14} />
        </span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-white/70 to-white/40 shadow-sm dark:from-white/10 dark:to-white/5">
          <Icon size={11} className="text-muted-foreground/80" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 font-mono font-semibold text-foreground/90">{toolName}</span>
            {formattedInput && (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground/55">{formattedInput}</span>
            )}
          </div>
        </div>
        {formattedInput && (
          <span className="sr-only">{formattedInput}</span>
        )}
        {config && StateIcon && (
          <PremiumPill
            accent={state === 'completed' ? 'emerald' : state === 'error' ? 'rose' : state === 'running' ? 'amber' : 'slate'}
            icon={StateIcon}
            className={state === 'running' ? 'animate-pulse' : ''}
          >
            {config.label}
          </PremiumPill>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="animate-slide-down border-t border-white/45 dark:border-white/10">
          {input !== undefined && input !== null && (
            <div className="px-3 pt-2 pb-1 overflow-hidden">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/55">{t('tool.inputLabel')}</span>
                <CopyButton text={fullInputStr} />
              </div>
              <pre className="max-h-64 overflow-x-auto overflow-y-auto rounded-[18px] border border-white/55 bg-white/68 p-3 text-[11px] font-mono leading-relaxed text-foreground/72 whitespace-pre-wrap break-all shadow-sm dark:border-white/10 dark:bg-white/8">
                {fullInputStr}
              </pre>
            </div>
          )}
          {output !== undefined && (
            <div className="px-3 pt-1.5 pb-2 overflow-hidden">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/55">{t('tool.outputLabel')}</span>
                {outputStr && <CopyButton text={outputStr} />}
              </div>
              {isDiff ? (
                <div className="overflow-hidden rounded-[18px] border border-white/55 shadow-sm dark:border-white/10">
                  <DiffView diff={outputStr} />
                </div>
              ) : (
                <div className="relative overflow-hidden">
                  <pre
                    className={`overflow-x-auto overflow-y-auto rounded-[18px] border border-white/55 bg-white/68 p-3 text-[11px] font-mono leading-relaxed text-foreground/72 whitespace-pre-wrap break-all shadow-sm dark:border-white/10 dark:bg-white/8 ${
                      outputIsLong && !outputExpanded ? 'max-h-48' : ''
                    }`}
                  >
                    {outputStr}
                  </pre>
                  {outputIsLong && !outputExpanded && (
                    <div className="flex justify-center pt-1.5">
                      <button
                        onClick={(e) => { e.stopPropagation(); setOutputExpanded(true); }}
                        className="flex items-center gap-1 rounded-full border border-white/55 bg-white/72 px-3 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground dark:border-white/10 dark:bg-white/10"
                      >
                        <ChevronDown size={10} />
                        {t('tool.expandAll')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
