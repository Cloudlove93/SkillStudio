import { Button } from '@/components/ui/button';
import { Play, Square, Loader2, Sparkles, ShieldCheck, AlertTriangle, RotateCcw } from 'lucide-react';
import { useT } from '../../i18n';
import { DetailSurface, PremiumPill } from '@/components/ui/premium';

interface AgentControlsProps {
  status: string | undefined;
  isStartingForSend: boolean;
  isOwner: boolean;
  onStart: () => void;
  onStop: () => void;
}

export default function AgentControls({ status, isStartingForSend, isOwner, onStart, onStop }: AgentControlsProps) {
  const t = useT();

  if (status === 'starting' || isStartingForSend) {
    return (
      <DetailSurface className="flex flex-col items-center gap-5 rounded-[30px] px-8 py-10 text-center">
        <PremiumPill accent="amber" icon={Sparkles}>{t('shared.bootSequence')}</PremiumPill>
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-yellow-500/20 to-amber-500/20 blur-xl" />
          <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-yellow-500/10 to-amber-500/10 border border-yellow-500/20">
            <Loader2 className="size-7 text-yellow-600 dark:text-yellow-400 animate-spin" />
          </div>
        </div>
        <div>
          <p className="font-medium text-foreground">{t('chat.starting')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('chat.startingHint')}</p>
        </div>
        <Button onClick={onStop} variant="outline" size="sm" className="gap-1.5">
          <Square className="size-3" />
          {t('chat.stop')}
        </Button>
      </DetailSurface>
    );
  }

  if (status === 'error') {
    return (
      <DetailSurface className="flex flex-col items-center gap-5 rounded-[30px] px-8 py-10 text-center">
        <PremiumPill accent="rose" icon={AlertTriangle}>{t('agent.error')}</PremiumPill>
        <div className="relative">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-red-500/20 to-rose-500/20 blur-xl" />
          <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-red-500/10 to-rose-500/10 border border-red-500/20">
            <AlertTriangle className="size-7 text-red-500 dark:text-red-400" />
          </div>
        </div>
        <div>
          <p className="font-medium text-foreground">{t('chat.errorTitle')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('chat.errorHint')}</p>
        </div>
        {isOwner && (
          <Button onClick={onStart} className="btn-premium gap-1.5 rounded-full px-5">
            <RotateCcw className="size-3.5" />
            {t('agent.restart')}
          </Button>
        )}
      </DetailSurface>
    );
  }

  return (
    <DetailSurface className="flex flex-col items-center gap-5 rounded-[30px] px-8 py-10 text-center">
      <PremiumPill accent={isOwner ? 'blue' : 'slate'} icon={isOwner ? Play : ShieldCheck}>
        {isOwner ? t('shared.readyToStart') : t('shared.viewerMode')}
      </PremiumPill>
      <div className="relative">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-primary/10 to-blue-500/10 blur-xl" />
        <div className="relative flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/5 to-blue-500/5 border border-primary/10">
          <Play className="size-7 text-muted-foreground/40" />
        </div>
      </div>
      <div>
        <p className="font-medium text-foreground">{t('chat.notRunning')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('chat.notRunningHint')}</p>
      </div>
      {isOwner ? (
          <Button
            onClick={onStart}
            className="btn-premium gap-1.5 rounded-full px-5"
          >
            <Play className="size-3.5" />
            {t('chat.startAgent')}
          </Button>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">{t('chat.publicNotRunning')}</p>
        )}
    </DetailSurface>
  );
}
