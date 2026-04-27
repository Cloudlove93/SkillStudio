import { Terminal, MessageSquare, BookOpen, Check, Loader2 } from 'lucide-react';
import type { PromptMode } from '../PromptInput';
import { useT } from '../../../i18n';

export default function ActionBar({
  hasModes,
  hasAgents,
  currentMode,
  onModeChange,
  agentSelector,
}: {
  hasModes: boolean;
  hasAgents: boolean;
  currentMode: PromptMode;
  onModeChange?: (mode: PromptMode) => void;
  agentSelector: React.ReactNode;
}) {
  const t = useT();
  if (!hasModes && !hasAgents) {
    return (
      <p className="mt-2 text-center text-[10px] text-muted-foreground/30">
        {t('prompt.disclaimer')}
      </p>
    );
  }

  return (
    <div className="mt-1.5 flex items-center gap-2 px-1">
      {/* Mode toggle */}
      {hasModes && (
        <button
          onClick={() => onModeChange?.(currentMode === 'normal' ? 'shell' : 'normal')}
          className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] transition-colors ${
            currentMode === 'shell'
              ? 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20'
              : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60'
          }`}
          title={currentMode === 'shell' ? t('prompt.switchToChat') : t('prompt.switchToShell')}
        >
          {currentMode === 'shell' ? (
            <><Terminal className="size-3" /><span>{t('prompt.shellMode')}</span></>
          ) : (
            <><MessageSquare className="size-3" /><span>{t('prompt.chatMode')}</span></>
          )}
        </button>
      )}

      {/* Agent selector */}
      {agentSelector}

      <span className="flex-1" />
      <span className="text-[10px] text-muted-foreground/30">{t('prompt.slashHint')}</span>
    </div>
  );
}

export function DiaryButton({
  diaryStatus,
  onSaveToDiary,
}: {
  diaryStatus?: 'idle' | 'loading' | 'success' | 'error';
  onSaveToDiary?: () => void;
}) {
  const t = useT();
  if (!onSaveToDiary) return null;

  return (
    <button
      onClick={onSaveToDiary}
      disabled={diaryStatus === 'loading'}
      className={`group flex flex-col items-center justify-center shrink-0 rounded-2xl border px-2.5 py-1.5 gap-0.5 transition-all duration-300 disabled:opacity-60 disabled:cursor-not-allowed ${
        diaryStatus === 'success'
          ? 'border-rose-500/40 bg-rose-500 text-white shadow-sm'
          : diaryStatus === 'error'
          ? 'bg-destructive/10 border-destructive/30 text-destructive'
          : 'border-rose-500/25 bg-rose-500/8 text-rose-600/80 hover:scale-105 hover:border-rose-500/50 hover:bg-rose-500/12 hover:text-rose-700 dark:text-rose-300'
      }`}
      title={t('home.saveToDiaryDesc')}
    >
      {diaryStatus === 'loading' ? (
        <Loader2 className="size-5 animate-spin" />
      ) : diaryStatus === 'success' ? (
        <Check className="size-5" />
      ) : (
        <BookOpen className="size-5" />
      )}
      <span className="text-[10px] font-medium leading-tight whitespace-nowrap">
        {diaryStatus === 'loading' ? t('home.savingToDiary')
          : diaryStatus === 'success' ? t('home.saveToDiarySuccess')
          : diaryStatus === 'error' ? t('home.saveToDiaryFail')
          : t('home.saveToDiary')}
      </span>
    </button>
  );
}
