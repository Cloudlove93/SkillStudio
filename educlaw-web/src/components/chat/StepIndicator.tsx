import type { MessagePart } from '../../stores/chat';
import { ArrowDown, ArrowUp, Sparkles, CheckCircle2 } from 'lucide-react';
import { PremiumPill } from '@/components/ui/premium';
import { useT } from '../../i18n';

export default function StepIndicator({ part }: { part: MessagePart }) {
  const t = useT();
  if (part.type === 'step-start') {
    return (
      <div className="my-4 flex items-center gap-3">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/80 to-primary/20" />
        <PremiumPill accent="blue" icon={Sparkles}>{t('shared.stepStarted')}</PremiumPill>
      </div>
    );
  }

  // step-finish
  const tokens = part.tokens;
  return (
    <div className="my-4 flex items-center gap-3">
      <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border/80 to-emerald-500/20" />
      <PremiumPill accent="emerald" icon={CheckCircle2}>{t('shared.stepFinished')}</PremiumPill>
      {tokens && (tokens.input > 0 || tokens.output > 0) && (
        <div className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[10px] font-mono text-muted-foreground shadow-sm">
          <ArrowDown size={8} />
          {tokens.input}
          <ArrowUp size={8} className="ml-0.5" />
          {tokens.output}
        </div>
      )}
    </div>
  );
}
